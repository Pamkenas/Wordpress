# 09 · How the code works

A simple tour of the code for the next person who works on it.

## The idea

```
 1. COLLECT                    2. REPORT                   3. PEOPLE
 ask each site:                read the snapshots          check R1 and R2,
   • which plugins?            + license register          confirm the work,
   • which themes?             + work log                  read and send R3
   • which updates?            make R1, R2, R3
 save a snapshot
```

The program never changes a site. It only reads.

## Files

| File | What it does |
|---|---|
| `src/index.ts` | the commands (`check`, `collect`, `report`, `run`) |
| `src/workflow.ts` | runs a collection for real sites or demo sites |
| `src/config.ts` | reads and checks `clients.json` |
| `src/wordpress-client.ts` | talks to one WordPress site |
| `src/collect.ts` | asks one site its questions and makes a snapshot |
| `src/agency-plugin.ts` | knows our plugin version, to spot old copies |
| `src/snapshot.ts` | saves and reads snapshots |
| `src/types.ts` | what a snapshot looks like |
| `src/diff.ts` | compares two snapshots |
| `src/agency.ts` | reads `agency.json` |
| `src/csv.ts` | reads and writes CSV files |
| `src/dates.ts` | reads and writes dates |
| `src/files.ts` | writes files safely |
| `src/licenses.ts` | reads `licenses.csv` |
| `src/maintenance-log.ts` | reads `maintenance_log.csv` |
| `src/report-model.ts` | gathers everything one site's reports need |
| `src/reports/generate.ts` | makes all reports of a month |
| `src/reports/r1.ts`, `r2.ts`, `r3.ts` | what is on each report |
| `src/reports/pdf.ts` | shared PDF parts |
| `src/reports/text.ts` | the client report sentences (English and Slovenian) |
| `src/sample/` | the demo sites and a fake WordPress server |
| `wordpress-plugin/` | the PHP plugin for client sites |
| `tests/` | the tests |

## Step 1: collect

1. `index.ts` reads the command and loads `clients.json`.
2. `collect.ts` checks the sites two at a time. For each site it:
   - takes the password from `.env` (if it's missing, the site fails)
   - asks for the **plugins**. If this fails, the site is `failed`
   - asks for the **themes** and our **status plugin**. If one fails, the site is `partial`
   - makes names plain text (`&amp;` becomes `&`)
3. `wordpress-client.ts` does the HTTP work:
   - sends the password
   - waits at most 15 seconds and retries only small problems
   - never follows redirects
   - refuses answers bigger than 5 MB
   - checks that the answer looks right
4. `snapshot.ts` saves one JSON file per site in `snapshots/YYYY-MM-DD/`.

The update rule is in `resolveUpdate()`: the answer is **yes** or **no** only when WordPress is sure. Otherwise it is **unknown**, with a reason.

## Step 2: report

1. `generate.ts` loads `agency.json`, the register and the log, and picks the month.
2. `snapshot.ts` picks this month's snapshot and an older one to compare with.
3. `report-model.ts` puts everything for one site together.
4. `generate.ts` writes the CSV, the PDFs and `_report.json`. If one file can't be written (for example it's open in Excel), you get a `PROBLEM` line and the other files are still written.

R3 shows only confirmed work. Its rules are in `r3.ts`.

## The PHP plugin

`agency-maintenance-status.php`:

1. adds the read-only address `GET /wp-json/agency-maintenance/v1/status`
2. adds the auditor role when activated and removes it when deactivated
3. guards the auditor account:
   - `filter_auditor_caps()` gives the plugin-list rights only during a REST read
   - `block_auditor_writes()` refuses every REST write (403)
   - `block_auditor_xmlrpc()` refuses XML-RPC logins
   - `is_auditor()` counts every account with the auditor role, even with a second role

## Tests

The tests use a fake WordPress, so they need no real site. `yarn verify` runs the type check, the format check and all tests. Run it after every change.

## How do I…

| I want to… | Change |
|---|---|
| change a client report sentence | `src/reports/text.ts` (both languages) |
| change the agency name, colour or language | `agency.json` |
| add a site | `clients.json` and `.env` ([07](07-monthly-workflow.md#adding-a-new-site)) |
| add a work action | `src/maintenance-log.ts` and `src/reports/text.ts` |
| add a license status | `src/licenses.ts` and `statusColor()` in `src/reports/pdf.ts` |
| add a CSV column | `R1_COLUMNS` and `componentCsvRow()` in `src/reports/r1.ts` |
| change the timeout | `DEFAULT_CLIENT_OPTIONS` in `src/wordpress-client.ts` |
| change the demo data | `src/sample/fixtures.ts` |

If you forget something, `yarn typecheck` usually tells you.
