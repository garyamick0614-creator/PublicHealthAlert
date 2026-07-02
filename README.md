# PublicHealthAlert

A public information dashboard tracking cross-border virus spread with relevance to the United States. Data is refreshed nightly from official public-health sources and published as a static site.

**Hosted by:** TCG Solutions
**Status:** Scaffold — first scheduled scrape pending
**License:** MIT (code) — source data remains under each publisher's terms

## What this tracks

Reverse-chronological feed of outbreak signals, travel advisories, imported cases, environmental detections, and lineage updates. Each event records:

- Report date
- Virus
- Event type
- Where it started (country / region / setting)
- Current spread zone
- U.S. pathway (air travel, land border, returning residents, vector, animal exposure)

## Sources

Primary structured sources:

- **CDC** — outbreak and travel pages, U.S. case counts, import warnings
- **PAHO** — Americas-wide spread, Spanish-language regional context
- **WHO Disease Outbreak News (DON)** — internationally significant events
- **ECDC** — RSS feeds and Communicable Disease Threats Report (CDTR)

Secondary / contextual:

- **Africa CDC** — public outbreak archive pages (page-driven, no documented API yet)
- **African Risk Capacity (ARC)** — methodology and document enrichment

Each source is tagged in `public/data/sources.json` with auth status (`public`, `key_required`, `unknown`) so the registry is honest about what is actually free and ingestable.

## Architecture

```
GitHub (this repo) -> Netlify (static publish from public/)
                        ^
                        | git push (only after 02:00 verifier passes)
                        |
            +-----------+------------+
            |  Operator PC (local)   |
            |                        |
            |  01:00  scrape.mjs     |  -> data/YYYY-MM-DD/*.json
            |  02:00  verify-publish |  -> public/data/*.json -> commit + push
            +------------------------+
```

The local PC at `H:\TCG-Fabric\external\PublicHealthAlert\` is the canonical store. Daily raw archives (`data/`), run logs (`logs/`), and last-known-good state (`state/`) are not in git. Only normalized, published JSON in `public/data/` is committed.

## Repository layout

```
PublicHealthAlert/
├── public/                Netlify publish directory (static site)
│   ├── index.html
│   ├── styles.css
│   ├── app.js
│   └── data/              Published JSON consumed by the site
│       ├── events.json    Newest-first normalized event feed
│       ├── sources.json   Source registry + auth status
│       └── meta.json      Last update timestamp + counts
├── scripts/               Node.js automation (in git for transparency)
│   ├── scrape.mjs         01:00 orchestrator
│   ├── verify-publish.mjs 02:00 verifier + publisher
│   ├── normalize.mjs      Common-schema mapper
│   ├── sources/           Per-source connectors
│   └── lib/               Shared helpers
├── tasks/                 Windows Task Scheduler XML definitions
├── netlify.toml
└── package.json

# gitignored (local only):
├── data/                  Raw daily archives
├── logs/                  Run logs (scrape + verify)
└── state/                 ready_to_publish flag, last-known-good
```

## Operator commands

```bash
# Manual scrape (writes to data/YYYY-MM-DD/)
npm run scrape

# Manual verify + publish (commits + pushes if checks pass)
npm run verify

# Dry-run verify (no commit, no push)
npm run verify -- --dry
```

## Verifier safeguards

The 02:00 job blocks publish unless **all** of these pass:

- At least one source scraped successfully
- Required output files exist and are newer than the 01:00 run
- Event count is above a configurable minimum
- No fatal parser errors in the run log

If verification fails, the previous day's `events.json` (last-known-good) is republished and the failure is logged. The site never goes empty.

## Data integrity disclaimers

- Event records are derived from public-source ingestion and may lag publisher updates by up to 24 hours.
- This is **not** a substitute for clinical advice, official travel guidance, or emergency notifications. Always consult CDC, WHO, or your local public-health authority for action-relevant information.
- Source attribution is preserved on every record. Click through to the original publisher for the authoritative version.

## Contact

Operated by TCG Solutions. Issues or corrections: file a GitHub issue on this repo.
