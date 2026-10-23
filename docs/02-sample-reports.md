# 02 · Reports R1, R2 and R3

Layout agreed in Week 1, implemented in Weeks 3–4 (`src/reports/`). Every picture and sample below comes from the demo sites (`yarn demo`) and contains no client information.

```powershell
yarn report                      # month of the newest snapshot
yarn report --period 2026-10     # a specific month
yarn demo                        # demo: collect two months of demo sites, then report
```

## Output files

File names depend only on the month and the validated site ids. Running the report again for the same month replaces the files.

```
reports/
└── 2026-10/
    ├── r1-consolidated-2026-10.pdf          R1  internal, all sites (landscape)
    ├── r1-inventory-2026-10.csv             R1  internal, every item on every site
    ├── r2-internal-<siteId>-2026-10.pdf     R2  internal, one per site
    ├── r3-client-<siteId>-2026-10.pdf       R3  for the client, one per site
    └── _report.json                         summary for the Claude skill (no secrets)
```

If the folder holds an `r1-`/`r2-`/`r3-` file that the run did not write (for example a site removed from `clients.json`), the command prints a `NOTE` saying the file is out of date. Don't send it.

## Which snapshots a report uses

| | Rule |
|---|---|
| **Current** | the newest snapshot of the site **inside** the month. If that collection failed, the report says so; it doesn't fall back to an older inventory. |
| **Baseline** for detected changes | the newest **successful** snapshot **before** the month starts. If there is none, the oldest successful snapshot earlier in the same month. |
| **No snapshot in the month** | the site is reported as `not-collected`, never as "OK". |
| **License expiry** | judged on the current snapshot's date (or the month's last day): `valid` with a past `expiry_date` becomes `expired`. |
| **Maintenance work** | log rows whose `date` is inside the month. Only confirmed rows count as work (see [06](06-license-register-and-maintenance-log.md)). |

## R1: Consolidated internal report (PDF + CSV)

![R1 consolidated report, first page](images/r1-consolidated.png)

**PDF** (A4 landscape): an overview with counts, then one row per site (status, WordPress version, plugins, themes, updates, unknown states, license issues, detected changes, confirmed work), collection problems, pending updates across all sites, and expired or missing licenses.

**CSV**: one row per item (core, plugin, must-use, drop-in, theme) per site, **including sites and items with no updates**. A failed or missing site gets one `item_type = site` row with the reason, so it can't drop out of the spreadsheet unnoticed. Sample: [samples/r1-inventory.sample.csv](../samples/r1-inventory.sample.csv).

| Column | Example | Filter use |
|---|---|---|
| client_id, site_id, site_url | demo-client-b, demo-shop, https://demo-shop.example | by site or client |
| checked_at, fetch_status | 2026-10-21T07:00:00.000Z, success | stale or failed sites |
| item_type | core, plugin, must-use, drop-in, theme, site | |
| identifier, name | woocommerce/woocommerce.php, WooCommerce | **by plugin name** across all sites |
| installed_version, status | 10.0.4, active | |
| update_available, offered_version | true, 10.2.2 | **by update status** (`true`, `false`, `unknown`) |
| license_status | valid, expired, missing, not-required, unknown, n/a (core) | **by license status** |
| update_source, last_check, note | update_plugins transient, …, the reason when unknown | |

Encoding: UTF-8 with BOM and CRLF line endings, so Excel shows č, š and ž correctly. Values starting with `=`, `+`, `-` or `@` get a leading `'`, so a plugin name from a client site can't run as an Excel formula. If Excel puts everything in one column (Slovenian Windows uses `;`), set `"csvDelimiter": ";"` in `agency.json`.

## R2: Per-site internal report (PDF)

![R2 internal report, first page](images/r2-internal-demo-shop.png)

1. Header: client, URL, snapshot date and time, collection status, baseline date
2. Collection problems: source, kind, HTTP status, message
3. WordPress core: installed version, update, last update check
4. **All** plugins (active, inactive, must-use, drop-in) and **all** themes: version, status, update state with the reason when unknown, license state with expiry
5. License register: every register row for the site, the effective status (`expired (recorded: valid)` when the date has passed), the list of installed components without a register row, and register rows for components that aren't installed (with a "did you mean" suggestion for typos)
6. Detected changes (observations): added, removed, updated, downgraded, activated, deactivated, labelled as **not** proof of agency work
7. Confirmed maintenance work, including internal notes
8. Unconfirmed log entries, flagged as not in the client report

## R3: Client report (branded PDF, Slovenian or English)

![R3 client report](images/r3-client-demo-shop.png)

Branding comes from `agency.json`: agency name or logo, the primary color (top bar and headings), website and contact e-mail. The language is `"language": "sl"` or `"en"`.

1. Header: agency, client name, website, month
2. Short explanation that only confirmed work is listed
3. **Work performed**: only rows from the maintenance log with `confirmation_by` and `confirmation_at`, written as "Posodobitev: Elementor (3.31.0 › 3.32.1)"
4. **Current status**: date of the automated check, WordPress version, plugins (active), themes, updates available, components that need a manual check. If the check failed or is missing, it says so instead.
5. **Issues and next steps**: WordPress update, plugin and theme updates (names), components that need a manual check, expired or missing licenses. "No open issues" appears **only** when the check succeeded and nothing is unknown.

**Never in R3**, enforced by tests: credentials and usernames, internal notes from the log or the register, error messages, unconfirmed log rows, detected changes, other clients or sites, and any "all fine" claim when the check failed or states are unknown.

Always have a person read each R3 before it is sent.

## Sample snapshot

[samples/snapshot.sample.json](../samples/snapshot.sample.json) is the collector's real output for the `demo-shop` demo site. It shows every state: update available, current, inactive, premium (unknown), stale check (unknown), installed after the check (unknown), must-use, drop-in, active child theme and inactive parent theme.
