# 07 · Monthly workflow

The tool runs only when a person starts it. It never updates anything by itself.

## Commands

| Command | What it does |
|---|---|
| `yarn check-config` | checks all settings and that every password is set. Sends nothing |
| `yarn collect` | reads every site (add `--details` to see every plugin) |
| `yarn report` | makes the reports. `--period 2026-10` picks a month |
| `yarn monthly` | `collect`, then `report` |
| `yarn demo` | the same with demo sites |
| `yarn clean` | deletes snapshots, reports and demo files |

Useful options: `--site <siteId>` for one site, `--timeout 60000` for slow sites. All options: `yarn wpm --help`.

Exit codes: `0` OK, `1` a settings error, `2` a site failed or a report couldn't be written (the other sites are still done).

## Every month

1. **During the month:** write each task in `maintenance_log.csv` right away. Leave the two confirmation columns empty.
2. **When the work is checked:** fill in `confirmation_by` and `confirmation_at`. Only then does the client see it.
3. **Licenses:** update `licenses.csv` when a license is bought or renewed.
4. **At the end of the month:**

   ```powershell
   yarn check-config
   yarn monthly
   ```

   For a month that is already over, use `yarn report --period 2026-10`.
5. **Check:** open `reports\2026-10\r1-consolidated-2026-10.pdf`. Fix problems ([03 troubleshooting](03-test-environment.md#troubleshooting)), confirm the open work, then run `yarn report --period 2026-10` again.
6. **Send:** read every `r3-client-…pdf` and send it to the client. R1, R2 and the CSV are internal. Never send them.

## With Claude Code

Type the skill in Claude Code:

```
/wordpress-maintenance check
/wordpress-maintenance run
/wordpress-maintenance report 2026-10
/wordpress-maintenance demo
```

Claude runs the same commands and gives a short summary. It never opens `.env`, never asks for passwords, never changes sites and never edits the work log.

## Adding a new site

1. Make sure the agency is **allowed** to maintain it.
2. Install the status plugin and create the auditor user and password: [05 checklist](05-status-endpoint.md#add-a-client-site-checklist).
3. Add the password to `.env`: `WP_ACME_SHOP_APP_PASSWORD=xxxx xxxx xxxx xxxx xxxx xxxx`
4. Add the site to `clients.json`:

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

   Use lowercase letters, numbers and dashes for `siteId`. Don't change it later.
5. Test: `yarn check-config`, then `yarn collect --site acme-shop --details`.

**Remove a site:** delete it from `clients.json` and `.env`, and delete its application password in wp-admin.

## Passwords

- Every site has its own password in its own `.env` line.
- Passwords are never written in `clients.json`, reports, e-mail or chat.
- **Change** a password once a year or when someone leaves: make a new one in wp-admin, put it in `.env`, test, then delete the old one.
- **If a password leaked:** delete it in wp-admin right away.

## Running again

| Situation | What to do |
|---|---|
| one site failed | fix it, then `yarn collect --site <id>` and `yarn report --period <YYYY-MM>` |
| log or licenses changed | `yarn report --period <YYYY-MM>` |
| ran twice on one day | fine, the files are replaced |
| a step was stopped halfway | run it again. A half-written file never replaces a good one |
| a report file is open in Excel | close it and run `yarn report --period <YYYY-MM>` again |
