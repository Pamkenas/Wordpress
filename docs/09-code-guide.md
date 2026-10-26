# 09 · How the code works (simple guide)

A plain-language tour of the code for whoever maintains it next. No WordPress or TypeScript expertise is needed to follow it.

## The idea in three steps

```
 1. COLLECT                         2. REPORT                          3. PEOPLE
 ─────────                          ────────                           ──────
 ask each site 3 questions          read the snapshots                 a person reads R1/R2,
   • which plugins?                 + license register                 confirms work in the log,
   • which themes?                  + confirmed work log               reads every R3
   • which updates? (our plugin)    build R1, R2, R3                   and sends it to the client
 save the answers as a snapshot     (PDF + CSV)
 snapshots/2026-10-26/site.json     reports/2026-10/…
```

The program never changes a client site. It only reads (HTTP GET).

## Files, one sentence each

| File | What it does |
|---|---|
| `src/index.ts` | The command line: reads `check`, `collect`, `report` or `run` and the options, then calls the right step. |
| `src/workflow.ts` | Runs a collection for real sites, or two collections of the demo sites. |
| `src/config.ts` | Reads `clients.json` and checks every field (`checkSite`). |
| `src/wordpress-client.ts` | Talks to one WordPress site over HTTP (GET only) and checks that the answers look right. |
| `src/collect.ts` | Asks one site its three questions and turns the answers into a clean snapshot (`collectSite`). |
| `src/agency-plugin.ts` | Knows the version of our own status plugin, to tell whether a site has an older copy. |
| `src/snapshot.ts` | Saves snapshots, reads them back, and picks which ones a monthly report uses. |
| `src/types.ts` | Describes what a snapshot looks like (the data shapes). |
| `src/diff.ts` | Compares two snapshots: what was added, removed, updated, activated… |
| `src/agency.ts` | Reads `agency.json` (name, colour, logo, language). |
| `src/csv.ts` | Reads and writes CSV files, including files saved by Excel. |
| `src/dates.ts` | Reads and formats dates (`2026-10-07` and `7. 10. 2026`). |
| `src/files.ts` | Writes a file safely (temp file first, then rename; the temp file is removed if the rename fails). |
| `src/licenses.ts` | Reads `licenses.csv` and decides if a license is valid, expired, missing… |
| `src/maintenance-log.ts` | Reads `maintenance_log.csv` and decides which work is confirmed. |
| `src/report-model.ts` | Collects everything one site's reports need into one object (`buildSiteReport`). |
| `src/reports/generate.ts` | Builds all reports of a month and writes the files. |
| `src/reports/r1.ts`, `r2.ts`, `r3.ts` | Describe what is on each report (titles, tables, texts). |
| `src/reports/pdf.ts` | Shared PDF pieces: fonts, colours, tables, footer, writing the PDF. |
| `src/reports/text.ts` | Every sentence of the client report, in English and Slovenian. |
| `src/sample/fixtures.ts` | The four demo sites (fake data, no real clients). |
| `src/sample/mock-wordpress.ts` | A tiny fake WordPress server for the demo and the tests. |
| `wordpress-plugin/agency-maintenance-status/` | The PHP plugin installed on each client site. |
| `tests/` | The automated tests (`yarn test`). |

## Step 1: collecting (in the order the code runs)

1. **`index.ts` → `main()`** reads the command. For `collect` it loads `clients.json` with `loadSites()` (in `config.ts`).
2. **`workflow.ts` → `collectLive()`** calls `collectSites()` and then saves the results with `writeSnapshots()`.
3. **`collect.ts` → `collectSites()`** works through the sites in small groups (2 at a time by default). For each site it calls `collectSite()`.
4. **`collectSite()`**:
   - takes the site's password from the environment (`.env`). If it's missing, the site fails at once and nothing is sent;
   - asks for the **plugins** (`getPlugins()`). This answer is required: if it fails, the site is marked `failed` and nothing more is asked;
   - asks for the **themes** (`getThemes()`) and our **status endpoint** (`getStatus()`). If one of them fails, the site is `partial`;
   - cleans up the answers (`normalizePlugins()`, `normalizeThemes()`, `normalizeCore()`). Names and versions go through `plainText()`, so `Header &amp; Footer` is saved as `Header & Footer`.
5. **`wordpress-client.ts` → `WordPressClient`** does the actual HTTP work:
   - sends the username and application password (Basic auth);
   - gives up after 15 seconds;
   - retries a few times only for temporary problems (timeout, 429, 502–504);
   - never follows redirects;
   - refuses answers larger than 5 MB (`readBody()`), so a broken or hostile site can't fill the memory;
   - checks the answer's shape, so a firewall page can't crash the program;
   - removes HTML, `&amp;`-style codes and terminal control characters from error messages (`plainText()`).
