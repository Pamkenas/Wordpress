# 11 · Test report (Week 5)

Tests run on 26 October 2026 on the development computer: Windows 11 Pro, Node 24.22, XAMPP (PHP 8.2.12) with WordPress 7.1.3.

## Summary

| Area | Result |
|---|---|
| Automated tests (`yarn verify`) | **94 of 94 pass**, plus the typecheck and the format check |
| Acceptance tests from the specification (§8) | **all covered, all pass** (section 1) |
| Error cases | **pass**: automated (section 2) and live (section 3) |
| Live tests on the local WordPress | **pass** (section 3) |
| Security checks | **pass** (section 4) |
| Tests on 2–3 authorised client sites | **to be done by the agency**. They need access to real client sites, which the development computer doesn't have. Checklist and record table: section 5. |

## 1. Acceptance tests from the specification

| Requirement (§8) | Checked by | Result |
|---|---|---|
| A site with 15 plugins and zero pending updates lists all 15 in its internal report and in the CSV | `collect.test.ts`: "a site with 15 plugins and zero pending updates still lists all 15"; `reports.test.ts`: "the site with 15 plugins and zero updates lists all 15 in its R2 report and in the R1 CSV" | pass |
| Inactive plugins and themes are included; unknown license and update states stay unknown | `collect.test.ts`: "inactive plugins and inactive themes are included" and "premium, stale and newly installed plugins are unknown, never 'no'"; `reports.test.ts`: "inactive plugins and themes are included; unknown license and update states stay unknown" | pass |
| A site returning 403 or timing out is marked failed, and the other sites still get their reports | `collect.test.ts`: "a site returning 403 is marked failed and the other sites are still collected" and "a site that times out is marked failed and the other sites are still collected"; `reports.test.ts`: "a site returning 403 is marked failed and every other site still gets its reports"; live: L2–L5 in section 3 | pass |
| Snapshot differences never appear in the client report as work unless they are in the confirmed log | `reports.test.ts`: "observed changes are in R2 but never appear in R3 as work" and "a WordPress auto-update seen between snapshots is not claimed as work"; live: L10 in section 3 | pass |
| No backup, update or other state-changing operation; no secrets in files or reports | `collect.test.ts`: "a full collection run sends nothing but GET requests"; `snapshot.test.ts`: "snapshots get deterministic names, are replaced on re-run, and contain no secrets"; `reports.test.ts`: "written files and the summary contain no credentials"; live: section 4 | pass |
| Handover: install steps, sample configuration, endpoint installation, security notes, tests, 10-minute demo | [08 Handover](08-handover.md), [05 Status endpoint](05-status-endpoint.md), [10 Demo script](10-demo-script.md) and this report | done |

## 2. Error cases (automated, part of every `yarn verify`)

The rule: if the plugin list can't be read, the site is `failed` and nothing more is asked. If only the themes or the status endpoint can't be read, the site is `partial`. Either way, the other sites carry on.

