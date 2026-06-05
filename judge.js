const params = new URLSearchParams(location.search);
const judgeId = String(Math.max(1, Number(params.get("judge") || 1)) - 1);
let state;
let activeFinalistId = "0";
let judgeToken = localStorage.getItem(`eventJudgeToken:${judgeId}`) || "";

const judgeName = document.querySelector("#judgeName");
const judgeEventName = document.querySelector("#judgeEventName");
const finalistTabs = document.querySelector("#finalistTabs");
const activeFinalist = document.querySelector("#activeFinalist");
const questionScores = document.querySelector("#questionScores");
const completion = document.querySelector("#completion");
const judgeLogin = document.querySelector("#judgeLogin");
const judgeArea = document.querySelector("#judgeArea");
const judgePin = document.querySelector("#judgePin");
const judgeLoginButton = document.querySelector("#judgeLoginButton");
const judgeLoginMessage = document.querySelector("#judgeLoginMessage");

async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (judgeToken) headers.Authorization = `Bearer ${judgeToken}`;

  const response = await fetch(path, {
    ...options,
    headers,
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function setJudgeUnlocked(unlocked) {
  judgeLogin.classList.toggle("hidden", unlocked);
  judgeArea.classList.toggle("hidden", !unlocked);
}

function key(finalistId, questionId) {
  return `${judgeId}:${finalistId}:${questionId}`;
}

function render(nextState) {
  state = nextState;
  judgeName.textContent = state.settings.judges[judgeId] || "Judge";
  judgeEventName.textContent = state.settings.eventName;
  activeFinalist.textContent = state.settings.finalists[activeFinalistId] || "Finalist";

  finalistTabs.innerHTML = state.settings.finalists
    .map((name, index) => {
      const finalistId = String(index);
      const complete = state.settings.questions.filter((_, qIndex) => state.scores[key(finalistId, String(qIndex))]).length;
      return `<button class="tab ${finalistId === activeFinalistId ? "active" : ""}" data-tab="${finalistId}">
        ${index + 1}. ${escapeHtml(name)} (${complete}/5)
      </button>`;
    })
    .join("");

  finalistTabs.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      activeFinalistId = button.dataset.tab;
      render(state);
    });
  });

  const scoredCount = state.settings.questions.filter((_, index) => state.scores[key(activeFinalistId, String(index))]).length;
  completion.textContent = `${scoredCount}/${state.settings.questions.length}`;

  questionScores.innerHTML = state.settings.questions
    .map((question, questionIndex) => {
      const questionId = String(questionIndex);
      const selected = state.scores[key(activeFinalistId, questionId)];
      return `
        <article class="question-row">
          <h3>${escapeHtml(question)}</h3>
          <div class="score-buttons" role="group" aria-label="${escapeHtml(question)}">
            ${[1, 2, 3, 4, 5]
              .map(
                (value) => `
                  <button class="score-button ${selected === value ? "selected" : ""}"
                    data-question="${questionId}"
                    data-value="${value}">
                    ${value}
                  </button>
                `,
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");

  questionScores.querySelectorAll("[data-question]").forEach((button) => {
    button.addEventListener("click", async () => {
      const body = {
        finalistId: activeFinalistId,
        questionId: button.dataset.question,
        value: Number(button.dataset.value),
      };
      await api("/api/score", { method: "POST", body: JSON.stringify(body) });
    });
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

judgeLoginButton.addEventListener("click", async () => {
  judgeLoginMessage.textContent = "";
  try {
    const result = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ role: "judge", judgeId: Number(judgeId) + 1, pin: judgePin.value }),
    });
    judgeToken = result.token;
    localStorage.setItem(`eventJudgeToken:${judgeId}`, judgeToken);
    setJudgeUnlocked(true);
    const payload = await api("/api/state");
    render(payload.state);
  } catch (error) {
    judgeLoginMessage.textContent = error.message;
  }
});

async function boot() {
  const payload = await api("/api/state");
  judgeName.textContent = payload.state.settings.judges[judgeId] || "Judge";
  judgeEventName.textContent = payload.state.settings.eventName;

  if (judgeToken) {
    setJudgeUnlocked(true);
    render(payload.state);
  } else {
    setJudgeUnlocked(false);
  }

  const events = new EventSource("/api/events");
  events.onmessage = (event) => {
    if (!judgeToken) return;
    render(JSON.parse(event.data).state);
  };
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="shell"><section class="panel"><h1>Could not load</h1><p>${escapeHtml(error.message)}</p></section></main>`;
});
