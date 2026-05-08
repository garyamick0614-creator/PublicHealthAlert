import { mount } from "../layout.js";
import { loadAll } from "../data.js";
import {
  virusLabel, virusGlyph, fmtRelative, fmtNumber, escapeHtml, escapeAttr,
  PRIORITY_VIRUSES,
} from "../format.js";

function tile(virus, list) {
  const newest = list[0];
  return `
    <a class="virus-tile fade-in" href="./outbreaks.html?virus=${encodeURIComponent(virus)}">
      <div class="virus-glyph">${escapeHtml(virusGlyph(virusLabel(virus)))}</div>
      <div>
        <div class="virus-name">${escapeHtml(virusLabel(virus))}</div>
        <div class="virus-meta">${list.length === 0 ? "No current signals" : `Last seen ${fmtRelative(newest?.report_date)}`}</div>
      </div>
      <div class="virus-count">${fmtNumber(list.length)}</div>
    </a>`;
}

(async function init() {
  await mount();
  const data = await loadAll();
  const counter = document.getElementById("virusCount");
  if (counter) {
    counter.querySelector(".status-text").textContent =
      `${data.indices.viruses.length} viruses · ${data.events.length} events`;
  }

  const prioGrid = document.getElementById("priorityGrid");
  prioGrid.innerHTML = PRIORITY_VIRUSES.map((v) =>
    tile(v, data.indices.byVirus.get(v) || [])
  ).join("");

  const otherGrid = document.getElementById("otherGrid");
  const others = data.indices.viruses
    .filter((v) => !PRIORITY_VIRUSES.includes(v))
    .map((v) => [v, data.indices.byVirus.get(v) || []])
    .sort(([, a], [, b]) => b.length - a.length);

  if (others.length === 0) {
    otherGrid.innerHTML = `<div class="panel" style="grid-column: 1 / -1;"><div class="empty-state"><strong>Only priority pathogens are active</strong>No other viruses have appeared in the latest scrape.</div></div>`;
  } else {
    otherGrid.innerHTML = others.map(([v, list]) => tile(v, list)).join("");
  }

  if (data.indices.viruses.length === 0) {
    document.getElementById("emptyState").hidden = false;
  }
})();
