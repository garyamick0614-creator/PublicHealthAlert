import { mount } from "../layout.js";
import { loadAll } from "../data.js";
import { fmtRelative, escapeHtml, escapeAttr, fmtNumber } from "../format.js";

function healthState(s) {
  if (s.last_error) return "error";
  if (!s.last_scraped) return "unknown";
  const ageHr = (Date.now() - new Date(s.last_scraped).getTime()) / 3_600_000;
  if (ageHr > 30) return "warn";
  return "ok";
}

function healthLabel(state) {
  return ({ ok: "Healthy", warn: "Stale", error: "Failing", unknown: "Awaiting first scrape" })[state] || state;
}

(async function init() {
  await mount();
  const data = await loadAll();
  const grid = document.getElementById("sourceGrid");

  if (data.sources.length === 0) {
    grid.innerHTML = `<div class="panel"><div class="empty-state"><strong>No sources registered yet</strong>The registry will populate after the first scrape.</div></div>`;
    return;
  }

  grid.innerHTML = data.sources.map((s) => {
    const state = healthState(s);
    return `
      <div class="source-card fade-in">
        <div class="source-card-head">
          <div>
            <div class="source-name">${escapeHtml(s.name)}</div>
            <div class="muted small" style="margin-top:0.2rem;">${escapeHtml(s.region_scope || "—")}</div>
          </div>
          <span class="access-tag" data-access="${escapeAttr(s.access || "unknown")}">${escapeHtml(s.access || "unknown")}</span>
        </div>
        <div class="muted small">${escapeHtml(s.format || "—")}</div>
        <div class="source-foot">
          <span><span class="health-dot" data-state="${escapeAttr(state)}"></span>${escapeHtml(healthLabel(state))}</span>
          <span>·</span>
          <span>${s.last_scraped ? `Last scraped ${escapeHtml(fmtRelative(s.last_scraped))}` : "Awaiting first scrape"}</span>
          ${typeof s.last_event_count === "number"
            ? ` <span>·</span> <span>${fmtNumber(s.last_event_count)} event${s.last_event_count === 1 ? "" : "s"} last run</span>`
            : ""}
          ${s.url ? ` <span>·</span> <a href="${escapeAttr(s.url)}" rel="noopener" target="_blank">Publisher site</a>` : ""}
        </div>
        ${s.last_error ? `<div class="muted small" style="color: var(--alert);">Last error: ${escapeHtml(s.last_error)}</div>` : ""}
      </div>`;
  }).join("");
})();
