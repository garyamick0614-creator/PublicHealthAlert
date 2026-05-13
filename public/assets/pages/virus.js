import { mount } from "../layout.js";
import { loadAll } from "../data.js";
import {
  virusLabel, virusGlyph, fmtDate, fmtRelative, fmtNumber, escapeHtml, escapeAttr, truncate,
  STATUS_LABELS, animateCount,
} from "../format.js";

function getVirusId() {
  return new URLSearchParams(window.location.search).get("id") || "";
}

function timelineBuckets(events, weeks = 12) {
  const now = Date.now();
  const weekMs = 7 * 24 * 3600 * 1000;
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    start: now - (weeks - i) * weekMs,
    end: now - (weeks - i - 1) * weekMs,
    count: 0,
  }));
  for (const e of events) {
    if (!e.report_date) continue;
    const t = Date.parse(e.report_date);
    if (Number.isNaN(t)) continue;
    if (t < buckets[0].start || t > buckets[buckets.length - 1].end) continue;
    const idx = Math.min(weeks - 1, Math.floor((t - buckets[0].start) / weekMs));
    buckets[idx].count++;
  }
  return buckets;
}

function renderTimeline(events) {
  const svg = document.getElementById("timelineSvg");
  const buckets = timelineBuckets(events, 12);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const w = 800, h = 140, pad = 18, gap = 6;
  const barW = (w - pad * 2 - gap * (buckets.length - 1)) / buckets.length;
  const baseY = h - 26;
  const range = document.getElementById("timelineRange");
  if (range) {
    const first = buckets[0].start;
    range.textContent = `${new Date(first).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – today (12 weeks)`;
  }
  const bars = buckets.map((b, i) => {
    const x = pad + i * (barW + gap);
    const barH = (b.count / max) * (baseY - 18);
    const y = baseY - barH;
    const date = new Date(b.start);
    const dateLabel = date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return `
      <g>
        <rect class="timeline-bar" x="${x}" y="${y}" width="${barW}" height="${Math.max(2, barH)}" rx="2">
          <title>${dateLabel}: ${b.count} event${b.count === 1 ? "" : "s"}</title>
        </rect>
        ${i % 2 === 0 ? `<text class="timeline-label" x="${x + barW / 2}" y="${h - 8}" text-anchor="middle">${dateLabel}</text>` : ""}
        ${b.count > 0 ? `<text class="timeline-label" x="${x + barW / 2}" y="${y - 4}" text-anchor="middle" style="fill: var(--text);">${b.count}</text>` : ""}
      </g>`;
  }).join("");
  svg.innerHTML = `<line x1="${pad}" y1="${baseY}" x2="${w - pad}" y2="${baseY}" stroke="var(--border)" stroke-width="1"/>${bars}`;
}

function renderBreakdown(elId, list, total) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (list.length === 0) {
    el.innerHTML = `<li class="muted">No data</li>`;
    return;
  }
  el.innerHTML = list.slice(0, 8).map(([name, count]) => {
    const pct = Math.max(2, Math.round((count / Math.max(total, 1)) * 100));
    return `
      <li>
        <div>
          <div class="b-name">${escapeHtml(name)}</div>
          <span class="b-bar" style="width: ${pct}%"></span>
        </div>
        <div class="b-count">${fmtNumber(count)}</div>
      </li>`;
  }).join("");
}

function renderEvents(events) {
  const grid = document.getElementById("vEvents");
  const counter = document.getElementById("allCount");
  if (counter) counter.textContent = `${events.length} event${events.length === 1 ? "" : "s"}`;
  if (events.length === 0) {
    grid.innerHTML = `<div class="panel" style="grid-column: 1 / -1;"><div class="empty-state"><strong>No events for this virus</strong>It may have appeared in the keyword set but not in any current source feed.</div></div>`;
    return;
  }
  grid.innerHTML = events.slice(0, 24).map((e) => {
    const tone = e.status || "monitoring";
    return `
      <a class="alert-card" href="${escapeAttr(e.source_url || "#")}" rel="noopener" target="_blank" data-tone="${escapeAttr(tone)}">
        <div class="alert-meta">
          <span class="alert-virus">${escapeHtml(e.origin_country || "—")}</span>
          <span>·</span>
          <span>${escapeHtml(fmtRelative(e.report_date))}</span>
        </div>
        <div class="alert-headline">${escapeHtml(e.title || "Untitled")}</div>
        ${e.summary ? `<div class="alert-summary">${escapeHtml(truncate(e.summary, 220))}</div>` : ""}
        <div class="alert-footer">
          <span class="chip" data-tone="${escapeAttr(tone)}">${escapeHtml(STATUS_LABELS[tone] || tone)}</span>
          <span>${escapeHtml(e.source || "")}</span>
        </div>
      </a>`;
  }).join("");
}

