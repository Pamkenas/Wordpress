# 01 · Field specification

This page lists every field the tool saves, and where it comes from.

- Snapshots are saved in `snapshots/YYYY-MM-DD/<siteId>.json`. Example: [samples/snapshot.sample.json](../samples/snapshot.sample.json).
- Snapshots use camelCase names (`installedVersion`). The CSV and PDF reports use snake_case names (`installed_version`).
- The TypeScript types are in [src/types.ts](../src/types.ts).

## Site

| Field | Snapshot key | Comes from |
|---|---|---|
| client_id | `clientId` | clients.json |
| site_id | `siteId` | clients.json (also the snapshot file name) |
| site URL | `siteUrl` | clients.json |
| checked_at | `checkedAt` | the time the check started (UTC) |
| fetch_status | `fetchStatus` | `success`, `partial` or `failed` (see below) |
| error | `error`, `errors[]` | what went wrong, if anything |
| WordPress version | `core.installedVersion` | status plugin |
| WordPress update | `core.availableVersion`, `core.updateAvailable` | status plugin |

**fetch_status**

| Value | Meaning |
|---|---|
| `success` | plugins, themes and the status plugin were all read |
| `partial` | the plugins were read, but the themes or the status plugin were not. Some update states are `unknown` |
| `failed` | the plugin list could not be read (wrong password, 403, timeout…). Nothing more is asked |

## Plugins

All plugins are listed: active, inactive, must-use and drop-ins.

| Field | Snapshot key | Example |
|---|---|---|
| plugin identifier | `identifier` | `akismet/akismet.php` (see [04](04-rest-permissions-and-update-data.md#plugin-identifiers)) |
| kind | `kind` | `plugin`, `must-use`, `drop-in` |
| name | `name` | Akismet Anti-spam |
| installed_version | `installedVersion` | 5.6 |
| active/inactive | `status` | `active`, `inactive`, `unknown` |
| update_available | `updateAvailable` | `yes`, `no`, `unknown` (CSV: `true`, `false`, `unknown`) |
| offered_version | `offeredVersion` | 5.7 |
| source | `source` | where the update state came from |
| last_check | `lastCheck` | when WordPress last checked for updates |
| note | `updateNote` | why the state is `unknown` |

## Themes

All themes are listed, active and inactive. The fields are the same as for plugins, except that the key is `slug` (for example `twentytwentyfive`).

## When is an update `yes`, `no` or `unknown`?

The tool never guesses "up to date". The rules are in `resolveUpdate()` in [src/collect.ts](../src/collect.ts):

| Situation | Result |
|---|---|
| the status plugin could not be read | unknown |
| WordPress has never checked for updates | unknown |
| the item was installed after the last check | unknown |
| the installed version changed since the last check | unknown |
| WordPress lists an update | **yes**, with the offered version |
| WordPress lists it as up to date | **no** |
| WordPress knows nothing about it (premium plugin) | unknown, "verify manually" |
| must-use plugin or drop-in | unknown (WordPress doesn't check them) |

Names and versions are saved as plain text. For example `Header &amp; Footer` from WordPress becomes `Header & Footer`.

## License register and work log

The columns of `licenses.csv` and `maintenance_log.csv` are explained in [06](06-license-register-and-maintenance-log.md).

## agency.json

| Key | Default | Used for |
|---|---|---|
| `agencyName` | required | report headers and footers |
| `contactEmail`, `website` | none | contact line and footer of R3 |
| `primaryColor` | `#1f6f8b` | R3 colour |
| `logo` | none | a `.png` or `.jpg` instead of the agency name in R3 |
| `language` | `en` | R3 language: `en` or `sl` |
| `csvDelimiter` | `,` | CSV separator: `,` or `;` (Slovenian Excel) |
