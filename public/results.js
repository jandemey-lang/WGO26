const resultsEventName = document.querySelector("#resultsEventName");
const lastUpdated = document.querySelector("#lastUpdated");
const leaderboard = document.querySelector("#leaderboard");

async function api(path) {
  const response = await fetch(path, { headers: { "Content-Type": "application/json" } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Request failed");
  return body;
}

function render({ state, totals }) {
  resultsEventName.textContent = state.settings.eventName;
  lastUpdated.textContent = `Updated ${new Date(state.updatedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })}`;

  leaderboard.innerHTML = totals
    .map((item) => {
      const width = Math.max(1, Math.min(100, item.percentage));
      return `
        <article class="leader-row ${item.rank <= 3 ? "top" : ""}">
          <div class="rank">#${item.rank}</div>
          <div class="candidate-name">${escapeHtml(item.name)}</div>
          <div class="bar-track" aria-hidden="true"><div class="bar-fill" style="width: ${width}%"></div></div>
          <div class="points">${item.total}</div>
          <div class="progress">${item.scored}/${item.expected} scores</div>
        </article>
      `;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function boot() {
  render(await api("/api/state"));
  const events = new EventSource("/api/events");
  events.onmessage = (event) => render(JSON.parse(event.data));
}

boot().catch((error) => {
  document.body.innerHTML = `<main class="results-shell"><h1>Could not load</h1><p>${escapeHtml(error.message)}</p></main>`;
});
