# 07 · Monthly workflow, adding sites, credentials and re-running (Week 4)

The skill runs only when a person starts it. There is no scheduler and no automatic update, by design.

## Commands

| Command | Does |
|---|---|
| `yarn check-config` | checks `clients.json`, the passwords in `.env` (names only, never values), `agency.json`, `licenses.csv`, `maintenance_log.csv` and existing snapshots. Sends no requests. |
| `yarn collect` | reads every site into `snapshots/YYYY-MM-DD/` (add `--details` to print every plugin) |
| `yarn report` | builds R1, R2 and R3 for the month of the newest snapshot; `--period 2026-10` picks a month |
| `yarn monthly` | `collect`, then `report`: the whole workflow |
| `yarn demo` | the same with the built-in demo sites; output in `sample-output/` |
| `yarn wpm <command> [options]` | the same commands in one form (`check`, `collect`, `report`, `run`), used by the Claude skill |

Options for all of them: `--site <siteId>` (repeatable), `--config <file>`, `--concurrency`, `--timeout`, `--retries`; see `yarn wpm --help`.

Exit codes: `0` done, `1` configuration or usage error (nothing collected), `2` at least one site failed or a report could not be written. The other sites are still processed.

## Every month

1. **During the month**, whoever works on a site records each task in `maintenance_log.csv` right away, leaving `confirmation_by` and `confirmation_at` empty.
2. **When the work is checked** (the site works, the version is right), the checker fills in both confirmation columns. Only then does the task appear in the client report.
3. **Licenses**: when a license is bought, renewed or verified, update `licenses.csv`.
4. **End of the month**, in the project folder:

   ```powershell
   yarn check-config
   yarn monthly
   ```

   For a month that is already over (for example on 2 November for October): `yarn report --period 2026-10`. The report uses the last October snapshot, so collect before the month ends.
5. **Review internally**: open `reports/2026-10/r1-consolidated-2026-10.pdf`. Fix collection problems (see [03 troubleshooting](03-test-environment.md#troubleshooting)), confirm the remaining log entries listed under "Unconfirmed log entries" in R2, then run `yarn report --period 2026-10` again. That overwrites the files.
6. **Send to clients**: read every `r3-client-<site>-2026-10.pdf` before sending. R1, R2 and the CSV are internal and are never sent.

## With Claude Code

In this project folder, Claude Code offers the skill `/wordpress-maintenance` (file: `.claude/skills/wordpress-maintenance/SKILL.md`). It runs only when you type it.

```
/wordpress-maintenance check
/wordpress-maintenance run
/wordpress-maintenance report 2026-10
/wordpress-maintenance collect acme-main
/wordpress-maintenance demo
```

Claude runs `yarn wpm ...`, reads only the summary files `_run.json` and `_report.json`, and replies with each site's status, failures with likely fixes, the work still waiting for confirmation, and where the files are.

Its rules: it never opens `.env`, never asks for passwords, never contacts sites itself, never changes sites, and never edits or confirms the maintenance log.

## Adding a new site

1. Check that the agency is **authorised** to maintain the site.
2. On the site: install the **Agency Maintenance Status** plugin, create the `maintenance-auditor` user with only the *Maintenance Auditor (read-only)* role, and create an application password. Steps: [05 onboarding](05-status-endpoint.md#onboarding-a-client-site-checklist).
3. In `.env`, add one line with a new variable name: `WP_ACME_SHOP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx`
4. In `clients.json`, add an entry:

   ```json
   {
     "siteId": "acme-shop",
     "clientId": "acme",
     "clientName": "Acme d.o.o.",
     "url": "https://shop.acme.example",
     "username": "maintenance-auditor",
     "passwordEnv": "WP_ACME_SHOP_APP_PASSWORD"
   }
   ```

   `siteId` and `clientId` use lowercase letters, digits and dashes. Keep the `siteId` stable: it names the snapshot files and links the license register and the work log.
5. Optional: add the site's premium plugins to `licenses.csv`.
6. Test only this site: `yarn check-config`, then `yarn collect --site acme-shop --details`.

**Removing a site**: delete its entry from `clients.json`, its line from `.env`, and the application password in wp-admin. Old snapshots stay for history.

## Managing credentials

- Each site has its **own** application password in its **own** `.env` variable. One leaked password then affects only one site.
- The password is never written to `clients.json`, snapshots, reports, logs, tickets, e-mail or chat. `clients.json` refuses fields that look like secrets.
- **Rotate** (for example once a year, or when someone with access leaves): in wp-admin, Users → maintenance-auditor → Application Passwords, add a new one, put it in `.env`, run `yarn collect --site <id>`, then revoke the old one.
- **Revoke immediately** if a password may have leaked: delete the application password in wp-admin. Deactivating the status plugin also removes all access at once, because the auditor role is removed with it.
- `.env` stays on the agency machine. Give it only to people who run the reports.

## Re-running

| Situation | Do |
|---|---|
| one site failed (403, timeout …) | fix the cause, then `yarn collect --site <id>` and `yarn report --period <YYYY-MM>` |
| log or license register corrected | `yarn report --period <YYYY-MM>`; no new collection needed |
| collected twice on the same day | fine: that day's files are replaced |
| report built twice | fine: the month's files are replaced; out-of-date files are reported as a `NOTE` |
| a step was interrupted | run it again; files are written to `.tmp` first and renamed, so a half-written file never replaces a good one |

## Demo (no real sites)

```powershell
yarn demo
```

It simulates two collection runs (23 September and 21 October 2026) of four demo sites and builds the October reports in `sample-output/reports/2026-10/`. The results are the same on every run. It shows a site with 15 plugins and no updates, updates and license problems, a site without the status plugin (partial), a site that answers 403 (failed), confirmed and unconfirmed work, and a WordPress auto-update that appears only as an observation.
