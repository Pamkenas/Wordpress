# 08 · Handover

Everything the agency needs to install, run and take over the tool.

## What it does

- Once a month a person runs it.
- It **reads** every client site and **never changes** one.
- It writes three reports:
  - **R1:** all sites in one PDF and one CSV (internal)
  - **R2:** one PDF per site (internal)
  - **R3:** one PDF per site for the client, in Slovenian or English
- A person reads every R3 before it is sent.

## Install

1. Install **Node.js 22.18 or newer** and **Yarn 1** (`npm install -g yarn`).
2. Get the project folder (for example with `git clone`).
3. Run:

   ```powershell
   yarn install
   yarn verify     # should show: tests 102, pass 102, fail 0
   yarn demo       # demo reports in sample-output\reports\2026-10\
   ```

   `yarn demo` ends with "exit code 2". That is normal: one demo site fails on purpose.

## Settings

Copy each example file and fill it in:

| Your file | Copy from | What it is | In Git? |
|---|---|---|---|
| `clients.json` | `clients.example.json` | the list of sites | no |
| `.env` | `.env.example` | one password per site (**secret**) | **never** |
| `agency.json` | `agency.example.json` | name, colour, logo, language | yes, if you want |
| `licenses.csv` | `licenses.example.csv` | license register (optional) | no |
| `maintenance_log.csv` | `maintenance_log.example.csv` | confirmed work (optional) | no |

Then run `yarn check-config`. Details: [01](01-field-specification.md) and [06](06-license-register-and-maintenance-log.md).

## Client sites

Install the status plugin (version **1.0.2**) on every site and create the auditor user. Checklist: [05](05-status-endpoint.md#add-a-client-site-checklist).

## Every month

Run `yarn check-config`, then `yarn monthly`. Then check R1, confirm the work, and send the R3 reports. Full steps: [07](07-monthly-workflow.md).

## Security

- The tool only reads. On each site the auditor account is refused for every write and can't log in over XML-RPC (tested).
- If the status plugin is deactivated, the account can do nothing.
- Passwords are only in `.env`. They are never in reports, snapshots or Git.
- HTTPS is required. Certificates are always checked.
- R3 shows only confirmed work. No internal notes, no errors, no other clients.
- Client data stays on the agency computer.
- To remove access, delete the application password in wp-admin.

## Tests

`yarn verify` runs 102 tests with a fake WordPress, so no real site is needed. Results: [11](11-test-report.md).

## Demo

A 10-minute demo script: [10](10-demo-script.md).

## Limits

- Only normal WordPress sites (multisite is not tested).
- Premium plugins usually show "needs a manual check", because WordPress can't check them.
- The tool can't check licenses with vendors. People keep the register.
- R1 and R2 are in English. R3 is in Slovenian or English.

Not built (optional in the spec): HTML version of R1, expiry reminders, vendor license checks, long history. There is no dashboard and no automatic update, on purpose.

## The code

[09 · How the code works](09-code-guide.md) explains every file.
