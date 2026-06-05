let currentState;
let adminToken = localStorage.getItem("eventAdminToken") || "";

const judgeLinks = document.querySelector("#judgeLinks");
const eventName = document.querySelector("#eventName");
const eventInput = document.querySelector("#eventInput");
const judgeInputs = document.querySelector("#judgeInputs");
const finalistInputs = document.querySelector("#finalistInputs");
const questionInputs = document.querySelector("#questionInputs");
const saveSettings = document.querySelector("#saveSettings");
const resetScores = document.querySelector("#resetScores");
const resetConfirm = document.querySelector("#resetConfirm");
const adminLogin = document.querySelector("#adminLogin");
const adminArea = document.querySelector("#adminArea");
const adminPin = document.querySelector("#adminPin");
const adminLoginButton = document.querySelector("#adminLoginButton");
const adminLoginMessage = document.querySelector("#adminLoginMessage");
const exportScores = document.querySelector("#exportScores");

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (adminToken) headers.Authorization = `Bearer ${adminToken}`;

  const response = await fetch(path, {
    ...options,
    headers,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function setAdminUnlocked(unlocked) {
  adminLogin.classList.toggle("hidden", unlocked);
  adminArea.classList.toggle("hidden", !unlocked);
  exportScores.classList.toggle("hidden", !unlocked);
}

function render(state) {
  currentState = state;
  eventName.textContent = state.settings.eventName;
  eventInput.value = state.settings.eventName;

  judgeLinks.innerHTML = state.settings.judges
    .map(
      (judge, index) => `
        <div class="judge-link-card">
          <a class="screen-link" href="/judge.html?judge=${index + 1}">${escapeHtml(judge)}</a>
          <span>PIN ${escapeHtml(state.settings.judgePins[index])}</span>
        </div>
      `,
    )
    .join("");

  judgeInputs.innerHTML = state.settings.judges
    .map(
      (name, index) => `
        <div class="inline-fields">
          <label class="field">
            <span>Judge ${index + 1}</span>
            <input data-judge="${index}" value="${escapeHtml(name)}" />
          </label>
          <label class="field pin-field">
            <span>PIN</span>
            <input data-judge-pin="${index}" value="${escapeHtml(state.settings.judgePins[index])}" inputmode="numeric" />
          </label>
        </div>
      `,
    )
    .join("");

  finalistInputs.innerHTML = state.settings.finalists
    .map(
      (name, index) => `
        <label class="field">
          <span>Finalist ${index + 1}</span>
          <input data-finalist="${index}" value="${escapeHtml(name)}" />
        </label>
      `,
    )
    .join("");

  questionInputs.innerHTML = state.settings.questions
    .map(
      (name, index) => `
        <label class="field">
          <span>Question ${index + 1}</span>
          <input data-question="${index}" value="${escapeHtml(name)}" />
        </label>
      `,
    )
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

adminLoginButton.addEventListener("click", async () => {
  adminLoginMessage.textContent = "";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ role: "admin", pin: adminPin.value }),
    });
    adminToken = result.token;
    localStorage.setItem("eventAdminToken", adminToken);
    const payload = await api("/api/admin-state");
    setAdminUnlocked(true);
    render(payload.state);
  } catch (error) {
    adminLoginMessage.textContent = error.message;
  }
});

saveSettings.addEventListener("click", async () => {
  const judges = [...document.querySelectorAll("[data-judge]")].map((input) => input.value);
  const judgePins = [...document.querySelectorAll("[data-judge-pin]")].map((input) => input.value);
  const finalists = [...document.querySelectorAll("[data-finalist]")].map((input) => input.value);
  const questions = [...document.querySelectorAll("[data-question]")].map((input) => input.value);
  saveSettings.textContent = "Saving...";
  await api("/api/settings", {
    method: "POST",
    body: JSON.stringify({ eventName: eventInput.value, judges, judgePins, finalists, questions }),
  });
  saveSettings.textContent = "Saved";
  setTimeout(() => (saveSettings.textContent = "Save names"), 900);
});

resetScores.addEventListener("click", async () => {
  await api("/api/reset", {
    method: "POST",
    body: JSON.stringify({ confirm: resetConfirm.value }),
  });
  resetConfirm.value = "";
});

exportScores.addEventListener("click", async () => {
  const response = await fetch(`/api/export.csv?token=${encodeURIComponent(adminToken)}`);
  if (!response.ok) {
    alert("Could not export scores");
    return;
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "event-scores.csv";
  link.click();
  URL.revokeObjectURL(url);
});

async function boot() {
  setAdminUnlocked(false);
  if (adminToken) {
    try {
      const payload = await api("/api/admin-state");
      setAdminUnlocked(true);
      render(payload.state);
    } catch {
      adminToken = "";
      localStorage.removeItem("eventAdminToken");
    }
  }

  const publicPayload = await api("/api/state");
  eventName.textContent = publicPayload.state.settings.eventName;

  const events = new EventSource("/api/events");
  events.onmessage = async () => {
    if (!adminToken) return;
    try {
      const payload = await api("/api/admin-state");
      render(payload.state);
    } catch {
      setAdminUnlocked(false);
    }
  };
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="shell"><section class="panel"><h1>Could not load</h1><p>${escapeHtml(error.message)}</p></section></main>`;
});
