# 05 · Status endpoint and client-site onboarding (Week 2)

Plugin: [wordpress-plugin/agency-maintenance-status/](../wordpress-plugin/agency-maintenance-status/) (single PHP file, no dependencies, PHP ≥ 7.4, WordPress ≥ 5.6, single-site installs).

## API contract

```
GET /wp-json/agency-maintenance/v1/status
Authorization: Basic base64(maintenance-auditor:<application password>)
```

| Status | When |
|---|---|
| 200 | caller has `view_agency_maintenance_status` (Administrator, Maintenance Auditor) |
| 401 `rest_forbidden` | not authenticated |
| 403 `rest_forbidden` | authenticated without the capability |
| 404 `rest_no_route` | plugin not active (collector: `partial`) |

Response headers: `Cache-Control: no-store, private`. Response body, with illustrative values (real output from the local instance: [samples/status-endpoint.sample.json](../samples/status-endpoint.sample.json)):

```jsonc
{
  "schemaVersion": 1,                 // the collector rejects other versions as invalid-response
  "pluginVersion": "1.0.0",
  "generatedAt": "2026-10-21T07:29:15+00:00",
  "core": {
    "installed": "7.1.3",
    "checked": true,                  // false: never checked, or checked before the current version was installed
    "offered": null,                  // newest "upgrade"/"autoupdate" offer above installed, else null
    "lastChecked": 1792567635         // unix time of update_core.last_checked, or null
  },
  "plugins": {                        // from update_plugins; keys are plugin basenames
    "checked": true,
    "lastChecked": 1792567642,
    "updates": { "woocommerce/woocommerce.php": "10.2.2" },
    "noUpdate": ["akismet/akismet.php", "hello.php"],
    "checkedVersions": { "akismet/akismet.php": "5.7.2", "hello.php": "1.7.2", "woocommerce/woocommerce.php": "10.0.4" }
  },
  "themes": { "...": "same shape, keyed by stylesheet" },
  "mustUsePlugins": [{ "file": "hosting-cache-helper.php", "name": "Hosting Cache Helper", "version": "1.2.0" }],
  "dropins": [{ "file": "object-cache.php", "name": "Redis Object Cache Drop-In", "version": "2.6.5" }]
}
```

The endpoint passes WordPress' cached facts through unchanged. The interpretation (yes/no/unknown) happens in the collector, so the rules can change without redeploying the plugin to every client site.

## Security model

| Requirement (spec §6) | How |
|---|---|
| Read-only by design | one route, `WP_REST_Server::READABLE` (GET/HEAD) only; reads transients, never triggers update checks; no write code in the plugin |
| Capability check on every custom endpoint | `permission_callback` → `current_user_can( 'view_agency_maintenance_status' )` |
| Least-privilege account | role *Maintenance Auditor (read-only)*: write-capable capabilities exist only during GET REST requests; all other auditor REST methods → 403 ([04 §1](04-rest-permissions-and-update-data.md#decision-maintenance-auditor-role-with-read-only-guards)) |
| Fail-safe | deactivation removes the role (account left with zero capabilities); uninstall also removes the custom capability |
| HTTPS | WordPress refuses application passwords over http on non-local sites; the collector refuses `http://` unless `allowInsecureHttp` is set for that (local) site |
| Minimal data | no PHP version, paths, users, options or licence keys in the response |

## Onboarding a client site (checklist)

Do this only for sites the agency is **explicitly authorised** to maintain.

1. **Install the plugin.** Zip the folder `wordpress-plugin/agency-maintenance-status/` and upload it under Plugins → Add New → Upload, or copy the folder to `wp-content/plugins/agency-maintenance-status/` over SFTP. Then activate it.
2. **Create the account.** Users → Add New:
   - Username `maintenance-auditor`, an agency-controlled mailbox
   - Role **Maintenance Auditor (read-only)**, and no other role
   - Password: generate and discard (the account never logs in interactively)
3. **Create the application password.** Users → maintenance-auditor → *Application Passwords* → name `Agency maintenance collector` → Add. Copy it **once** into the agency machine's `.env`, as `WP_<SITE>_APP_PASSWORD=...`. Don't paste it into chat, tickets, email or Claude.
4. **Register the site** in `clients.json` (non-secret):

   ```json
   { "siteId": "acme-main", "clientId": "acme", "clientName": "Acme d.o.o.",
     "url": "https://www.example.com", "username": "maintenance-auditor",
     "passwordEnv": "WP_ACME_MAIN_APP_PASSWORD" }
   ```

5. **Verify**: `yarn collect:dry-run`, then `yarn collect --site acme-main`. Expected: `OK` or `PARTIAL` with a clear reason.

**Revoke access:** delete the application password, or deactivate the plugin (instant fail-safe), or delete the user.
