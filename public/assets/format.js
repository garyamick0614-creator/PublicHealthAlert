// Formatting + DOM helpers shared across pages.

export const VIRUS_LABELS = {
  measles: "Measles",
  chikungunya: "Chikungunya",
  poliovirus: "Poliovirus",
  oropouche: "Oropouche",
  avian_influenza: "Avian influenza",
  yellow_fever: "Yellow fever",
  dengue: "Dengue",
  zika: "Zika",
  mpox: "Mpox",
  ebola: "Ebola",
  marburg: "Marburg",
  west_nile: "West Nile",
  covid_19: "COVID-19",
  rsv: "RSV",
  norovirus: "Norovirus",
  hantavirus: "Hantavirus",
  lassa: "Lassa fever",
  nipah: "Nipah",
  cholera: "Cholera",
  rabies: "Rabies",
};

export const PRIORITY_VIRUSES = [
  "measles", "chikungunya", "poliovirus", "oropouche", "avian_influenza", "yellow_fever",
];

export const STATUS_LABELS = {
  active: "Active outbreak",
  advisory: "Travel advisory",
  imported: "Imported case",
  monitoring: "Monitoring",
  contained: "Contained",
};

export const PATHWAY_LABELS = {
  air_travel: "Air travel",
  land_border: "Land border",
  returning_resident: "Returning resident",
  vector: "Vector / mosquito",
  animal_exposure: "Animal exposure",
};

export function virusLabel(key) {
  if (!key) return "Unspecified";
  return VIRUS_LABELS[key] || key.replace(/_/g, " ");
}

export function virusGlyph(key) {
  const s = (key || "?").toString();
  return s.charAt(0).toUpperCase();
}

export function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function fmtDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function fmtRelative(iso) {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return iso;
  if (ms < 0) return "scheduled";
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const days = Math.floor(hr / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export function fmtNumber(n) {
  if (n == null || Number.isNaN(n)) return "0";
  return n.toLocaleString();
}

export function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

export function escapeAttr(s) { return escapeHtml(s); }

export function truncate(s, n) {
  const t = String(s || "");
  if (t.length <= n) return t;
  return t.slice(0, n - 1).trimEnd() + "…";
}

// Animate a counter from 0 to target. Honors prefers-reduced-motion.
export function animateCount(el, target, duration = 900) {
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce || !target) { el.textContent = fmtNumber(target); return; }
  const start = performance.now();
  function frame(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = fmtNumber(Math.round(target * eased));
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
