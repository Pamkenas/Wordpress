# 06 · License register and work log

Two files that **people** fill in. The tool only reads them.

| File | Copy from | What it is |
|---|---|---|
| `licenses.csv` | [licenses.example.csv](../licenses.example.csv) | which plugins have a valid license |
| `maintenance_log.csv` | [maintenance_log.example.csv](../maintenance_log.example.csv) | the work that was done and checked |

Both are optional:

- without `licenses.csv`, every license is `unknown`
- without `maintenance_log.csv`, no work is shown

They contain client data, so they are not saved in Git.

## Editing in Excel

- Save as **CSV UTF-8**. Otherwise the report stops and asks you to do it, so č, š and ž are never garbled.
- Commas or semicolons both work.
- Dates can be `2026-10-07` or `7. 10. 2026`. Times: `2026-10-07 15:10`.
- Set version columns to **Text** first. Otherwise Excel turns `5.6` into a number.
- Keep the column names in the first row.
- A wrong row stops the report and the message says which row.

## licenses.csv

| Column | Needed | What to write |
|---|---|---|
| `site_id` | yes | a `siteId` from `clients.json` |
| `plugin_identifier` | yes | for example `woocommerce/woocommerce.php`, or a theme like `storefront` |
| `license_status` | yes | `valid`, `expired`, `missing`, `not-required` or `unknown` |
| `expiry_date` | no | after this date a `valid` license is shown as `expired` |
| `vendor`, `owner` | no | free text |
| `verification_source`, `verified_at` | no | where and when you checked it |
| `notes` | no | internal, never shown to the client |

- Use the exact identifier, not the plugin name. You find it in the R1 CSV or with `yarn collect --details`.
- A plugin without a row is `unknown`.
- A row for a plugin that isn't installed is shown in R2, with a "did you mean…?" hint.

## maintenance_log.csv

| Column | Needed | What to write |
|---|---|---|
| `site_id` | yes | a `siteId` from `clients.json` |
| `date` | yes | the day of the work (it decides the month) |
| `action` | yes | `update`, `install`, `remove`, `activate`, `deactivate`, `configure`, `backup`, `security-check` or `other` |
| `component` | yes | a plugin identifier, theme, `core` or short text like `Full site backup` |
| `version_before`, `version_after` | no | for example `10.0.4` and `10.2.2` |
| `confirmation_by` | to confirm | who checked the work |
| `confirmation_at` | to confirm | when it was checked |
| `notes` | no | internal, never shown to the client |

**Confirmed** means both `confirmation_by` and `confirmation_at` are filled in. Filling only one is an error.

| Row | R2 (internal) | R3 (client) |
|---|---|---|
| confirmed | shown, with notes | shown, without notes |
| not confirmed | shown as a warning | **not shown** |

Changes the tool sees between two snapshots are **not** work. Work reaches the client only through a confirmed row here. The Claude skill never edits this file.

## Example

```csv
site_id,date,action,component,version_before,version_after,confirmation_by,confirmation_at,notes
acme-main,2026-10-07,backup,Full site backup before updates,,,Ana Novak,2026-10-07 14:50,UpdraftPlus to remote storage
acme-main,2026-10-07,update,woocommerce/woocommerce.php,10.0.4,10.2.2,Ana Novak,2026-10-07 15:10,Tested on staging first
acme-main,2026-10-16,remove,old-slider/old-slider.php,4.2.0,,,,Waiting for client approval
```

The first two rows are in the client report: "Varnostna kopija: Full site backup before updates" and "Posodobitev: WooCommerce (10.0.4 › 10.2.2)". The third row is not confirmed, so only R2 shows it.