6. **`snapshot.ts` → `writeSnapshots()`** saves one JSON file per site plus `_run.json` in `snapshots/YYYY-MM-DD/`.

### The update rule (`resolveUpdate()` in `collect.ts`)

WordPress keeps a list from its last update check. We answer **yes** (update available) or **no** (up to date) only when that list clearly says so for the exact installed version. In every other case the answer is **unknown**, with a short reason: no check yet, version changed since the check, premium plugin… An unknown is never reported as "fine".

## Step 2: reports (in the order the code runs)

1. **`generate.ts` → `prepareReports()`** loads `agency.json`, `licenses.csv` and `maintenance_log.csv`, lists the snapshot folders and chooses the month.
2. For each site, **`pickSnapshots()`** (in `snapshot.ts`) picks:
   - the **current** snapshot: the newest one in the month;
   - the **baseline** snapshot: the last good one before the month, used to see what changed.
3. **`buildSiteReport()`** (in `report-model.ts`) puts it all together:
   - one line per component, with its license state (`buildComponents()`);
   - what changed (`diffInventories()` in `diff.ts`);
   - the confirmed and unconfirmed work of that month.
4. **`generateReports()`** writes the files:
   - the CSV with `buildR1Csv()`;
   - the PDFs with `buildR1Pdf()`, `buildR2Pdf()` and `buildR3Pdf()`, each written by `writePdf()`;
   - `_report.json`, a short summary for the Claude skill.

   Every file goes through `save()`. If one file can't be written (for example because it's open in Excel), it becomes a `PROBLEM` line and the other files are still written.

The report builders only *describe* a PDF (lists of texts and tables). `pdf.ts` turns that description into the real file. Because of this split, the tests can check what a report says without opening a PDF.

**The R3 rules live in `r3.ts`.**
- **Work performed:** only `report.work`, the *confirmed* rows of the log.
- **Issues:** come from `issues()`.
- **"No open issues":** used only when nothing is pending or unknown.

## The WordPress plugin (PHP)

`agency-maintenance-status.php` does three things:

1. **Adds one read-only address:** `GET /wp-json/agency-maintenance/v1/status`. It returns the WordPress version and WordPress' saved update lists (`get_status()`).
2. **Adds the role** "Maintenance Auditor (read-only)" when activated, and removes it when deactivated (the fail-safe).
3. **Guards the auditor account**, because WordPress requires "manage plugins" rights just to *list* plugins:
   - `filter_auditor_caps()` gives those rights only while a read-only REST request is running;
   - `block_auditor_writes()` refuses every REST request from the auditor that is not a read (403);
   - `block_auditor_xmlrpc()` refuses XML-RPC logins with the auditor account.

   `is_auditor()` decides who is the auditor: every account that has the auditor role, even if it also has another role. So an extra role can never switch the guards off.

## The demo and the tests

- `yarn demo` starts the fake WordPress (`mock-wordpress.ts`) with the four demo sites from `fixtures.ts`. It collects them twice (September and October) and builds the October reports. The fixed dates make the output identical on every run.
- The tests in `tests/` use the same fake WordPress, so they need no real site and no password. Each test name says what it checks, for example *"observed changes are in R2 but never appear in R3 as work"*.
- `yarn verify` runs the typecheck, the format check and all tests. Run it after every change.

## How do I…

| I want to… | Change this |
|---|---|
| change a sentence in the client report | `src/reports/text.ts` (both `en` and `sl`) |
| change the agency name, colour, logo or report language | `agency.json` (no code change) |
| add or remove a client site | `clients.json` and `.env` ([07](07-monthly-workflow.md#adding-a-new-site)) |
| add a maintenance action (for example `migrate`) | `MaintenanceAction` and `MAINTENANCE_ACTIONS` in `src/maintenance-log.ts`, plus `actions` in both languages in `src/reports/text.ts` |
| add a license status | `LicenseStatus` and `LICENSE_STATUSES` in `src/licenses.ts`, plus its colour in `statusColor()` in `src/reports/pdf.ts` |
| add a column to the R1 CSV | `R1_COLUMNS` and `componentCsvRow()` in `src/reports/r1.ts` |
| change the 15-second timeout or the 2 retries | `DEFAULT_CLIENT_OPTIONS` in `src/wordpress-client.ts` (or the `--timeout` and `--retries` options) |
| change the demo data | `src/sample/fixtures.ts` and the files in `samples/` |
| check that nothing broke | `yarn verify`, then `yarn demo` and look at the reports |

TypeScript tells you if a change is missing somewhere. For example, a new maintenance action without its Slovenian text makes `yarn typecheck` fail.
