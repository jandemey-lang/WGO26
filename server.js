const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 8787);
const DATA_FILE = path.join(__dirname, "scores.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const ADMIN_PIN = String(process.env.ADMIN_PIN || "2468");

const defaultState = {
  settings: {
    eventName: "Finalist Judging",
    judges: Array.from({ length: 9 }, (_, index) => `Judge ${index + 1}`),
    judgePins: Array.from({ length: 9 }, (_, index) => String(1001 + index)),
    finalists: Array.from({ length: 12 }, (_, index) => `Finalist ${index + 1}`),
    questions: Array.from({ length: 5 }, (_, index) => `Question ${index + 1}`),
  },
  scores: {},
  updatedAt: new Date().toISOString(),
};

let state = loadState();
const clients = new Set();
const sessions = new Map();

function loadState() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const saved = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      return normalizeState(saved);
    }
  } catch (error) {
    console.error("Could not load scores:", error);
  }
  return normalizeState(structuredClone(defaultState));
}

function normalizeState(source) {
  const next = {
    ...structuredClone(defaultState),
    ...source,
    settings: {
      ...structuredClone(defaultState.settings),
      ...(source.settings || {}),
    },
    scores: source.scores || {},
  };

  next.settings.judges = Array.from({ length: 9 }, (_, index) =>
    normalizeName(next.settings.judges?.[index], `Judge ${index + 1}`),
  );
  next.settings.judgePins = Array.from({ length: 9 }, (_, index) =>
    normalizePin(next.settings.judgePins?.[index], String(1001 + index)),
  );
  next.settings.finalists = Array.from({ length: 12 }, (_, index) =>
    normalizeName(next.settings.finalists?.[index], `Finalist ${index + 1}`),
  );
  next.settings.questions = Array.from({ length: 5 }, (_, index) =>
    normalizeName(next.settings.questions?.[index], `Question ${index + 1}`),
  );

  return next;
}

function saveState() {
  state.updatedAt = new Date().toISOString();
  fs.writeFileSync(DATA_FILE, JSON.stringify(state, null, 2));
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function scoreKey(judgeId, finalistId, questionId) {
  return `${judgeId}:${finalistId}:${questionId}`;
}

function normalizeName(value, fallback) {
  const text = String(value || "").trim();
  return text || fallback;
}

function normalizePin(value, fallback) {
  const text = String(value || "").replace(/\D/g, "").slice(0, 12);
  return text || fallback;
}

function publicState() {
  return {
    ...state,
    settings: {
      ...state.settings,
      judgePins: undefined,
    },
  };
}

function adminState() {
  return state;
}

function createSession(role, judgeId = null) {
  const token = crypto.randomBytes(24).toString("hex");
  sessions.set(token, {
    role,
    judgeId,
    expiresAt: Date.now() + 1000 * 60 * 60 * 12,
  });
  return token;
}

function authFromRequest(req) {
  const header = req.headers.authorization || "";
  const tokenFromHeader = header.startsWith("Bearer ") ? header.slice(7) : "";
  const tokenFromQuery = new URL(req.url, `http://${req.headers.host}`).searchParams.get("token") || "";
  const token = tokenFromHeader || tokenFromQuery;
  const session = sessions.get(token);

  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }

  return { ...session, token };
}

function requireAdmin(req, res) {
  const session = authFromRequest(req);
  if (!session || session.role !== "admin") {
    sendJson(res, 401, { error: "Admin PIN required" });
    return null;
  }
  return session;
}

function requireJudge(req, res) {
  const session = authFromRequest(req);
  if (!session || session.role !== "judge") {
    sendJson(res, 401, { error: "Judge PIN required" });
    return null;
  }
  return session;
}

function totalsForState(source = state) {
  const { judges, finalists, questions } = source.settings;
  const finalistTotals = finalists.map((name, finalistIndex) => {
    const finalistId = String(finalistIndex);
    const byQuestion = questions.map((_, questionIndex) => {
      const questionId = String(questionIndex);
      let total = 0;
      let count = 0;
      for (let judgeIndex = 0; judgeIndex < judges.length; judgeIndex += 1) {
        const value = source.scores[scoreKey(String(judgeIndex), finalistId, questionId)];
        if (Number.isInteger(value)) {
          total += value;
          count += 1;
        }
      }
      return { total, count };
    });

    const total = byQuestion.reduce((sum, item) => sum + item.total, 0);
    const possible = judges.length * questions.length * 5;
    const scored = byQuestion.reduce((sum, item) => sum + item.count, 0);
    const expected = judges.length * questions.length;

    return {
      id: finalistId,
      order: finalistIndex,
      name,
      total,
      possible,
      scored,
      expected,
      percentage: possible ? Math.round((total / possible) * 1000) / 10 : 0,
      byQuestion,
    };
  });

  return finalistTotals
    .sort((a, b) => b.total - a.total || b.scored - a.scored || a.order - b.order)
    .map((item, index) => ({ ...item, rank: index + 1 }));
}

