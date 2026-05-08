// HTTP fetch wrapper with timeout, retry, and an honest User-Agent.
// Public-source scraping should identify itself; refer requests are logged
// upstream by publishers and being polite avoids being blocked.

const DEFAULT_UA =
  "PublicHealthAlertBot/0.1 (+https://publichealthalert.netlify.app; operated by TCG Solutions; contact: gary.amick0614@gmail.com)";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const RETRY_DELAY_MS = 1_500;

export async function fetchWithRetry(url, opts = {}) {
  const {
    method = "GET",
    headers = {},
    timeoutMs = DEFAULT_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    ua = DEFAULT_UA,
    accept = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  } = opts;

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method,
        headers: { "User-Agent": ua, "Accept": accept, ...headers },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) {
        // Treat 4xx as terminal — retry only on 5xx and network errors
        if (res.status >= 500 && attempt < retries) {
          await sleep(RETRY_DELAY_MS * (attempt + 1));
          continue;
        }
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} for ${url} :: ${body.slice(0, 200)}`);
      }
      return res;
    } catch (e) {
      clearTimeout(t);
      lastErr = e;
      if (attempt < retries) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }
    }
  }
  throw lastErr ?? new Error(`fetch failed for ${url}`);
}

export async function fetchText(url, opts) {
  const res = await fetchWithRetry(url, opts);
  return res.text();
}

export async function fetchJson(url, opts) {
  const res = await fetchWithRetry(url, { ...opts, accept: "application/json" });
  return res.json();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
