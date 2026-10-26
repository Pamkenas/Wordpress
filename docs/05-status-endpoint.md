# 05 · Status plugin and adding a client site

The plugin is in [wordpress-plugin/agency-maintenance-status/](../wordpress-plugin/agency-maintenance-status/). Version **1.0.2**. It is one PHP file and needs PHP 7.4+ and WordPress 5.6+.

## What it does

It adds one read-only address:

```
GET /wp-json/agency-maintenance/v1/status
```

It returns the WordPress version, the saved update lists, must-use plugins and drop-ins. A real answer is in [samples/status-endpoint.sample.json](../samples/status-endpoint.sample.json).

| Answer | When |
|---|---|
| 200 | the user is an administrator or the maintenance auditor |
| 401 | not logged in |
| 403 | logged in, but without the right |
| 404 | the plugin is not active (the tool reports `partial`) |

It also adds the role **Maintenance Auditor (read-only)**. Why it is safe: [04](04-rest-permissions-and-update-data.md#the-solution-a-read-only-auditor-role).

## Security

- It only reads. It has no write code and never starts an update check.
- The auditor account gets 403 for every write and can't log in over XML-RPC, even with a second role.
- If the plugin is deactivated, the role is removed and the account can do nothing.
- It returns no PHP version, paths, users or license keys.
- Real sites must use HTTPS.

## Add a client site (checklist)

Do this only for sites the agency is **allowed** to maintain.

1. **Install the plugin.** Zip the folder `wordpress-plugin/agency-maintenance-status/` and upload it under Plugins → Add New → Upload. Activate it.
2. **Create the user.** Users → Add New:
   - username `maintenance-auditor`
   - role **Maintenance Auditor (read-only)**, no other role
   - a random password that nobody keeps
3. **Create the application password.** Users → maintenance-auditor → Application Passwords → name `Agency maintenance collector` → Add. Copy it once into `.env` as `WP_<SITE>_APP_PASSWORD=...`. Never paste it into chat, e-mail or Claude.
4. **Add the site** to `clients.json`:

   ```json
   { "siteId": "acme-main", "clientId": "acme", "clientName": "Acme d.o.o.",
     "url": "https://www.example.com", "username": "maintenance-auditor",
     "passwordEnv": "WP_ACME_MAIN_APP_PASSWORD" }
   ```

5. **Test:** `yarn check-config`, then `yarn collect --site acme-main`. You should see `OK`.
6. **Check that writes are refused** (recommended). In PowerShell:

   ```powershell
   curl.exe -u maintenance-auditor -X POST https://www.example.com/wp-json/agency-maintenance/v1/status
   ```

   curl asks for the password, so it isn't saved. The answer should contain `"code":"agency_maintenance_read_only"` and `"status":403`. This can't change anything.

## Update the plugin

If a site has an older version, `yarn collect` shows it as an update (for example `UPDATE -> 1.0.2`). Copy the new folder over the old one, then run `yarn collect --site <id>` again.

## Remove access

Delete the application password, or deactivate the plugin, or delete the user.