| Case | What happens | Test file |
|---|---|---|
| wrong application password | login error: HTTP 401 `incorrect_password` | `wordpress-client.test.ts` |
| no access (403) | `failed`, not retried, the other sites are still collected | `collect.test.ts`, `wordpress-client.test.ts` |
| site doesn't answer in time | `failed` (timeout), nothing more is asked, the other sites are still collected | `collect.test.ts`, `negative.test.ts` |
| site unreachable | network error | `wordpress-client.test.ts` |
| HTTPS doesn't work | TLS error, not retried | `negative.test.ts` |
| wrong site address (no REST API there) | HTTP 404 with the hint "REST API not reachable at /wp-json/" | `negative.test.ts` |
| redirect to another host | not followed, so the password can't reach that host | `wordpress-client.test.ts` |
| firewall HTML page instead of JSON | "expected JSON" error, no crash | `wordpress-client.test.ts` |
| JSON of the wrong shape | rejected as an invalid response | `wordpress-client.test.ts` |
| rate limit (429) or temporary server error (503) | retried, then succeeds | `wordpress-client.test.ts`, `collect.test.ts` |
| status plugin missing, or broken (HTTP 500) | `partial`: full inventory, every update state unknown | `collect.test.ts`, `negative.test.ts` |
| themes can't be read | `partial`; R2 says "Themes could not be read", never "No themes installed" | `reports.test.ts` |
| password variable missing from `.env` | `failed` without sending any request | `collect.test.ts` |
| a site with 200 plugins | all 200 listed | `negative.test.ts` |
| plugin names like `constructor` or `toString` | can't trick the update check | `negative.test.ts` |
| password written into `clients.json` | refused, with a pointer to `.env` | `config.test.ts` |
| `http://` without the local-test flag | refused | `config.test.ts` |
| unsafe or duplicate site ids; URLs with a password, query or fragment | refused | `config.test.ts` |
| wrong values in `licenses.csv` (unknown status, bad date, duplicate row) or `maintenance_log.csv` (unknown action, bad date, half-filled confirmation, confirmation before the work) | rejected with the reason | `register.test.ts` |
| `yarn report` with a broken `licenses.csv` or `maintenance_log.csv` | stops with exit code 1: "… is invalid", "row 2: …" | `negative.test.ts` |
| CSV saved by Slovenian Excel (`;`, dates like `7. 10. 2026`) | read correctly | `csv-dates.test.ts`, `negative.test.ts` |
| missing `clients.json` or `agency.json` | stops and says which template to copy | `negative.test.ts` |
| corrupt snapshot file | only that site has a problem; all other reports are written | `negative.test.ts` |
| no snapshot in the month | every site reported as "not collected" | `reports.test.ts` |
| certificate checks switched off (`NODE_TLS_REJECT_UNAUTHORIZED=0`) | the program refuses to run | `snapshot.test.ts` |
| unknown command or bad `--period` | usage help, exit code 1 | `snapshot.test.ts` |

## 3. Live tests on the local WordPress

WordPress 7.1.3 on XAMPP, account `maintenance-auditor`, status plugin 1.0.1. All runs used the final code.

| # | Test | Result |
|---|---|---|
| L1 | `yarn wpm check` | "Everything looks ready." Two notes: `licenses.csv` and `maintenance_log.csv` don't exist yet, so every license is unknown and no work is reported |
| L2 | wrong password | `failed`: "HTTP 401 incorrect_password: The provided password is an invalid application password." |
| L3 | wrong address `http://localhost/wordpress-does-not-exist` | `failed`: "HTTP 404 … REST API not reachable at /wp-json/ (check permalinks and the site URL)" |
| L4 | closed port `http://localhost:5999` | `failed`: "network error: ECONNREFUSED" |
| L5 | `--timeout 100` (less time than WordPress needs to answer) | `failed`: "timed out" |
| L6 | an `http://` site without `allowInsecureHttp` | refused before any request is sent: `"url" must use https://`, exit code 1 |
| L7 | status plugin deactivated | `failed`: "HTTP 403 rest_cannot_view_plugins" (the fail-safe works) |
| L8 | status plugin activated again | `OK` again |
| L9 | `yarn monthly` | `OK`: 7 plugins, 3 themes, 0 updates, 0 unknown. October reports written (R1 PDF + CSV, R2, R3), exit code 0 |
| L10 | `yarn report` with a test register and a test work log | see below |

L2, L3 and L4 ran together as one batch of three sites, and the batch finished all three. L2–L6 ran in a scratch folder with dummy passwords, so the real `snapshots/` folder only holds good runs.

**L10 in detail.** This ran in a scratch folder, on copies of the real snapshots, so the real files were not touched.

- **Test register:** saved with `;` and Slovenian dates (`26. 10. 2026`). One row has a deliberate typo: `classic-editor`.
- **Test work log:**
  - one confirmed row: the status plugin updated from 1.0.0 to 1.0.1, with an internal note;
  - one unconfirmed row: installing Query Monitor.

| Report | What it showed |
|---|---|
| R3 (client) | Only the confirmed work: "Posodobitev: Agency Maintenance Status (1.0.0 › 1.0.1)". The internal note and the unconfirmed row are not there. |
| R2 (internal) | The observed change from 1.0.0 to 1.0.1 under "Detected changes (observations)", the confirmed row with its internal note, the unconfirmed row under "Unconfirmed log entries", and "Did you mean classic-editor/classic-editor.php?" for the typo. The register dates were read as 2026-10-26. |

## 4. Security checks

Live on the local WordPress, with the auditor's real application password. The probe script printed only the status codes.

