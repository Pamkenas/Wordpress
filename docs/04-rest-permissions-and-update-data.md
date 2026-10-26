# 04 · WordPress permissions and update data

Why the tool needs our status plugin, and how it reads updates.

## The problem

To list plugins, WordPress requires the right `activate_plugins`. To list all themes, it requires `switch_themes`. These same rights also allow changing a site. WordPress has no "read-only" version of them.

| Address | Needs |
|---|---|
| `/wp/v2/plugins` | `activate_plugins` |
| `/wp/v2/themes` | `switch_themes` |
| `/agency-maintenance/v1/status` (ours) | `view_agency_maintenance_status` |

## The solution: a read-only auditor role

The status plugin adds the role **Maintenance Auditor (read-only)**. It has the rights above, but three guards make it read-only:

1. The rights exist only while WordPress answers a REST **read** (GET or HEAD). Everywhere else they are switched off.
2. Every REST request that is not a read gets **403**. This also blocks tricks like `?_method=POST` and batch requests.
3. Logins over **XML-RPC** are refused. (Application passwords work there too, so without this guard the password could post comments.)

The guards apply to every account with this role, even if it gets a second role. Some plugins, such as bbPress, add a role automatically.

**Fail-safe:** if the plugin is deactivated, the role is removed and the account can do nothing.

## Plugin identifiers

WordPress REST gives `"plugin": "akismet/akismet"`. Everywhere else WordPress uses `akismet/akismet.php`. The tool adds `.php`, so the same identifier is used in snapshots, update data and the license register.

## What the status plugin adds

The normal WordPress REST API doesn't return these, so the status plugin does:

- the WordPress version
- the saved update lists for WordPress, plugins and themes
- must-use plugins and drop-ins

## How update data works

WordPress checks for updates about twice a day and saves the result. The status plugin only **reads** that saved result. It never starts a new check.

An item is `unknown` (not "up to date") when:

- it's a premium plugin that WordPress can't check
- its version changed since the last check
- it was installed after the last check

The full rules are in [01](01-field-specification.md#when-is-an-update-yes-no-or-unknown).

## Passwords

- Application passwords need HTTPS, unless the site is a `local` test site.
- They work for REST and XML-RPC, never for the wp-admin login.
- Spaces in the password don't matter.
- Security plugins (Wordfence and others) can block `/wp-json/`. The tool then reports an "invalid response".

## Summary

| Account | Can it change the site? |
|---|---|
| `maintenance-auditor` with the auditor role and the status plugin active | **No.** Tested: every write gets 403 and XML-RPC logins are refused |
| an administrator account without the status plugin | Yes. **Not allowed:** every site gets the status plugin |
