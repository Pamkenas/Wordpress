# WordPress Maintenance Skill


## Quick start

```powershell
yarn install
yarn demo                  # demo sites, no real sites: snapshots + all reports in sample-output\
yarn verify                # typecheck + format check + 81 tests
```

Real sites:

```powershell
copy clients.example.json clients.json              # site list (no secrets)
copy .env.example .env                              # one application password per site
copy agency.example.json agency.json                # agency name, colour, logo, client report language
copy licenses.example.csv licenses.csv              # optional: license register
copy maintenance_log.example.csv maintenance_log.csv  # optional: confirmed work log
yarn check-config                                   # checks everything, sends nothing
yarn monthly                                        # collect + report for this month
```

| Command | Does |
|---|---|
| `yarn check-config` | validates every input file and that each password variable is set |
| `yarn collect [--site id] [--details]` | writes `snapshots\YYYY-MM-DD\<siteId>.json` + `_run.json` |
| `yarn report [--period YYYY-MM]` | writes `reports\YYYY-MM\` (R1 PDF + CSV, R2 and R3 per site, `_report.json`) |
| `yarn monthly` | collect, then report |
| `yarn demo` | the same with the built-in demo sites |
| `yarn wpm <check\|collect\|report\|run> [options]` | one entry point for everything (`yarn wpm --help`) |

Exit codes: `0` done, `1` configuration or usage error, `2` a site failed or a report could not be written (the other sites are still processed).

Each client site needs the **Agency Maintenance Status** plugin and a `maintenance-auditor` account: [docs/05 onboarding](docs/05-status-endpoint.md#onboarding-a-client-site-checklist).

## Where everything lives

| Path | What | Where it runs / goes |
|---|---|---|
| `src/index.ts` | command line: `check`, `collect`, `report`, `run` | agency machine |
| `src/workflow.ts` | collection runs for real sites and for the demo | agency machine |
| `src/config.ts` | loads and validates `clients.json`; rejects secrets, unsafe ids, http | agency machine |
| `src/wordpress-client.ts` | GET-only REST client: auth, timeout, retries, no redirects, response validation | agency machine |
| `src/collect.ts` | per-site collection, normalisation, yes/no/unknown rules, bounded concurrency | agency machine |
| `src/snapshot.ts` | writes, lists, reads back and validates snapshots; picks the current and baseline snapshot of a month | agency machine |
| `src/diff.ts` | changes between two snapshots (observations, never "work") | agency machine |
| `src/agency.ts` | loads `agency.json` (branding, language, CSV delimiter) | agency machine |
| `src/agency-plugin.ts` | compares the status plugin on each site with the version in this repository | agency machine |
| `src/csv.ts`, `src/dates.ts`, `src/files.ts` | CSV read/write (Excel-safe), date handling, atomic file writes | agency machine |
| `src/licenses.ts` | loads and validates `licenses.csv`; expiry check | agency machine |
| `src/maintenance-log.ts` | loads and validates `maintenance_log.csv`; confirmed vs unconfirmed | agency machine |
| `src/report-model.ts` | everything a report needs for one site, as plain data | agency machine |
| `src/reports/` | `generate.ts` (writes all files), `r1.ts`, `r2.ts`, `r3.ts`, `pdf.ts` (fonts, layout, security policies), `text.ts` (R3 texts, en + sl) | agency machine |
| `src/types.ts` | snapshot schema (v1) | agency machine |
| `src/sample/` | demo sites (mock WordPress server) for `--sample` and the tests | agency machine |
| `wordpress-plugin/agency-maintenance-status/` | status endpoint + read-only auditor role | **copy to each client site:** `wp-content/plugins/agency-maintenance-status/` |
| `.claude/skills/wordpress-maintenance/SKILL.md` | the Claude Code skill (manually invoked) | stays in this project |
| `tools/setup-local-wordpress.php` | one-command setup of the local test site | run once against `C:\xampp\htdocs\wordpress` |
| `tests/` | 81 tests (`node --test`), including every acceptance test from the spec | agency machine / CI |
| `docs/01–07`, `docs/images/` | field spec, reports, test environment, REST investigation, endpoint, register and log, monthly workflow | repository |
| `samples/` | demo inputs (`agency`, `licenses`, `maintenance_log`) and outputs (snapshot, R1 CSV, status response) | repository |
| `*.example.*`, `.env.example` | templates | copy without `.example` |
| `agency.json` | agency branding (not secret) | repository or agency machine |
| `clients.json`, `.env`, `licenses.csv`, `maintenance_log.csv` | real sites, secrets, client data | agency machine only, **git-ignored** |
| `snapshots/`, `reports/`, `sample-output/` | generated data | agency machine only, **git-ignored** |
