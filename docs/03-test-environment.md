# 03 · Test environment (Week 1)

Local WordPress used for development and acceptance tests. It holds no client data.

| Item | Value |
|---|---|
| Stack | XAMPP on Windows: Apache, MariaDB, PHP 8.2.12 |
| WordPress | 7.1.3 in `C:\xampp\htdocs\wordpress`, URL `http://localhost/wordpress` |
| Environment type | `define( 'WP_ENVIRONMENT_TYPE', 'local' );` in `wp-config.php`. **Required**: WordPress only allows application passwords over plain http when the type is `local` (`wp_is_application_passwords_supported()`, wp-includes/user.php:5155) |
| Permalinks | pretty permalinks (`.htaccess` present), so `/wp-json/` works |
| Node | 24.x (runs the TypeScript sources directly) |

## Test data on the instance

| Scenario (acceptance test) | Item on the local site |
|---|---|
| inactive plugin is listed | Classic Editor, CleanTalk, Hello Dolly (both copies) |
| inactive theme is listed | Twenty Twenty-Four, Twenty Twenty-Three |
| plugin not yet in the update check → unknown | Agency Maintenance Status, until WordPress' next check |
| premium plugin / pending updates / stale check | not reproducible locally without paid plugins or old versions, so covered by the mock sites (`yarn collect:sample`, `yarn test`) |
| 403 / timeout | covered by the mock sites, and also tested live on 2026-10-26 ([11](11-test-report.md#3-live-tests-on-the-local-wordpress)) |

To create a pending update locally, install an older plugin version (for example, download an older Akismet zip from wordpress.org and upload it), then open **Dashboard → Updates → Check again**.

## One-time setup (reproducible)

1. Start **Apache** and **MySQL** in the XAMPP Control Panel.
2. From the project folder run:

   ```powershell
   C:\xampp\php\php.exe tools\setup-local-wordpress.php C:\xampp\htdocs\wordpress http://localhost/wordpress
   ```

   The script ([tools/setup-local-wordpress.php](../tools/setup-local-wordpress.php)) refuses to run unless the site is `local`. It:
   - copies `wordpress-plugin/agency-maintenance-status/` to `wp-content/plugins/` and activates it
   - creates the user `maintenance-auditor` with **only** the role *Maintenance Auditor (read-only)* and a random 64-character password that nobody knows
   - creates the application password *Agency maintenance collector (local test)* and writes it to `.env` as `WP_LOCAL_APP_PASSWORD`. It is never printed.

3. `copy clients.example.json clients.json`, then keep only the `local-test` entry (it has `"allowInsecureHttp": true`).
4. Check and run:

   ```powershell
   yarn collect:dry-run      # config + .env check, no requests
   yarn collect              # writes snapshots\YYYY-MM-DD\local-test.json
   ```

Re-running the setup script is safe: it updates the plugin files, resets the user's role and replaces the application password.

## Verified on 2026-10-21

| Check | Result |
|---|---|
| Collector, auditor account | `success`: 7 plugins (4 inactive), 3 themes (2 inactive), core 7.1.3, 0 updates, 1 unknown (the newly installed status plugin) |
| Anonymous GET status endpoint | 401 `rest_forbidden` |
| Auditor POST `/wp/v2/plugins/hello` (activate) | 403 `agency_maintenance_read_only` |
| Auditor GET with `?_method=POST` / `X-HTTP-Method-Override: POST` | 403 `agency_maintenance_read_only` |
| Auditor DELETE plugin, POST `/batch/v1` | 403 `agency_maintenance_read_only` |
| Auditor GET `/wp/v2/settings`, `/wp/v2/users?context=edit` | 403 (no other privileges) |
| Hello Dolly after all write attempts | still inactive |
| Status plugin deactivated → collector | `failed`, 403 on plugins and themes (role removed, fail-safe) |
| Reactivated → collector | `success` again |

## Verified on 2026-10-23 (Weeks 3–4)

| Check | Result |
|---|---|
| `yarn wpm check` | clients.json, password variable, agency.json and snapshots OK; missing `licenses.csv` and `maintenance_log.csv` shown as notes |
| `yarn wpm run` | collection `success`, reports for 2026-10 written: R1 PDF + CSV, R2 and R3 for `local-test`, `_report.json` |
| Agency plugin 1.0.0 on the site, 1.0.1 in the repository | reported as an update (`1.0.0 → 1.0.1`), not as unknown |
| After copying 1.0.1 to the site | 0 updates, 0 unknown. R2 lists the change 1.0.0 → 1.0.1 under "Detected changes (observations)" against the 2026-10-21 snapshot. R3 shows no work (none was logged) and "no open issues". |
| Licenses and work without register or log files | every license `unknown`, R3 "no maintenance work recorded". No test records were invented in the real files. |

## Verified on 2026-10-26 (Week 5)

Error cases, the read-only checks and a report with a test register and log: see [11 · Test report](11-test-report.md), sections 3 and 4.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `HTTP 401 rest_not_logged_in ... did not receive the credentials` | Apache/PHP-CGI drops the `Authorization` header. Add to `.htaccess` above the WordPress block: `SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1` |
| `HTTP 401 incorrect_password` | wrong or revoked application password; re-run the setup script (local) or create a new one |
| `HTTP 404 ... REST API not reachable at /wp-json/` | plain permalinks or a wrong URL; enable pretty permalinks (Settings → Permalinks → Save) |
| `HTTP 404 rest_no_route ... status` | status plugin not installed or not active. Result is `partial`, with every update state unknown |
| `"url" must use https://` | add `"allowInsecureHttp": true` to the site entry, but only for a local test instance |
| MySQL in XAMPP stops at once; `C:\xampp\mysql\data\mysql_error.log` says `Can't open and lock privilege tables: Incorrect file format 'roles_mapping'` | a system table was damaged by an unclean stop (computer shut down while MySQL ran). With MySQL stopped, copy the three `roles_mapping.*` files somewhere safe, copy the same three from `C:\xampp\mysql\backup\mysql\` into `C:\xampp\mysql\data\mysql\`, then start MySQL. The table is empty in a default XAMPP, so nothing is lost. Always stop MySQL with the XAMPP Control Panel's **Stop** button before shutting down. (Fixed this way on 2026-10-23; the damaged copies are in `C:\xampp\mysql\roles_mapping-damaged-2026-10-23\`.) |
