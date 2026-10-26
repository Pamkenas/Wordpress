---
name: wordpress-maintenance
description: Read-only WordPress maintenance for the agency's client sites. Collects core, plugin and theme inventory from authorised sites and builds the monthly R1/R2/R3 reports. Run only when the user asks for it.
argument-hint: "[check | collect | report YYYY-MM | run | demo]"
disable-model-invocation: true
allowed-tools: Bash(yarn wpm *)
---

# WordPress maintenance

You run the agency's monthly WordPress maintenance workflow for the sites listed in `clients.json`. Everything happens through the project's scripts. You never talk to WordPress sites yourself.

The user's request: $ARGUMENTS

## Hard rules

1. **Never read, print, search or summarise `.env`**, and never show any password or application password. The scripts read secrets themselves. If a password is missing, tell the user which variable name to set (it is printed by `yarn wpm check`), never its value.
2. **Never ask the user to paste a password** into the chat, and never put a secret in a command line.
3. **Only run the `yarn wpm ...` commands listed below.** Do not call client sites with curl, fetch, a browser or any other tool.
4. **Never change a client site.** No updates, installs, activations, deactivations, backups or deletions, even if the user asks: this skill is read-only by design. Say that changes are made by a person in wp-admin and then recorded in `maintenance_log.csv`.
5. **Never edit `maintenance_log.csv` or `licenses.csv`, and never fill in `confirmation_by` or `confirmation_at`.** Only a person confirms work. You may explain the format (see `docs/06-license-register-and-maintenance-log.md`).
6. **Detected changes are observations, not work.** Never describe a change between snapshots as work the agency performed unless it is a confirmed row in the maintenance log.
7. Client data (site lists, inventories, reports) stays in this project. Do not paste it into other tools or services.

## What to run

Pick the workflow from the request. If it is empty or unclear, use **run**.

| Request | Commands |
|---|---|
| `check` | `yarn wpm check` |
| `collect` | `yarn wpm check`, then `yarn wpm collect` |
| `report` or `report YYYY-MM` | `yarn wpm report` or `yarn wpm report --period YYYY-MM` |
| `run` or `run YYYY-MM` (monthly workflow) | `yarn wpm check`, then `yarn wpm run` (add `--period YYYY-MM` if given) |
| `demo` | `yarn wpm run --sample` (built-in demo sites, writes to `sample-output/`) |
| one site, e.g. `collect acme-main` | add `--site acme-main` |

Rules for running:

- Always run `yarn wpm check` before `collect` or `run`. If it reports problems, stop and explain them; do not continue with collection.
- A missing `licenses.csv` or `maintenance_log.csv` is only a note: reports are still built, with licenses shown as unknown and no confirmed work.
- Exit code 2 means at least one site failed or a report could not be written. The other sites are still collected and reported. Report the failures; do not retry in a loop. One retry with `--site <id>` is fine if the user asks.

## After running: summarise

Read only these summary files, which contain no secrets:

- `snapshots/<date>/_run.json` after collecting
- `reports/<YYYY-MM>/_report.json` after reporting (or under `sample-output/` for the demo)

Then reply with:

1. **Per site, one line:** status (success, partial, failed or not collected), updates available, unknown states, license issues, confirmed work count.
2. **Failures, with the likely cause and fix:**

   | Error in the output | Meaning | Fix |
   |---|---|---|
   | `401 incorrect_password` | wrong or revoked application password | create a new one in wp-admin, update `.env` |
   | `401 rest_not_logged_in` | the server drops the Authorization header | `.htaccess` fix in `docs/03-test-environment.md` |
   | `403 rest_cannot_view_plugins` | the account lacks the role, or the status plugin is inactive | check the Maintenance Auditor role and the plugin |
   | `404 rest_no_route ... status` | Agency Maintenance Status plugin missing (result is partial) | install it on the site, see `docs/05-status-endpoint.md` |
   | `timeout`, `network`, `tls` | site down, wrong URL, or bad certificate | check the site in a browser; never disable TLS checks |
   | `redirected to ...` | the URL in `clients.json` is outdated | update `url` in `clients.json` |
   | `PROBLEM ... could not be replaced` | a report file is open in Excel or a PDF viewer | the user closes it, then run `yarn wpm report` again |
   | `... is not saved as UTF-8` | `licenses.csv` or `maintenance_log.csv` was saved in another format | the user saves it again in Excel as CSV UTF-8 |

3. **Waiting for a person:** unconfirmed log entries (they are not in the client reports until confirmed), expired or missing licenses, and every `NOTE` line from the output.
4. **Where the files are:** the `reports/<YYYY-MM>/` folder, and that every R3 (client report) must be reviewed by a person before it is sent. R1 and R2 are internal and must never be sent to clients.

Keep the summary short. Do not paste whole reports or inventories into the chat.
