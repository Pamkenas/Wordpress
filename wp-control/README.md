# WP Control

Two WordPress plugins for managing client websites, built from the "WP Control – Concept specification".

| Plugin | Install it on | What it does |
|---|---|---|
| **WP Control Manager** | the agency's WordPress | the dashboard: websites, clients, updates, backups, security checks, detected changes, maintenance log, CSV export |
| **WP Control Agent** | every client website | lets the Manager read the site. It can't change anything |

## Where to put the folders

- **Agency WordPress:** copy the folder `wp-control-manager` to `wp-content/plugins/`, then activate **WP Control Manager** under Plugins.
- **Every client website:** copy the folder `wp-control-agent` to `wp-content/plugins/` (or zip it and use Plugins → Add New → Upload), then activate **WP Control Agent**.

## Connect a website

1. On the client website: **WP Control → Connection → Create connection key**. Copy the key. It is shown only once.
2. On the agency website: **WP Control → Websites → Add website**. Enter the name, the address, the client and the key.
3. WP Control reads the website at once, and then every hour (see Settings).

## Try it on this computer

Start Apache and MySQL in XAMPP, then run these in the `wp-control` folder:

```powershell
C:\xampp\php\php.exe tools\setup-test-sites.php
C:\xampp\php\php.exe tools\demo-data.php
```

- The first command creates three test sites: `wpc-manager` (agency), `wpc-client-a` and `wpc-client-b` (clients). The login is in `wp-control/.env` (`WPC_TEST_USER` and `WPC_TEST_PASSWORD`).
- The second command fills the dashboard with demo data.
- Then open http://localhost/wpc-manager/wp-admin/admin.php?page=wp-control

## Tests

```powershell
C:\xampp\php\php.exe tests\run-tests.php
C:\xampp\php\php.exe tests\http-check.php
C:\xampp\php\php.exe tests\soak-and-security.php --minutes 10
C:\xampp\php\php.exe tests\load-test.php --target all --concurrency 50 --seconds 60
```

- `run-tests.php`: 27 tests. They talk to the two client sites over real HTTP (signatures, change detection, backups, maintenance log, CSV, screens, permissions, uninstall).
- `http-check.php`: 24 checks like a browser does them: login, forms, nonces, CSV download.
- `soak-and-security.php`: tries many bad requests against the Agent and checks each one is refused, checks the Manager pages and API, checks keys are stored encrypted, then hammers the sites for a while watching for PHP errors, a lost database, slow answers or a growing nonce store. It only reads; it changes nothing. Use `--minutes 0` for the security checks alone, `--minutes 60` for a long run, `--sync` to also sync each cycle. Stop early with Ctrl-C or by creating `tests\soak.stop`.
- `load-test.php`: fires many requests at the same time to see if the sites slow down, return errors or fall over, then checks they recover. `--target` is `agent`, `dashboard`, `front` or `all`; `--concurrency` is how many run at once (default 30); `--seconds` is how long per target (default 30). It only reads. A heavy run can crash MySQL on this machine; if it does, see the repair steps in the notes.
- The first two tests reset the three test sites. Never point them at a real site; they refuse anything that isn't `http://localhost/wpc-manager`.

## Security

- **Read-only:** the Agent has one address and only answers signed GET requests.
- **Signed requests:** every request is signed with the website's own key (HMAC-SHA256) and a time stamp. Old, copied or changed requests are refused. The answer is signed too.
- **The key never travels:** only signatures are sent. The Manager stores the keys encrypted.
- **HTTPS:** required. Plain `http://` works only for a test site on this computer. Redirects are never followed.
- **Access:** only administrators can open the Manager. Every form is protected with a nonce, and every action is written to Activity → Audit history.
- **Honest history:** a detected change shows *what* changed, not *who* changed it. It stays "Not documented" until someone links it to a maintenance record.

## Not built yet

As the spec says, these come later:

- installing updates and running backups from the dashboard
- scanning for known vulnerabilities
- notifications

Also: backups are read from UpdraftPlus; other backup plugins are only detected. The screens are in English. Multisite is not tested.
