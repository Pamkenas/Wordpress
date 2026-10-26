# 11 · Test report

Tested on 26 October 2026 on Windows 11, Node 24.22, XAMPP (PHP 8.2.12) and WordPress 7.1.3.

## Summary

| What | Result |
|---|---|
| Automated tests (`yarn verify`) | **102 of 102 pass** |
| Acceptance tests from the spec | **all pass** |
| Error cases | **pass** |
| Live tests on the local WordPress | **pass** |
| Security checks | **pass** |
| Final review | **7 problems found and fixed** |
| Test on 2–3 real client sites | **to do by the agency** (see below) |

## Acceptance tests from the spec

| Requirement | Result |
|---|---|
| A site with 15 plugins and no updates still lists all 15 in R2 and the CSV | pass |
| Inactive plugins and themes are listed. Unknown stays unknown | pass |
| A site with 403 or a timeout is marked failed. The other sites still get reports | pass (also live) |
| Changes between snapshots never appear in R3 as work, unless confirmed in the log | pass (also live) |
| Nothing is changed on any site. No passwords in files or reports | pass (also live) |
| Handover: install steps, settings, plugin install, security, tests, demo | done: [08](08-handover.md), [05](05-status-endpoint.md), [10](10-demo-script.md) |

## Error cases

All of these are automated tests:

- wrong password, no access (403), timeout, site down, broken HTTPS, wrong address
- redirect to another site (never followed)
- a firewall page instead of data, or data in the wrong shape
- too many requests (429) or a temporary server error (retried)
- status plugin missing or broken (`partial`)
- a site with 200 plugins
- names with `&amp;` (saved as `&`)
- an answer bigger than 5 MB (refused)
- control characters in error messages (removed)
- a wrong password, setting or URL in `clients.json`
- `allowInsecureHttp` for a site not on this computer (refused)
- wrong rows in `licenses.csv` or `maintenance_log.csv` (stops with the row number)
- CSV saved by Slovenian Excel (works), or not saved as UTF-8 (stops with a hint)
- missing settings files, a broken snapshot, a month without snapshots
- a report file open in Excel (a `PROBLEM` line, the other reports are written)

## Live tests on the local WordPress

| Test | Result |
|---|---|
| `yarn check-config` | "Everything looks ready." |
| wrong password | failed: `HTTP 401 incorrect_password` |
| wrong address | failed: `HTTP 404 … REST API not reachable` |
| closed port | failed: `network error: ECONNREFUSED` |
| very short timeout | failed: `timed out` |
| `http://` without the flag | refused before sending anything |
| `allowInsecureHttp` on a remote site | refused before sending anything |
| status plugin deactivated | failed with 403 (the fail-safe works) |
| old plugin 1.0.1 on the site | shown as `UPDATE -> 1.0.2` |
| `yarn monthly` | OK: 7 plugins, 3 themes, 0 updates |
| report with a test register and work log | R3 shows only the confirmed work, without internal notes |
| R1 CSV open in Excel during a report | one `PROBLEM` line, the other 9 files written |

The tests with wrong passwords ran in a scratch folder, so the real files were not touched.

## Security checks

Done live with the auditor's real password. The scripts printed only status codes.

| Attempt by the auditor | Result |
|---|---|
| read the plugin list and the status | allowed (200) |
| activate or delete a plugin | refused (403) |
| tricks: `?_method=POST`, `X-HTTP-Method-Override`, batch | refused (403) |
| write to the status address | refused (403) |
| read settings or user details | refused (403) |
| log in over XML-RPC | refused (403) |
| with a second role: use plugin rights outside a REST read | refused |
| anonymous visitor reads the status | refused (401) |

- Hello Dolly was inactive before and after all attempts, so nothing changed.
- An administrator still has all rights.
- A self-signed HTTPS certificate is refused.
- A scan with the real passwords found them in none of the 101 files Git would commit, the snapshots or the reports.

## Final review: problems found and fixed

| # | Problem | Fix |
|---|---|---|
| 1 | **Security:** with a second role (bbPress adds one automatically), the auditor could activate plugins | the guards now cover every account with the auditor role (plugin 1.0.2) |
| 2 | **Security:** XML-RPC accepted the auditor password, so it could post comments | XML-RPC logins are refused (plugin 1.0.2) |
| 3 | a report file open in Excel stopped all reports | that file becomes a `PROBLEM`, the others are written |
| 4 | names with `&` showed as `&amp;` | names are saved as plain text |
| 5 | `allowInsecureHttp` worked for any address | it works only on this computer |
| 6 | a broken site could send a huge answer, control characters or a bad date | refused, removed, or saved as unknown |
| 7 | a CSV not saved as UTF-8 garbled č, š and ž | the report stops with a hint |

**Sites with plugin 1.0.1 need 1.0.2.** The tool shows them as an update.

## Test on 2–3 real client sites (for the agency)

Pick 2–3 different sites, for example a small company site, a shop and a site with a premium plugin. For each site:

1. Install the plugin and create the user ([05 checklist](05-status-endpoint.md#add-a-client-site-checklist)).
2. Run `yarn check-config`, then `yarn collect --site <id> --details`.
3. Compare with wp-admin:
   - **Plugins:** the numbers *All*, *Active*, *Inactive*, *Must-Use* and *Drop-ins* match
   - **Themes:** every theme is listed
   - **Dashboard → Updates:** the same updates are listed
   - **Premium plugins** show `unknown`, never "up to date"
4. Check that writes are refused (curl asks for the password):

   ```powershell
   curl.exe -u maintenance-auditor -X POST https://client.example/wp-json/agency-maintenance/v1/status
   ```

   The answer should contain `"code":"agency_maintenance_read_only"` and `"status":403`.
5. Run `yarn report` and check that R2 and R3 are correct.
6. Fill in one row:

| Site | Date | Tester | Check OK | Collect status | Plugins match | Themes match | Updates match | Premium = unknown | Write refused | R2/R3 correct | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| | | | | | | | | | | | |
| | | | | | | | | | | | |
| | | | | | | | | | | | |

If something doesn't match, see [03 troubleshooting](03-test-environment.md#troubleshooting).

## Not tested yet

- real client sites (see above)
- WordPress multisite
- real premium plugins and real updates (tested with the fake WordPress)
- other operating systems than Windows 11

## Repeat the tests

| What | How |
|---|---|
| automated tests | `yarn verify` |
| demo | `yarn demo` |
| live run | start XAMPP, then `yarn check-config` and `yarn monthly` |
| set up the local site | see [03](03-test-environment.md) |
