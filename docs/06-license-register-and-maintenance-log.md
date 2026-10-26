# 06 · License register and maintenance log (Weeks 3–4)

Two files that **people** maintain. The scripts only read them. Both live in the project folder next to `clients.json` and are git-ignored because they contain client data.

| File | Template | Purpose |
|---|---|---|
| `licenses.csv` | [licenses.example.csv](../licenses.example.csv) | human-verified license register |
| `maintenance_log.csv` | [maintenance_log.example.csv](../maintenance_log.example.csv) | human-confirmed work, the only source of "work performed" in R3 |

Both files are optional. Without `licenses.csv` every license is reported as `unknown`; without `maintenance_log.csv` no work is reported. `yarn check-config` shows what was found.

## Editing in Excel

- Save as **CSV UTF-8**. Comma or semicolon separators both work; the delimiter is detected from the header row. A file saved in another format stops the report with a message asking for CSV UTF-8, so names with č, š and ž are never garbled.
- Dates may be `2026-10-07` or the Slovenian `7. 10. 2026` that Excel writes; times as `2026-10-07 15:10`.
- Format version columns as **Text** before typing. Otherwise Excel turns `5.6` into a number or a date.
- The header row must keep the column names below. Extra columns are ignored with a `NOTE`.
- A row with a problem stops the report with a message naming the row. Nothing is skipped silently, because the client report depends on this data.

## licenses.csv

| Column | Required | Values |
|---|---|---|
| `site_id` | yes | a `siteId` from `clients.json` (rows for other sites are ignored with a note) |
| `plugin_identifier` | yes | exact plugin basename `woocommerce/woocommerce.php`, or a theme slug `storefront` |
| `license_status` | yes | `valid`, `expired`, `missing`, `not-required`, `unknown` |
| `expiry_date` | no | date; a `valid` license past this date is reported as `expired` |
| `vendor`, `owner` | no | free text (owner: `agency` or `client`) |
| `verification_source` | no | where it was checked: vendor portal, invoice, wp-admin license page |
| `verified_at` | no | date of that check |
| `notes` | no | internal only, never shown to the client |

Rules:

- The key is **site_id + plugin_identifier**, never the display name, so renaming a plugin doesn't break the register. Each pair may appear only once.
- An installed plugin or theme without a row is reported as `unknown`, never as fine.
- A row whose identifier isn't installed is listed in R2. If it looks like a typo (`wp-mail-smtp` instead of `wp-mail-smtp/wp_mail_smtp.php`), R2 suggests the right identifier.
- Find the exact identifiers in the R1 CSV (`identifier` column) or with `yarn collect --details`.

## maintenance_log.csv

| Column | Required | Values |
|---|---|---|
| `site_id` | yes | a `siteId` from `clients.json` |
| `date` | yes | the day the work was done; it decides the report month |
| `action` | yes | `update`, `install`, `remove`, `activate`, `deactivate`, `configure`, `backup`, `security-check`, `other` |
| `component` | yes | plugin identifier, theme slug, `core`, or short text such as `Full site backup` |
| `version_before`, `version_after` | no | versions, shown as `3.31.0 › 3.32.1` |
| `confirmation_by` | for confirmation | name of the person who checked the work |
| `confirmation_at` | for confirmation | date and time of that check (not before `date`) |
| `notes` | no | internal only, never shown to the client |

**Confirmed** means both `confirmation_by` and `confirmation_at` are filled in. Filling only one of them is an error.

| Row | R2 (internal) | R3 (client) |
|---|---|---|
| confirmed, date in the month | "Confirmed maintenance work", with notes | **"Work performed"**, without notes |
| not confirmed, date in the month | "Unconfirmed log entries" warning | **not shown** |
| date outside the month | not shown | not shown |

Changes seen between two snapshots (for example a WordPress auto-update) are **observations**. They appear only in R2 under "Detected changes" and never become work in R3. Work reaches the client only through a confirmed row in this file.

The Claude skill never adds rows to this file and never fills in the confirmation columns.

## Example: one month

```csv
site_id,date,action,component,version_before,version_after,confirmation_by,confirmation_at,notes
acme-main,2026-10-07,backup,Full site backup before updates,,,Ana Novak,2026-10-07 14:50,UpdraftPlus to remote storage
acme-main,2026-10-07,update,woocommerce/woocommerce.php,10.0.4,10.2.2,Ana Novak,2026-10-07 15:10,Tested on staging first
acme-main,2026-10-16,remove,old-slider/old-slider.php,4.2.0,,,,Waiting for client approval
```

The first two rows appear in the October R3 as "Varnostna kopija: Full site backup before updates" and "Posodobitev: WooCommerce (10.0.4 › 10.2.2)". The third row appears only in R2 until someone confirms it.