function renderStats(events) {
  const newest = events[0];
  const cards = [
    { label: "Total events", value: events.length, foot: newest?.report_date ? `Newest ${fmtRelative(newest.report_date)}` : "No dated activity yet", tone: "" },
    { label: "Active outbreaks", value: events.filter(e => e.status === "active").length, foot: "Status = active in latest scrape", tone: "alert" },
    { label: "Travel advisories", value: events.filter(e => e.status === "advisory").length, foot: "Status = advisory in latest scrape", tone: "advisory" },
    { label: "Reporting sources", value: new Set(events.map(e => e.source).filter(Boolean)).size, foot: "Distinct publishers contributing", tone: "monitor" },
  ];
  const grid = document.getElementById("vStatGrid");
  grid.innerHTML = cards.map((c) => `
    <div class="stat-card"${c.tone ? ` data-tone="${c.tone}"` : ""}>
      <div class="stat-label">${escapeHtml(c.label)}</div>
      <div class="stat-value" data-target="${c.value}">0</div>
      <div class="stat-foot">${escapeHtml(c.foot)}</div>
    </div>
  `).join("");
  grid.querySelectorAll(".stat-value").forEach((el) => animateCount(el, Number(el.dataset.target || 0)));
}

(async function init() {
  await mount();
  const data = await loadAll();
  const id = getVirusId();

  // No id passed -> render a helpful index of all viruses rather than an empty
  // "Unspecified" shell. Each virus link populates ?id= and reloads with data.
  if (!id) {
    document.title = `Pick a virus · PublicHealthAlert`;
    const glyph = document.getElementById("vGlyph");
    const name = document.getElementById("vName");
    const meta = document.getElementById("vMeta");
    const crumb = document.getElementById("crumbName");
    if (glyph) glyph.textContent = "?";
    if (name) name.textContent = "Pick a virus";
    if (crumb) crumb.textContent = "Pick a virus";
    if (meta) {
      meta.textContent =
        `No virus selected. The URL needs ?id=<virus> (e.g. ?id=measles). ` +
        `${data.indices.viruses.length} viruses are currently tracked.`;
    }
    document.getElementById("vListLink")?.setAttribute("href", "./outbreaks.html");
    document.getElementById("vMapLink")?.setAttribute("href", "./map.html");

    const grid = document.getElementById("vEvents");
    const tiles = data.indices.viruses
      .map((v) => [v, data.indices.byVirus.get(v) || []])
      .sort(([, a], [, b]) => b.length - a.length);
    document.getElementById("allCount").textContent =
      `${data.indices.viruses.length} viruses tracked`;
    grid.innerHTML = tiles.length === 0
      ? `<div class="panel" style="grid-column:1/-1"><div class="empty-state"><strong>No virus data yet</strong>Next nightly scrape at 01:00 ET will populate the registry.</div></div>`
      : tiles.map(([v, list]) => `
        <a class="alert-card" href="./virus.html?id=${encodeURIComponent(v)}">
          <div class="alert-meta"><span class="alert-virus">${escapeHtml(virusGlyph(virusLabel(v)))}</span></div>
          <div class="alert-headline">${escapeHtml(virusLabel(v))}</div>
          <div class="alert-footer">
            <span class="chip">${list.length} event${list.length === 1 ? "" : "s"}</span>
            <span>${list[0]?.report_date ? `Newest ${escapeHtml(fmtRelative(list[0].report_date))}` : "no dated activity"}</span>
          </div>
        </a>`).join("");

    // Empty out timeline/breakdown panels gracefully
    document.getElementById("vStatGrid").innerHTML = "";
    document.getElementById("timelineSvg").innerHTML = "";
    document.getElementById("timelineRange").textContent = "—";
    document.getElementById("countryBreakdown").innerHTML = `<li class="muted">Pick a virus to see country breakdown.</li>`;
    document.getElementById("sourceBreakdown").innerHTML = `<li class="muted">Pick a virus to see reporting sources.</li>`;
    return;
  }

  const events = data.indices.byVirus.get(id) || [];

  // Sort by report_date desc; events without a date sort to the end
  events.sort((a, b) => {
    const da = a.report_date ? Date.parse(a.report_date) : 0;
    const db = b.report_date ? Date.parse(b.report_date) : 0;
    return db - da;
  });

  const label = virusLabel(id);
  document.title = `${label} · PublicHealthAlert`;
  document.getElementById("vGlyph").textContent = virusGlyph(label);
  document.getElementById("vName").textContent = label;
  document.getElementById("crumbName").textContent = label;
  document.getElementById("vListLink").href = `./outbreaks.html?virus=${encodeURIComponent(id)}`;
  document.getElementById("vMapLink").href = `./map.html?virus=${encodeURIComponent(id)}`;
  document.getElementById("vMeta").textContent = events.length === 0
    ? `No current events tagged ${label} in the live feed.`
    : `${events.length} event${events.length === 1 ? "" : "s"} across ${new Set(events.map(e => e.source)).size} source${new Set(events.map(e => e.source)).size === 1 ? "" : "s"}. Newest ${fmtRelative(events[0]?.report_date)}.`;

  renderStats(events);
  renderTimeline(events);

  // Country breakdown
  const countryCounts = new Map();
  for (const e of events) {
    if (!e.origin_country) continue;
    countryCounts.set(e.origin_country, (countryCounts.get(e.origin_country) || 0) + 1);
  }
  renderBreakdown(
    "countryBreakdown",
    [...countryCounts.entries()].sort((a, b) => b[1] - a[1]),
    events.length
  );

  // Source breakdown
  const sourceCounts = new Map();
  for (const e of events) {
    if (!e.source) continue;
    sourceCounts.set(e.source, (sourceCounts.get(e.source) || 0) + 1);
  }
  renderBreakdown(
    "sourceBreakdown",
    [...sourceCounts.entries()].sort((a, b) => b[1] - a[1]),
    events.length
  );

  renderEvents(events);
})();