function broadcast() {
  const payload = `data: ${JSON.stringify({ state: publicState(), totals: totalsForState() })}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

function resetScores() {
  state.scores = {};
  saveState();
  broadcast();
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/state") {
    sendJson(res, 200, { state: publicState(), totals: totalsForState() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin-state") {
    if (!requireAdmin(req, res)) return;
    sendJson(res, 200, { state: adminState(), totals: totalsForState() });
    return;
  }

  if (req.method === "GET" && pathname === "/api/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.write(`data: ${JSON.stringify({ state: publicState(), totals: totalsForState() })}\n\n`);
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  if (req.method === "POST" && pathname === "/api/login") {
    const body = await parseBody(req);
    const role = String(body.role || "");
    const pin = String(body.pin || "").trim();

    if (role === "admin" && pin === ADMIN_PIN) {
      sendJson(res, 200, { token: createSession("admin"), role: "admin" });
      return;
    }

    if (role === "judge") {
      const judgeId = String(Math.max(1, Number(body.judgeId || 1)) - 1);
      if (state.settings.judgePins[judgeId] && pin === state.settings.judgePins[judgeId]) {
        sendJson(res, 200, { token: createSession("judge", judgeId), role: "judge", judgeId });
        return;
      }
    }

    sendJson(res, 401, { error: "Incorrect PIN" });
    return;
  }

  if (req.method === "POST" && pathname === "/api/logout") {
    const session = authFromRequest(req);
    if (session) sessions.delete(session.token);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/score") {
    const session = requireJudge(req, res);
    if (!session) return;

    const body = await parseBody(req);
    const judgeId = session.judgeId;
    const finalistId = String(body.finalistId);
    const questionId = String(body.questionId);
    const value = Number(body.value);

    const isValid =
      state.settings.judges[judgeId] &&
      state.settings.finalists[finalistId] &&
      state.settings.questions[questionId] &&
      Number.isInteger(value) &&
      value >= 1 &&
      value <= 5;

    if (!isValid) {
      sendJson(res, 400, { error: "Invalid score" });
      return;
    }

    state.scores[scoreKey(judgeId, finalistId, questionId)] = value;
    saveState();
    broadcast();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/settings") {
    if (!requireAdmin(req, res)) return;
    const body = await parseBody(req);
    state.settings.eventName = normalizeName(body.eventName, defaultState.settings.eventName);
    state.settings.judges = Array.from({ length: 9 }, (_, index) =>
      normalizeName(body.judges?.[index], `Judge ${index + 1}`),
    );
    state.settings.judgePins = Array.from({ length: 9 }, (_, index) =>
      normalizePin(body.judgePins?.[index], String(1001 + index)),
    );
    state.settings.finalists = Array.from({ length: 12 }, (_, index) =>
      normalizeName(body.finalists?.[index], `Finalist ${index + 1}`),
    );
    state.settings.questions = Array.from({ length: 5 }, (_, index) =>
      normalizeName(body.questions?.[index], `Question ${index + 1}`),
    );
    saveState();
    broadcast();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "POST" && pathname === "/api/reset") {
    if (!requireAdmin(req, res)) return;
    const body = await parseBody(req);
    if (body.confirm !== "RESET") {
      sendJson(res, 400, { error: "Type RESET to clear scores" });
      return;
    }
    resetScores();
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && pathname === "/api/export.csv") {
    if (!requireAdmin(req, res)) return;
    const csv = exportCsv();
    res.writeHead(200, {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=\"event-scores.csv\"",
      "Cache-Control": "no-store",
    });
    res.end(csv);
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

function csvCell(value) {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}

function exportCsv() {
  const rows = [["Judge", "Finalist", "Question", "Score"]];
  for (let judgeIndex = 0; judgeIndex < state.settings.judges.length; judgeIndex += 1) {
    for (let finalistIndex = 0; finalistIndex < state.settings.finalists.length; finalistIndex += 1) {
      for (let questionIndex = 0; questionIndex < state.settings.questions.length; questionIndex += 1) {
        const value = state.scores[scoreKey(String(judgeIndex), String(finalistIndex), String(questionIndex))];
        rows.push([
          state.settings.judges[judgeIndex],
          state.settings.finalists[finalistIndex],
          state.settings.questions[questionIndex],
          Number.isInteger(value) ? value : "",
        ]);
      }
    }
  }

  rows.push([]);
  rows.push(["Rank", "Finalist", "Total", "Submitted Scores", "Expected Scores"]);
  for (const item of totalsForState()) {
    rows.push([item.rank, item.name, item.total, item.scored, item.expected]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(resolved, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    const extension = path.extname(resolved);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, {
      "Content-Type": types[extension] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (error) {
    console.error(`[${requestId}]`, error);
    sendJson(res, 500, { error: "Server error" });
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Judging tool running at http://localhost:${PORT}`);
  console.log(`Big screen: http://localhost:${PORT}/results.html`);
  console.log(`Judge scoring: http://localhost:${PORT}/judge.html?judge=1`);
});
