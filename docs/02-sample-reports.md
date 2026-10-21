# 02 · Sample reports (confirmed layout, Week 1)

The three report types from spec §4, with their contents and file names, agreed before implementation (Weeks 3–4). Sample data comes from the demo sites (`yarn collect:sample`); it contains no client information.

## Output files

File names are deterministic: they depend only on the period and validated ids.

```
reports/
└── 2026-10/
    ├── r1-consolidated-2026-10.pdf          R1  internal, all sites
    ├── r1-inventory-2026-10.csv             R1  internal, every item on every site
    ├── r2-internal-demo-shop-2026-10.pdf    R2  internal, one per site
    └── r3-client-demo-shop-2026-10.pdf      R3  client-facing, one per site
```

## R1: Consolidated internal (PDF + CSV)

**CSV**: one row per item (core, plugin, must-use, drop-in, theme) per site, **including sites and items with no updates**. A failed site gets one `item_type = site` row with the error, so it can't silently drop out of the spreadsheet. See [samples/r1-inventory.sample.csv](../samples/r1-inventory.sample.csv) (40 rows from 4 demo sites).

| Column | Example | Filter use |
|---|---|---|
| client_id, site_id, site_url | demo-client-b, demo-shop, https://demo-shop.example | by site / client |
| checked_at, fetch_status | 2026-10-21T07:29:14Z, success | stale or failed sites |
| item_type | core / plugin / must-use / drop-in / theme / site | |
| identifier, name | woocommerce/woocommerce.php, WooCommerce | **by plugin name** across all sites |
| installed_version, status | 10.0.4, active | |
| update_available, offered_version | true, 10.2.2 | **by update status** (`true`/`false`/`unknown`) |
| license_status | unknown | **by license status** (from the Week 3 register) |
| update_source, last_check, note | update_plugins transient, …, reason if unknown | |

Encoding: UTF-8 with BOM and CRLF line endings, so Excel opens it with č/š/ž intact.

**PDF summary**: one page per run:

1. Header: period, run time, number of sites, success/partial/failed counts
2. Site table: site, client, core version (+ offered), plugins, themes, updates available, unknown states, licence issues, status
3. Collection errors: one line per failed or partial site, with the error kind and message
4. Top pending updates across all sites (plugin → number of sites affected)

## R2: Per-client internal (PDF, one per site)

1. Site header: client, URL, checked_at, fetch_status
2. Core: installed, offered, last check
3. Plugins: **all** plugins (active, inactive, must-use, drop-in) with version, status, update state, offered version, licence status. Unknown is shown as **Unknown**, with the reason, never left blank
4. Themes: all themes, same columns
5. License register: rows for this site; plugins without a register entry are listed as "not in register"
6. Detected changes since the previous snapshot (Week 3 diff): *observations*, labelled "detected, not confirmed"
7. Confirmed maintenance actions this period (from `maintenance_log.csv`)
8. Collection errors

## R3: Client-facing (branded PDF, one per site)

1. Agency branding, client name, site, period
2. Short explanation of what maintenance covers
3. **Confirmed work performed**: only rows from the human-confirmed maintenance log
4. Issues found and recommended next steps (for example, an update available that needs approval)

**Never in R3**: credentials, usernames, raw notes, other clients' data, error stack traces, snapshot differences presented as work done, or any "all up to date" claim when states are unknown.

## Sample snapshot

[samples/snapshot.sample.json](../samples/snapshot.sample.json) is the real collector output for the `demo-shop` demo site (URL replaced with `https://demo-shop.example`). It shows every state: update available, current, inactive, premium (unknown), stale check (unknown), installed after the check (unknown), must-use, drop-in, active child theme and inactive parent theme.
