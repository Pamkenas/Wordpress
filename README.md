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

In Claude Code, type `/wordpress-maintenance run` (or `check`, `report 2026-10`, `demo`). See [docs/07](docs/07-monthly-workflow.md#with-claude-code).

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

## Documentation

1. [Field specification](docs/01-field-specification.md): every field, its source, the yes/no/unknown rules, `agency.json`
2. [Reports R1, R2, R3](docs/02-sample-reports.md): contents, CSV columns, file names, which snapshots are used, preview images
3. [Test environment](docs/03-test-environment.md): local XAMPP instance, setup, verification results, troubleshooting
4. [REST permissions and update data](docs/04-rest-permissions-and-update-data.md): investigation findings
5. [Status endpoint](docs/05-status-endpoint.md): API contract, security model, client onboarding
6. [License register and maintenance log](docs/06-license-register-and-maintenance-log.md): formats, rules, Excel tips
7. [Monthly workflow](docs/07-monthly-workflow.md): runbook, Claude skill, adding a site, credentials, re-running

## Security in one paragraph

GET requests only; the client has no write methods, and the tests assert that only GET is sent. Passwords live only in `.env`, read by the script; they never appear in `clients.json`, snapshots, logs, reports or Claude's context, and the skill is told never to open `.env`. HTTPS is required except for an explicitly flagged local test site. TLS is always verified, and redirects are never followed with credentials. On the WordPress side the auditor account can't change anything: every non-GET request returns 403, verified against a real WordPress. One failing site never stops the batch. PDFs are generated with network and file access locked to the bundled fonts. CSV cells that could run as Excel formulas are neutralised. The client report contains only confirmed work, with no internal notes, error details or other clients; this is enforced by tests.

## Progress

| Week | Deliverable | Status |
|---|---|---|
| 1 | Confirm fields and sample reports | ✅ [01](docs/01-field-specification.md), [02](docs/02-sample-reports.md), [samples/](samples/) |
| 1 | Set up test WordPress instance | ✅ [03](docs/03-test-environment.md), `tools/setup-local-wordpress.php` |
| 1 | Investigate REST permissions and update transients | ✅ [04](docs/04-rest-permissions-and-update-data.md) |
| 2 | Build and secure minimal status endpoint | ✅ `wordpress-plugin/`, [05](docs/05-status-endpoint.md), guards verified live |
| 2 | Authenticated collector for core, all plugins, all themes | ✅ `src/collect.ts`, `src/wordpress-client.ts`, live run on the local instance |
| 3 | Normalised snapshots, site config, license register, diffing, R1 + R2 | ✅ `src/snapshot.ts`, `src/agency.ts`, `src/licenses.ts`, `src/diff.ts`, `src/reports/`, [06](docs/06-license-register-and-maintenance-log.md) |
| 4 | Confirmed maintenance log, branded R3 PDF, SKILL.md, command line | ✅ `src/maintenance-log.ts`, `src/reports/r3.ts`, `.claude/skills/…/SKILL.md`, `src/index.ts`, [07](docs/07-monthly-workflow.md) |
| 5 | Test on 2–3 authorised sites, error cases, handover, demo | next |
