// Shared layout: renders the header (sticky nav + status pill) and footer
// into every page. Pages mark which nav link is active via the data-page
// attribute on <body>.

import { loadAll } from "./data.js";
import { fmtRelative, escapeHtml, escapeAttr } from "./format.js";

const NAV = [
  { id: "home", href: "./index.html", label: "Overview" },
  { id: "outbreaks", href: "./outbreaks.html", label: "Outbreaks" },
  { id: "map", href: "./map.html", label: "Map" },
  { id: "viruses", href: "./viruses.html", label: "Viruses" },
  { id: "sources", href: "./sources.html", label: "Sources" },
  { id: "about", href: "./about.html", label: "About" },
];

function renderHeader(activePage) {
  const navHtml = NAV.map((n) =>
    `<a class="nav-link" href="${n.href}" data-active="${n.id === activePage}">${escapeHtml(n.label)}</a>`
  ).join("");
  return `
    <div class="site-header-inner">
      <a class="brand" href="./index.html">
        <span class="brand-mark" aria-hidden="true">P</span>
        <span class="brand-text">
          <span>PublicHealthAlert</span>
          <span class="brand-tag">TCG Solutions · Public information</span>
        </span>
      </a>
      <button class="nav-toggle" id="navToggle" aria-label="Toggle navigation" aria-expanded="false">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <nav class="nav-primary" id="navPrimary" aria-label="Primary">${navHtml}</nav>
      <span class="status-pill" id="statusPill" data-status="loading" aria-live="polite">
        <span class="status-dot"></span>
        <span class="status-text">Loading status…</span>
      </span>
    </div>
  `;
}

function renderFooter() {
  return `
    <div class="footer-inner">
      <div class="footer-col">
        <h4>Project</h4>
        <a href="./about.html">About &amp; methodology</a>
        <a href="./sources.html">Source registry</a>
        <a href="https://github.com/garyamick0614-creator/PublicHealthAlert" rel="noopener" target="_blank">Source code on GitHub</a>
      </div>
      <div class="footer-col">
        <h4>Browse</h4>
        <a href="./outbreaks.html">All outbreaks</a>
        <a href="./viruses.html">By virus</a>
        <a href="./map.html">Spread map</a>
      </div>
      <div class="footer-col">
        <h4>Operator</h4>
        <a href="https://thatcomputerguy26.org" rel="noopener" target="_blank">TCG Solutions</a>
        <a href="mailto:gary.amick0614@gmail.com">Contact</a>
      </div>
      <div class="footer-col">
        <h4>Disclaimer</h4>
        <p class="muted small" style="margin:0">Aggregated from public health publishers. Not a substitute for clinical advice or official travel guidance. Always consult CDC, WHO, or your local public-health authority for action-relevant decisions.</p>
      </div>
    </div>
    <div class="footer-bottom">
      <span>© <span id="footerYear"></span> TCG Solutions · Public information project</span>
      <span>Data refreshed nightly · Last update <span id="footerRefresh">—</span></span>
    </div>
  `;
}

function setStatus(meta) {
  const pill = document.getElementById("statusPill");
  if (!pill) return;
  if (!meta || !meta.last_updated) {
    pill.dataset.status = "stale";
    pill.querySelector(".status-text").textContent = "Awaiting first scrape";
    return;
  }
  if (meta.status === "scaffold") {
    pill.dataset.status = "stale";
    pill.querySelector(".status-text").textContent = "Scaffold — first scrape pending";
    return;
  }
  const ageHr = (Date.now() - new Date(meta.last_updated).getTime()) / 3_600_000;
  const kind = meta.status === "stale" ? "stale" : ageHr < 30 ? "ok" : ageHr < 72 ? "stale" : "error";
  pill.dataset.status = kind;
  pill.querySelector(".status-text").textContent =
    `${meta.event_count ?? 0} events · ${fmtRelative(meta.last_updated)}`;

  const refresh = document.getElementById("footerRefresh");
  if (refresh) refresh.textContent = fmtRelative(meta.last_updated);
}

export async function mount() {
  const activePage = document.body.dataset.page || "home";
  const headerEl = document.getElementById("appHeader");
  const footerEl = document.getElementById("appFooter");
  if (headerEl) headerEl.innerHTML = renderHeader(activePage);
  if (footerEl) footerEl.innerHTML = renderFooter();

  // Wire mobile nav toggle
  const toggle = document.getElementById("navToggle");
  const nav = document.getElementById("navPrimary");
  if (toggle && nav) {
    toggle.addEventListener("click", () => {
      const open = nav.dataset.open === "true";
      nav.dataset.open = open ? "false" : "true";
      toggle.setAttribute("aria-expanded", String(!open));
    });
  }

  const yearEl = document.getElementById("footerYear");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  const data = await loadAll();
  setStatus(data.meta);
  return data;
}