| Request | Expected | Result |
|---|---|---|
| anonymous GET status endpoint | refused | 401 `rest_forbidden` |
| auditor GET status endpoint | allowed | 200 |
| auditor GET plugin list | allowed | 200 |
| auditor POST: activate Hello Dolly | refused | 403 `agency_maintenance_read_only` |
| auditor GET with `?_method=POST` (activate) | refused | 403 `agency_maintenance_read_only` |
| auditor GET with the header `X-HTTP-Method-Override: POST` | refused | 403 `agency_maintenance_read_only` |
| auditor DELETE Hello Dolly | refused | 403 `agency_maintenance_read_only` |
| auditor POST `/batch/v1` (activate inside a batch) | refused | 403 `agency_maintenance_read_only` |
| auditor POST to the status endpoint (the check in section 5) | refused | 403 `agency_maintenance_read_only` |
| auditor GET settings | refused | 403 `rest_forbidden` |
| auditor GET user details (`context=edit`) | refused | 403 `rest_forbidden_context` |
| Hello Dolly before and after all attempts | unchanged | inactive both times |

Other checks:

- **Self-signed HTTPS certificate:** refused with "TLS error DEPTH_ZERO_SELF_SIGNED_CERT". This was a one-off check with a throwaway certificate.
- **Simplified plugin code (23 October):** the old and the new plugin were run side by side on the same inputs and gave identical results. The inputs covered the status data and every guard, for every combination of role, HTTP method and override trick.
- **No passwords in files:** snapshots, reports, the CSV and `_report.json` contain no password (automated tests). `yarn wpm check` prints only the name of each password variable and "(set)". A scan with the real passwords found none of them in the 105 files Git would commit, or in the real snapshots and reports.
- **Git:** `.env`, `clients.json`, `licenses.csv`, `maintenance_log.csv`, `snapshots/` and `reports/` are git-ignored, and none of them is in the repository.

## 5. Tests on 2–3 authorised client sites (to be done by the agency)

The development computer has no access to client sites, so this part needs someone from the agency with authorised access. Choose 2–3 different sites, for example a small company site, a WooCommerce shop and a site with a premium plugin.

For each site:

1. Install the status plugin and create the auditor account ([05 checklist](05-status-endpoint.md#onboarding-a-client-site-checklist)).
2. Run `yarn check-config`, then `yarn collect --site <id> --details`.
3. Compare the list with wp-admin:
   - **Plugins page:** the counts *All*, *Active*, *Inactive*, *Must-Use* and *Drop-ins* match.
   - **Appearance → Themes:** every theme is listed.
   - **Dashboard → Updates:** the same updates are listed. Opening this page makes WordPress check for updates again. If it shows more updates, run the collect command again and compare once more.
   - **Premium plugins** with their own updater show `unknown (… verify manually)`, never "up to date".
4. Check that the auditor account can't write. Run this in PowerShell, replacing `client.example` with the site's address:

   ```powershell
   curl.exe -u maintenance-auditor -X POST https://client.example/wp-json/agency-maintenance/v1/status
   ```

   - curl asks for the application password (the one in `.env`), so the password isn't saved in the command history.
   - The expected answer is `{"code":"agency_maintenance_read_only", … "status":403}`.
   - This address has no write function, so the check can't change anything, even if something were wrong.
5. Run `yarn report`. Read R2 and R3 and check that they describe the site correctly.
6. Fill in one row of the table below.

| Site | Date | Tester | `check` OK | Collect status | Plugins match | Themes match | Updates match | Premium = unknown | Write refused (403) | R2/R3 correct | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |
| | | | | | | | | | | | |
| | | | | | | | | | | | |

If something doesn't match, write down the plugin and what wp-admin shows, then see [03 troubleshooting](03-test-environment.md#troubleshooting).

## 6. What these tests don't cover yet

- **Real client sites:** see section 5.
- **WordPress multisite:** not tested.
- **Real premium plugins, and a real pending update from wordpress.org:** both are simulated with the built-in fake WordPress. The local site has no paid plugins and no outdated plugins.
- **Other operating systems:** developed and tested on Windows 11 only.

## 7. How to repeat these tests

| What | How |
|---|---|
| all automated tests | `yarn verify` |
| the demo | `yarn demo`, then open `sample-output\reports\2026-10\` |
| the live run | start Apache and MySQL in XAMPP, then `yarn check-config` and `yarn monthly` |
| set up the local test site from scratch | `C:\xampp\php\php.exe tools\setup-local-wordpress.php C:\xampp\htdocs\wordpress http://localhost/wordpress` (see [03](03-test-environment.md)) |
