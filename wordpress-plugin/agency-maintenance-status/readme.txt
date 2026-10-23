=== Agency Maintenance Status ===
Requires at least: 5.6
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.1
License: GPL-2.0-or-later

Read-only REST endpoint for the agency's maintenance inventory collector.

== Description ==

Adds one endpoint, GET /wp-json/agency-maintenance/v1/status, returning:

* WordPress core version and the newest offered core upgrade
* WordPress' cached plugin and theme update data (update_plugins / update_themes transients)
* must-use plugins and drop-ins (not listed by /wp/v2/plugins)

It reads cached data only and never triggers a remote update check. It has no write routes.

It also adds the role "Maintenance Auditor (read-only)" for the collector's dedicated account.
That role holds activate_plugins and switch_themes only during GET/HEAD REST requests, because
core's plugin and theme listing endpoints require them; every other REST method from that
account is rejected with HTTP 403, and the capabilities are withdrawn in wp-admin and XML-RPC.
Deactivating the plugin removes the role, so the account loses all access.

== Installation ==

1. Copy the folder agency-maintenance-status/ to wp-content/plugins/ and activate it.
2. Users > Add New: username "maintenance-auditor", role "Maintenance Auditor (read-only)",
   a long random password that nobody keeps (the account never logs in interactively).
3. Edit that user > Application Passwords > name "Agency maintenance collector" > Add.
   Copy the password once into the collector's .env file. Never paste it anywhere else.
4. The site must use HTTPS (application passwords are disabled over http except when
   WP_ENVIRONMENT_TYPE is "local").

Give the account no other role. A user who also has another role is not treated as an auditor.

The plugin is not on WordPress.org and declares "Update URI: false", so WordPress never offers
an update for it from WordPress.org (not even a different plugin with the same slug). The
collector reports an update when the site runs an older version than the agency's repository.

== Changelog ==

= 1.0.1 =
* Update URI: false, so WordPress.org can never offer an unrelated plugin as an update.

= 1.0.0 =
* First release: status endpoint, auditor role, read-only guards.
