# 08 · Handover

Everything the agency needs to install, run, check and take over the WordPress Maintenance Skill. Each section is short and links to the detailed page.

## 1. What it does, in one minute

- Once a month a person runs it. It **reads** every client site and **never changes** one.
- For each site it reads: the WordPress version, **all** plugins, **all** themes, and which updates WordPress knows about.
- It adds two files that people keep up to date: the license register and the log of confirmed work.
- It writes three reports:
  - **R1**: all sites in one PDF, plus a CSV for Excel (internal)
  - **R2**: one detailed PDF per site (internal)
  - **R3**: one branded PDF per site for the client, in Slovenian or English
- A person reads every R3 before it is sent.

## 2. Install on the agency computer

1. Install **Node.js 22.18 or newer** (tested with 24.22) and **Yarn 1** (`npm install -g yarn`).
2. Put the project folder on the computer (for example `git clone`).
3. In the project folder:

   ```powershell
   yarn install
   yarn verify     # expect: tests 102, pass 102, fail 0
   yarn demo       # demo reports in sample-output\reports\2026-10\
   ```

   `yarn demo` ends with `error Command failed with exit code 2`. That is expected: one demo site refuses access on purpose, to show that a failing site doesn't stop the others.

## 3. Sample configuration

Copy each template and fill it in. The examples in the templates show the format.

| Your file | Copy from | Contains | Secret? | In Git? |
|---|---|---|---|---|
| `clients.json` | `clients.example.json` | the list of sites | no | no (client data) |
| `.env` | `.env.example` | one application password per site | **yes** | **never** |
| `agency.json` | `agency.example.json` | agency name, colour, logo, report language, CSV separator | no | yes, if you want |
| `licenses.csv` | `licenses.example.csv` | license register (optional) | no | no (client data) |
| `maintenance_log.csv` | `maintenance_log.example.csv` | confirmed work (optional) | no | no (client data) |

Then run `yarn check-config`. It checks every file and that every password variable is set, without sending anything. Field-by-field explanations: [01](01-field-specification.md) and [06](06-license-register-and-maintenance-log.md).

## 4. Install the status plugin on a client site

Do this only for sites the agency is authorised to maintain. The full checklist is in [05](05-status-endpoint.md#onboarding-a-client-site-checklist). In short:

1. Upload the folder `wordpress-plugin/agency-maintenance-status/` as a plugin and activate it.
2. Create the user `maintenance-auditor` with **only** the role *Maintenance Auditor (read-only)*.
3. Create an application password for that user and put it in `.env` (and nowhere else).
4. Add the site to `clients.json`, then run `yarn check-config` and `yarn collect --site <id> --details`.

The current plugin version is **1.0.2**. If a site runs an older copy, `yarn collect` lists it as an update. To update, copy the new folder over the old one.

## 5. Every month

`yarn check-config`, then `yarn monthly`. Next: read R1, fix problems, confirm the remaining work in the log, run `yarn report --period YYYY-MM` again, read every R3 and send it. The full runbook, including adding a site, managing passwords and re-running, is in [07](07-monthly-workflow.md).

In Claude Code you can type `/wordpress-maintenance run` instead (see [07](07-monthly-workflow.md#with-claude-code)).

## 6. Security notes

- **Read-only.** The collector only sends GET requests (tested). On the site, the auditor account is refused with 403 for every write, including method tricks and batch requests, and it can't log in over XML-RPC. This stays true if the account gets a second role (tested live).
- **Fail-safe.** If the status plugin is deactivated, the auditor role disappears and the account can't read or change anything.
- **Passwords** live only in `.env`. They never appear in `clients.json`, snapshots, reports, logs or Claude's context. The Claude skill is told never to open `.env`.
- **HTTPS** is required (plain `http://` only for a local test site on this computer). Certificates are always checked: a self-signed certificate is refused. Redirects are never followed with the password.
- **Client report (R3)** contains only confirmed work: no internal notes, no error messages, no other clients and no "all fine" claim when something is unknown (tested).
- **Client data** (`clients.json`, `licenses.csv`, `maintenance_log.csv`, `snapshots/`, `reports/`) stays on the agency computer and is git-ignored. R1 and R2 are internal and must never be sent to clients.
- **Revoke access** to a site by deleting the application password in wp-admin, or by deactivating the plugin.

## 7. Tests

- `yarn verify` runs the typecheck, the format check and **102 automated tests**. They use a built-in fake WordPress, so no real site and no password is needed.
- They include every acceptance test from the specification and the error cases. The list, the live results on the local WordPress, and the checklist for the real-site test are in [11](11-test-report.md).

## 8. Ten-minute demo

The script, with timings and what to say, is in [10](10-demo-script.md).

## 9. Known limitations

- Single-site WordPress only; multisite has not been tested.
- Premium plugins with their own update system usually show as "needs a manual check". WordPress doesn't report their updates.
- Must-use plugins in sub-folders are not listed (wp-admin doesn't list them either).
- The tool cannot check licenses with vendors. The license register is maintained by people.
- R1 and R2 are in English; R3 is in Slovenian or English.
- On the local XAMPP test computer, stop MySQL with the Control Panel's **Stop** button before shutting down.

## 10. Not built (optional in the specification)

The specification lists these as optional "only if time remains". They were not built, to keep the tool simple:

- a sortable HTML copy of R1
- expiry reminders (licenses that expire soon)
- direct license checks with commercial plugin vendors
- a longer change history over many months

There is no dashboard and there are no automatic updates, by design.

## 11. Where things are

[README](../README.md) gives the short folder map. [09 · How the code works](09-code-guide.md) explains every file and how to make common changes.
