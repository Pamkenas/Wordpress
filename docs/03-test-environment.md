# 03 · Test environment

A local WordPress for testing. It has no client data.

| Item | Value |
|---|---|
| Server | XAMPP on Windows (Apache, MySQL, PHP 8.2.12) |
| WordPress | 7.1.3 in `C:\xampp\htdocs\wordpress`, address `http://localhost/wordpress` |
| `wp-config.php` | must contain `define( 'WP_ENVIRONMENT_TYPE', 'local' );`, otherwise WordPress refuses application passwords over `http://` |
| Permalinks | "pretty" permalinks, so `/wp-json/` works |
| Node | 24 |

## Set it up once

1. Start **Apache** and **MySQL** in the XAMPP Control Panel.
2. In the project folder run:

   ```powershell
   C:\xampp\php\php.exe tools\setup-local-wordpress.php C:\xampp\htdocs\wordpress http://localhost/wordpress
   ```

   The script works only on a `local` site. It:
   - copies the status plugin to the site and activates it
   - creates the user `maintenance-auditor` with only the auditor role
   - creates an application password and saves it in `.env` as `WP_LOCAL_APP_PASSWORD` (it is never printed)

3. `copy clients.example.json clients.json` and keep only the `local-test` entry.
4. Test it:

   ```powershell
   yarn check-config
   yarn collect --site local-test --details
   ```

You can run the setup script again at any time. It updates the plugin and makes a new password.

## What the local site contains

- inactive plugins (Hello Dolly, Classic Editor) and inactive themes (Twenty Twenty-Four, Twenty Twenty-Three)
- no premium plugins and no old versions. Those cases are tested with the fake sites in `yarn demo` and `yarn test`.

To test a real pending update, upload an older plugin version, then open **Dashboard → Updates → Check again**.

The test results are in [11 · Test report](11-test-report.md).

## Troubleshooting

| Message | What to do |
|---|---|
| `HTTP 401 rest_not_logged_in ... did not receive the credentials` | the server drops the password. Add this line to `.htaccess` above the WordPress block: `SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1` |
| `HTTP 401 incorrect_password` | wrong or deleted application password. Make a new one (local: run the setup script again) |
| `HTTP 404 ... REST API not reachable at /wp-json/` | wrong address or plain permalinks. In wp-admin open Settings → Permalinks and click Save |
| `HTTP 404 rest_no_route ... status` | the status plugin is missing or not active. The result is `partial` |
| `"url" must use https://` | add `"allowInsecureHttp": true` to the site, but only for a test site on this computer |
| `"allowInsecureHttp" only works for a test site on this computer` | real sites need `https://`. The flag works only for `localhost`, `127.0.0.1`, `*.local` or `*.test` |
| `timed out` | the site was too slow. Wait a bit after starting XAMPP, or use `--timeout 60000` |
| `PROBLEM … could not be replaced (EPERM); is it open in Excel or a PDF viewer?` | close that file and run `yarn report` again. The other reports were written |
| `… is not saved as UTF-8` | open the CSV in Excel and save it with File → Save As → **CSV UTF-8** |
| MySQL stops at once, and `C:\xampp\mysql\data\mysql_error.log` says `Incorrect file format 'roles_mapping'` | a table was damaged when the computer shut down with MySQL running. With MySQL stopped, copy the three `roles_mapping.*` files from `C:\xampp\mysql\backup\mysql\` to `C:\xampp\mysql\data\mysql\` (keep the old ones somewhere safe), then start MySQL |

Always stop MySQL with the **Stop** button in the XAMPP Control Panel before you shut down the computer.
