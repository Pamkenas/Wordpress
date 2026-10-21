# WordPress Maintenance Skill

Read-only maintenance inventory for the agency's WordPress client sites. It collects core, **all** plugins and **all** themes from authenticated REST endpoints, stores timestamped snapshots, and (Weeks 3–4) produces the R1/R2/R3 reports. Run manually, never as an unattended agent. It never changes a client site.

**Status:** Weeks 1–2 of 5 are complete (see [Progress](#progress)).

## Quick start

```powershell
yarn install
yarn collect:sample          # demo run, no real sites: writes sample-output\snapshots\YYYY-MM-DD\
yarn verify                  # typecheck + 33 tests
```

Real sites:

```powershell
copy clients.example.json clients.json     # list sites (no secrets)
copy .env.example .env                     # one application password per site
yarn collect:dry-run                       # validates both files, sends nothing
yarn collect                               # writes snapshots\YYYY-MM-DD\<siteId>.json + _run.json
yarn collect --site acme-main              # one site
```

Options: `--config <file>`, `--out <dir>`, `--site <id>` (repeatable), `--concurrency <n>` (default 2), `--timeout <ms>` (default 15000), `--retries <n>` (default 2), `--dry-run`, `--sample`. Exit code `0` = all collected (some may be partial), `1` = config error, `2` = at least one site failed.

Each client site needs the **Agency Maintenance Status** plugin and a `maintenance-auditor` account. Follow [docs/05 onboarding](docs/05-status-endpoint.md#onboarding-a-client-site-checklist).

## Where everything lives

| Path | What | Where it runs / goes |
|---|---|---|
| `src/index.ts` | CLI entry: options, dry run, sample mode, summary | agency machine |
| `src/config.ts` | loads and validates `clients.json`; rejects secrets, unsafe ids, http | agency machine |
| `src/wordpress-client.ts` | GET-only REST client: auth, timeout, retries, no redirects, response validation | agency machine |
| `src/collect.ts` | per-site collection, normalisation, yes/no/unknown rules, bounded concurrency | agency machine |
| `src/snapshot.ts` | deterministic, atomic snapshot files + run summary | agency machine |
| `src/types.ts` | snapshot schema (v1) | agency machine |
| `src/sample/` | demo sites (mock WordPress server) for `--sample` and tests | agency machine |
| `wordpress-plugin/agency-maintenance-status/` | status endpoint + read-only auditor role | **copy to each client site:** `wp-content/plugins/agency-maintenance-status/` |
| `tools/setup-local-wordpress.php` | one-command setup of the local test site | run once against `C:\xampp\htdocs\wordpress` |
| `tests/` | 33 tests (`node --test`) | agency machine / CI |
| `docs/01–05` | field spec, report layouts, test environment, REST investigation, endpoint contract | repository |
| `samples/` | sample snapshot, R1 CSV, status response (demo data only) | repository |
| `clients.example.json`, `.env.example` | templates | copy to `clients.json` / `.env` |
| `clients.json`, `.env` | real site list and secrets | agency machine only, **git-ignored** |
| `snapshots/`, `reports/`, `sample-output/` | generated data | agency machine only, **git-ignored** |

## Documentation

1. [Field specification](docs/01-field-specification.md): every field, its source, and the yes/no/unknown rules
2. [Sample reports](docs/02-sample-reports.md): R1/R2/R3 contents, CSV columns, file names
3. [Test environment](docs/03-test-environment.md): local XAMPP instance, setup, verification results, troubleshooting
4. [REST permissions and update data](docs/04-rest-permissions-and-update-data.md): investigation findings
5. [Status endpoint](docs/05-status-endpoint.md): API contract, security model, client onboarding

## Security in one paragraph

GET requests only; the client has no write methods, and the tests assert that only GET is sent. Passwords live only in `.env`, read by the script; they never appear in `clients.json`, snapshots, logs, reports or Claude's context. HTTPS is required, except for an explicitly flagged local test site. TLS is always verified (the CLI refuses to run with `NODE_TLS_REJECT_UNAUTHORIZED=0`), and redirects are never followed with credentials. On the WordPress side the auditor account can't change anything: every non-GET request returns 403, verified against a real WordPress. One failing site (401/403/timeout) never stops the batch.

## Progress

| Week | Deliverable | Status |
|---|---|---|
| 1 | Confirm fields and sample reports | ✅ [01](docs/01-field-specification.md), [02](docs/02-sample-reports.md), [samples/](samples/) |
| 1 | Set up test WordPress instance | ✅ [03](docs/03-test-environment.md), `tools/setup-local-wordpress.php` |
| 1 | Investigate REST permissions and update transients | ✅ [04](docs/04-rest-permissions-and-update-data.md) |
| 2 | Build and secure minimal status endpoint | ✅ `wordpress-plugin/`, [05](docs/05-status-endpoint.md), guards verified live |
| 2 | Authenticated collector for core, all plugins, all themes | ✅ `src/`, 33 tests, live run on the local instance |
| 3 | Normalised snapshots, site config, license register, diffing, R1/R2 | next |
| 4 | Maintenance log, branded R3 PDF, SKILL.md, CLI invocation | |
| 5 | Test on 2–3 authorised sites, error cases, handover, demo | |
