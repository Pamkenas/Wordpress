# 04 · REST permissions and update data (Week 1 investigation)

Findings from reading the WordPress 7.1.3 core source in `C:\xampp\htdocs\wordpress` and testing against the local instance. Line numbers refer to that version.

## 1. Which capability each endpoint needs

| Endpoint (GET) | Required capability | Core reference | Default holders |
|---|---|---|---|
| `/wp/v2/plugins` | `activate_plugins` | `class-wp-rest-plugins-controller.php:112-122` | Administrator only |
| `/wp/v2/themes` (all themes) | `switch_themes` or `manage_network_themes` | `class-wp-rest-themes-controller.php:98-113` | Administrator only |
| `/wp/v2/themes?status=active` | `edit_posts` (any post type) | `class-wp-rest-themes-controller.php:104-105, 149-158` | Editor, Author, Contributor; **active theme only**, not enough for an inventory |
| `/agency-maintenance/v1/status` (ours) | `view_agency_maintenance_status` | `agency-maintenance-status.php`, `can_view_status()` | Administrator + Maintenance Auditor |

Not logged in → **401**. Logged in without the capability → **403** (`rest_authorization_required_code()`).

**Key finding:** there is no read-only capability for listing plugins or themes. `activate_plugins` is the same capability that permits `POST /wp/v2/plugins/<plugin> {status: active|inactive}` (`:423-426`, `:705`, `:713`), and `switch_themes` permits changing the active theme in wp-admin. A plain account with these capabilities could change client sites.

### Decision: Maintenance Auditor role with read-only guards

The status plugin adds the role `agency_maintenance_auditor` with `read`, `activate_plugins`, `switch_themes` and `view_agency_maintenance_status`. Two guards make it read-only:

1. **`user_has_cap` filter**: `activate_plugins` and `switch_themes` exist only during a REST request whose method is GET/HEAD without a method override. In wp-admin, XML-RPC and every REST write they are `false`.
2. **`rest_pre_dispatch` filter**: every REST request from an auditor with an effective method other than GET/HEAD is rejected with 403 `agency_maintenance_read_only`. This covers method overrides, because WordPress applies `?_method=` and `X-HTTP-Method-Override` to **any** verb (`class-wp-rest-server.php:390-393`). It also covers each sub-request of `/batch/v1` (`rest_pre_dispatch` runs per sub-request, `:1866`).

**Fail-safe:** deactivating the plugin removes the role, so the account has no capabilities left. Reactivating restores it. All of this was verified on the local instance (see [03](03-test-environment.md#verified-on-2026-10-21)).

Alternative considered: have the status endpoint return the plugin and theme list itself, so the account needs only the custom capability. Rejected for the MVP because the spec asks to use the core endpoints where they exist. It stays an option if a client refuses the auditor role.

## 2. Plugin identifiers

`/wp/v2/plugins` returns `"plugin": "akismet/akismet"`. Core strips `.php` (`class-wp-rest-plugins-controller.php:585`). The update transients, `get_plugins()` and the activation API use the full basename `akismet/akismet.php`. The collector appends `.php`, so the snapshot identifier, the transient key and the license-register key are the same string.

The pre-Week-1 code matched the REST id directly against the transient. That could never match, so every plugin came out `unknown`.

## 3. What the core endpoints do not return

| Missing from core REST | Where we get it |
|---|---|
| WordPress core version | status endpoint `core.installed` (`wp_get_wp_version()`) |
| Available core / plugin / theme updates | status endpoint, from the update transients (§4) |
| Must-use plugins (`wp-content/mu-plugins/*.php`) | status endpoint `mustUsePlugins` (`get_mu_plugins()`; top-level files only, like wp-admin) |
| Drop-ins (`object-cache.php`, `advanced-cache.php`, ...) | status endpoint `dropins` (`get_dropins()`) |

`/wp/v2/plugins` lists only `get_plugins()` results (`:137`). Neither endpoint is paginated: themes sets `X-WP-TotalPages: 1` (`class-wp-rest-themes-controller.php:220-221`), and plugins returns the full array. The collector requests `_fields=` to receive only the four fields it uses.

## 4. Update transients

WordPress stores the result of its last update check in three site transients. The status endpoint reads them with `get_site_transient()` only. It never calls `wp_version_check()` / `wp_update_plugins()` / `wp_update_themes()`, so a collector run can't trigger outgoing requests to wordpress.org from the client site.

| Transient | Written by | Shape (relevant parts) |
|---|---|---|
| `update_core` | `wp_version_check()` (`update.php:312-319`) | `last_checked`, `version_checked`, `updates[]` objects with `response` (`upgrade` / `autoupdate` / `latest` / `development`) and `current` |
| `update_plugins` | `wp_update_plugins()` (`update.php:491-505, 589-609`) | `last_checked`, `checked[file] = version at check`, `response[file] = object{new_version,...}`, `no_update[file]` |
| `update_themes` | `wp_update_themes()` (`update.php:778-785, 866-875`) | same as plugins, keyed by stylesheet; entries are **arrays**, not objects |

**When they refresh:** WP-Cron twice daily (`update.php:1091-1099`). Also on admin page loads when older than 12 hours (`admin_init` → `_maybe_update_*`), and every time someone opens Plugins, Themes or Updates in wp-admin (`load-plugins.php` etc., `update.php:1191-1204`). On a low-traffic site with broken WP-Cron the data can be days old, so `lastCheck` is kept for every item.

**Why "not in the update list" ≠ "up to date":**

- **Premium / custom plugins**: wordpress.org does not know them. They appear in `checked` but in neither `response` nor `no_update`, unless the vendor's updater adds them through the `Update URI` header (`update.php:509-595`) or the `site_transient_update_plugins` filter. Commercial updaters often add entries only when an update exists, or only with a valid licence.
- **Stale check**: `checked[file]` holds the version at check time. If it differs from today's version, the plugin was updated, downgraded or replaced since the check, so the answer is stale.
- **Installed after the check**: not in `checked` at all.
- **Core**: if `version_checked` ≠ the installed version, the cached offers belong to an older WordPress.

The collector applies these rules in `resolveUpdate()` ([01](01-field-specification.md#when-is-an-update-state-yes-no-or-unknown)) and keeps such items **unknown**, with a reason.

Side effect to know: `get_site_transient()` runs `site_transient_update_plugins` / `_themes` filters, so a premium plugin's updater can add its data there. That is wanted. Badly written updaters may also make their own remote call there; it is the same thing that happens on every wp-admin page view.

## 5. Authentication facts

- Application passwords (WordPress ≥ 5.6) require HTTPS unless `WP_ENVIRONMENT_TYPE` is `local` (`user.php:5155-5157`).
- Application passwords authenticate REST and XML-RPC requests, never a wp-admin login.
- Spaces in the password are optional; the collector strips them.
- `401 rest_not_logged_in` despite credentials means the web server dropped the `Authorization` header (common with PHP-CGI). Fix in [03](03-test-environment.md#troubleshooting).
- Security plugins (Wordfence, iThemes/Solid, ...) can block `/wp-json/` or application passwords; the collector reports an HTML response as `invalid-response`.

## 6. Required privileges, summary

| Account | Needs | Can change anything? |
|---|---|---|
| `maintenance-auditor`, only role *Maintenance Auditor (read-only)* | status plugin active + application password | **No.** Verified: activate, deactivate, delete, method override and batch all return 403 |
| Without the status plugin | Administrator (for `activate_plugins` + `switch_themes`) | Yes. **Not acceptable**; the site gets the status plugin or is not onboarded |
