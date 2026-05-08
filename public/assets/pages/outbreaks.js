import { mount } from "../layout.js";
import { loadAll, applyFilters } from "../data.js";
import {
  virusLabel, fmtDate, fmtRelative, escapeHtml, escapeAttr, truncate,
  STATUS_LABELS, PATHWAY_LABELS,
} from "../format.js";

const state = {
  filters: { q: "", virus: "", country: "", pathway: "", status: "", source: "" },
};

function readFiltersFromUrl() {
  const p = new URLSearchParams(window.location.search);
  for (const k of Object.keys(state.filters)) {
    const v = p.get(k);
    if (v != null) state.filters[k] = v;
  }
}

function writeFiltersToUrl() {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(state.filters)) if (v) p.set(k, v);
  const qs = p.toString();
  const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

function populateFilters(data) {
  const fillSelect = (id, values, defaultLabel, labelFn = (x) => x) => {
    const sel = document.getElementById(id);
    const cur = state.filters[id.replace(/^filter/, "").toLowerCase()];
    sel.innerHTML = `<option value="">${escapeHtml(defaultLabel)}</option>` +
      [...values].sort().map((v) =>
        `<option value="${escapeAttr(v)}"${v === cur ? " selected" : ""}>${escapeHtml(labelFn(v))}</option>`
      ).join("");
  };
  fillSelect("filterVirus", data.indices.viruses, "All viruses", virusLabel);
  fillSelect("filterCountry", data.indices.countries, "All countries");
  fillSelect("filterSource", [...data.indices.bySource.keys()], "All sources");

  // Pre-select static filters
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ""; };
  setVal("filterQ", state.filters.q);
  setVal("filterStatus", state.filters.status);
  setVal("filterPathway", state.filters.pathway);
}

function renderTable(data) {
  const filtered = applyFilters(data.events, state.filters);
  const tbody = document.getElementById("eventsBody");
  const counter = document.getElementById("resultCount");
  if (counter) {
    counter.querySelector(".status-text").textContent =
      `${filtered.length} of ${data.events.length} events`;
  }
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><strong>No events match these filters</strong>Try clearing a constraint or hit Reset.</div></td></tr>`;
    return;
  }
  tbody.innerHTML = filtered.map((e) => {
    const tone = e.status || "monitoring";
    return `
      <tr class="fade-in">
        <td class="col-date">${escapeHtml(fmtDate(e.report_date))}<div class="muted small">${escapeHtml(fmtRelative(e.report_date))}</div></td>
        <td class="col-virus">${escapeHtml(virusLabel(e.virus))}</td>
        <td><span class="chip" data-tone="${escapeAttr(tone)}">${escapeHtml(STATUS_LABELS[tone] || tone)}</span></td>
        <td>${escapeHtml(e.origin_country || "—")}${e.origin_setting ? `<div class="muted small">${escapeHtml(e.origin_setting)}</div>` : ""}</td>
        <td>
          <div class="event-title">${e.source_url
            ? `<a href="${escapeAttr(e.source_url)}" rel="noopener" target="_blank">${escapeHtml(e.title || "Untitled")}</a>`
            : escapeHtml(e.title || "Untitled")}</div>
          ${e.summary ? `<div class="event-summary">${escapeHtml(truncate(e.summary, 240))}</div>` : ""}
        </td>
        <td>${escapeHtml(PATHWAY_LABELS[e.us_pathway] || (e.us_pathway || "—"))}</td>
        <td>${escapeHtml(e.source || "—")}</td>
      </tr>`;
  }).join("");
}

function bindFilters(data) {
  const map = [
    ["filterQ", "q", "input"],
    ["filterVirus", "virus", "change"],
    ["filterCountry", "country", "change"],
    ["filterStatus", "status", "change"],
    ["filterPathway", "pathway", "change"],
    ["filterSource", "source", "change"],
  ];
  for (const [id, key, evt] of map) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener(evt, () => {
      state.filters[key] = el.value;
      writeFiltersToUrl();
      renderTable(data);
    });
  }
  document.getElementById("filterReset")?.addEventListener("click", () => {
    state.filters = { q: "", virus: "", country: "", pathway: "", status: "", source: "" };
    document.querySelectorAll("#filters select, #filters input").forEach((el) => { el.value = ""; });
    writeFiltersToUrl();
    renderTable(data);
  });
}

(async function init() {
  await mount();
  const data = await loadAll();
  readFiltersFromUrl();
  populateFilters(data);
  bindFilters(data);
  renderTable(data);
})();
