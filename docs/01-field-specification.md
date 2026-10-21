# 01 · Field specification (confirmed, Week 1)

Every field from spec §3, the key it uses in the snapshot JSON (`snapshots/YYYY-MM-DD/<siteId>.json`), and where the value comes from. TypeScript definitions: [src/types.ts](../src/types.ts). Example: [samples/snapshot.sample.json](../samples/snapshot.sample.json).

Naming: snapshot JSON uses camelCase (TypeScript convention). CSV and PDF reports use the spec's snake_case names; the mapping is the first two columns below.

## Site

| Spec field | Snapshot key | Type | Source |
|---|---|---|---|
| client_id | `clientId` | string | clients.json |
| site_id | `siteId` | string, `[a-z0-9-]` | clients.json (also the snapshot file name) |
| site URL | `siteUrl` | string | clients.json, normalised (no trailing slash) |
| checked_at | `checkedAt` | ISO 8601 UTC | collector clock when the site's collection started |
| fetch_status | `fetchStatus` | `success` / `partial` / `failed` | collector, rules below |
| error | `error` | string or null | one-line summary of `errors` |
| (detail) | `errors[]` | `{source, kind, httpStatus, message}` | per failed request; `kind` is `auth`, `forbidden`, `timeout`, `tls`, `redirect`, `invalid-response` and others |
| WordPress core installed version | `core.installedVersion` | string or null | status endpoint (`wp_get_wp_version()`) |
| available core update | `core.availableVersion` + `core.updateAvailable` | string or null + tri-state | `update_core` transient through the status endpoint |
| (schema) | `schemaVersion` | `1` | bumped on breaking snapshot changes |

**fetch_status rules**

| Result | Meaning |
|---|---|
| `success` | plugins, themes and status endpoint all read |
| `partial` | plugin list read; themes and/or status endpoint missing. Inventory is usable, but some update states are `unknown` |
| `failed` | plugin list could not be read (401, 403, timeout, TLS, missing password...). Whatever else was read is kept |

## Plugin (ALL: active, inactive, must-use, drop-in)

| Spec field | Snapshot key | Type | Source |
|---|---|---|---|
| site_id | (parent `siteId`) | string | added as a column in CSV |
| plugin identifier/file | `identifier` | string, e.g. `akismet/akismet.php` | `/wp/v2/plugins` `plugin` + `.php` (see [04](04-rest-permissions-and-update-data.md#plugin-identifiers)) |
| (kind) | `kind` | `plugin` / `must-use` / `drop-in` | must-use and drop-ins come from the status endpoint |
| name | `name` | string | `/wp/v2/plugins` |
| installed_version | `installedVersion` | string or null | `/wp/v2/plugins` |
| active/inactive | `status` | `active` / `inactive` / `unknown` | `/wp/v2/plugins` (`network-active` → `active`) |
| update_available | `updateAvailable` | `yes` / `no` / `unknown` (CSV: `true` / `false` / `unknown`) | `update_plugins` transient |
| offered_version | `offeredVersion` | string or null | `update_plugins` transient `response[id].new_version` |
| source | `source` | string | `update_plugins transient`, or `none` |
| last_check | `lastCheck` | ISO 8601 or null | transient `last_checked` |
| (reason) | `updateNote` | string or null | why `updateAvailable` is `unknown` |

## Theme (ALL)

| Spec field | Snapshot key | Type | Source |
|---|---|---|---|
| theme slug | `slug` | string (stylesheet) | `/wp/v2/themes` |
| name | `name` | string | `/wp/v2/themes` `name.raw` |
| installed_version | `installedVersion` | string or null | `/wp/v2/themes` |
| active/inactive | `status` | `active` / `inactive` | `/wp/v2/themes` |
| update_available | `updateAvailable` | tri-state | `update_themes` transient |
| offered_version | `offeredVersion` | string or null | `update_themes` transient |
| (added) | `source`, `lastCheck`, `updateNote` | | same meaning as for plugins |

## When is an update state `yes`, `no` or `unknown`?

A missing update entry is **never** read as "up to date". `resolveUpdate()` in [src/collect.ts](../src/collect.ts) applies these rules in order:

| # | Condition | Result | `updateNote` |
|---|---|---|---|
| 1 | status endpoint unavailable | unknown | update data unavailable |
| 2 | WordPress never completed an update check | unknown | has not completed an update check |
| 3 | item not in the transient's `checked` list (installed after the check) | unknown | not included in the last update check |
| 4 | installed version ≠ version recorded at the check | unknown | installed version changed since the last update check |
| 5 | item in `response` (update list) | **yes** + offered version | — |
| 6 | item in `no_update` | **no** | — |
| 7 | checked, but in neither list (premium/custom plugin with its own updater) | unknown | no update channel reported; verify manually |
| — | must-use plugin / drop-in | unknown | WordPress does not check these |
| core | `update_core.version_checked` ≠ installed version | unknown | check missing or older than installed version |

## Fields owned by later weeks (agreed now so the keys stay stable)

| Register | Key fields | Notes |
|---|---|---|
| License register (Week 3) | site_id, plugin identifier, license_status, expiry_date?, vendor, owner, verification_source, verified_at, notes | joined on **site_id + plugin identifier** (never the display name). A plugin missing from the register shows `license_status = unknown` |
| Maintenance log (Week 4) | site_id, date, action, component, version_before?, version_after?, confirmation_by, confirmation_at, notes | only these rows can appear in R3 as work performed |
