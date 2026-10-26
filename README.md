# WordPress Maintenance Skill

A tool for a web agency that maintains WordPress sites for its clients. Once a month a person runs it, and it does four things:

1. It **reads** every client site: the WordPress version, **all** plugins, **all** themes, and the updates WordPress knows about. It never changes a site.
2. It saves what it read as a dated **snapshot**.
3. It adds two files that people keep up to date: the **license register** and the **log of confirmed work**.
4. It writes three reports:
   - **R1**: all sites in one PDF, plus a CSV for Excel (internal)
   - **R2**: one detailed PDF per site (internal)
   - **R3**: one branded PDF per site for the client, in Slovenian or English. Only work that a person confirmed appears in it.

**Status:** Weeks 1–5 are complete. All 102 automated tests and the live tests on the local WordPress pass ([test report](docs/11-test-report.md)). The test on 2–3 real client sites needs the agency's access, so its checklist is ready in [docs/11](docs/11-test-report.md), section 5.

## Try it in 2 minutes (no real sites needed)

Needs Node.js 22.18 or newer (tested with 24.22) and Yarn 1.

```powershell
yarn install
yarn demo        # four demo sites, reports in sample-output\reports\2026-10\
yarn verify      # typecheck + format check + 102 tests
```

`yarn demo` ends with "exit code 2". That is expected: one demo site refuses access on purpose, to show that a failing site doesn't stop the others.

## Use it with real sites

1. Copy the templates and fill them in:

   ```powershell
   copy clients.example.json clients.json                 # the list of sites (no passwords)
   copy .env.example .env                                 # one application password per site
   copy agency.example.json agency.json                   # agency name, colour, logo, report language
   copy licenses.example.csv licenses.csv                 # optional: license register
   copy maintenance_log.example.csv maintenance_log.csv   # optional: confirmed work
   ```

2. Install the status plugin on each client site: [docs/05 checklist](docs/05-status-endpoint.md#onboarding-a-client-site-checklist).
3. Every month, run `yarn check-config`, then `yarn monthly`. The full routine is in [docs/07](docs/07-monthly-workflow.md).

## Commands

| Command | What it does |
|---|---|
| `yarn check-config` | checks every file and that each password is set; sends nothing |
| `yarn collect [--site id] [--details]` | reads the sites and saves a snapshot in `snapshots\YYYY-MM-DD\` |
| `yarn report [--period YYYY-MM]` | writes the reports to `reports\YYYY-MM\` |
| `yarn monthly` | `collect`, then `report` |
| `yarn demo` | the same with the built-in demo sites |
| `yarn verify` | typecheck, format check and all tests |
| `yarn clean` | deletes `snapshots/`, `reports/` and `sample-output/` so the next run starts fresh (settings, licenses and work log are kept) |
| `yarn wpm --help` | every command and option |

Exit codes: `0` done, `1` configuration or usage error, `2` a site failed or a report couldn't be written (the other sites are still processed).

In Claude Code, type `/wordpress-maintenance run` (or `check`, `report 2026-10`, `demo`).

## Documentation

| | Page | What's in it |
|---|---|---|
| 01 | [Field specification](docs/01-field-specification.md) | every field, where it comes from, the yes/no/unknown rule |
| 02 | [Reports R1, R2, R3](docs/02-sample-reports.md) | what each report contains, with pictures |
| 03 | [Test environment](docs/03-test-environment.md) | the local XAMPP WordPress: setup, results, troubleshooting |
| 04 | [REST permissions and update data](docs/04-rest-permissions-and-update-data.md) | what WordPress allows and returns (Week 1 investigation) |
| 05 | [Status endpoint](docs/05-status-endpoint.md) | the plugin for client sites, its security, adding it to a site |
| 06 | [License register and work log](docs/06-license-register-and-maintenance-log.md) | the two CSV files, with Excel tips |
| 07 | [Monthly workflow](docs/07-monthly-workflow.md) | the monthly routine, adding a site, passwords, re-running |
| 08 | [Handover](docs/08-handover.md) | install, configuration, security notes, limitations |
| 09 | [How the code works](docs/09-code-guide.md) | a simple tour of every file |
| 10 | [Ten-minute demo](docs/10-demo-script.md) | what to show and what to say |
| 11 | [Test report](docs/11-test-report.md) | every test and its result, and the checklist for real sites |

## Folders

| Path | What |
|---|---|
| `src/` | the program (TypeScript that Node runs directly) |
| `tests/` | the automated tests |
| `wordpress-plugin/agency-maintenance-status/` | the plugin to install on each client site |
| `.claude/skills/wordpress-maintenance/` | the Claude Code skill |
| `tools/` | the setup script for the local test WordPress |
| `docs/` | the documentation (table above) |
| `samples/` | demo inputs and example outputs (fake data only) |
| `*.example.*` | templates to copy |

The agency's own files (`clients.json`, `.env`, `licenses.csv`, `maintenance_log.csv`, `snapshots/`, `reports/`) stay on the agency computer. Git ignores them.

## Security in short

- **Read-only:** the program sends only GET requests. On each site the auditor account is refused (403) for every write and can't log in over XML-RPC, even if it gets a second role. All of this is tested.
- **Passwords** live only in `.env`. They never appear in `clients.json`, snapshots, reports or Claude's context.
- **HTTPS** with certificate checks. Plain `http://` is allowed only for a local test site on this computer. Redirects are never followed with the password.
- **One failing site** never stops the others.
- **The client report** shows only work that a person confirmed: no internal notes, no error details, no other clients.

More in [docs/08, section 6](docs/08-handover.md#6-security-notes).

## Progress

| Week | Work | Status |
|---|---|---|
| 1 | Confirm the fields and sample reports, set up a test WordPress, investigate REST permissions and update data | ✅ [01](docs/01-field-specification.md), [02](docs/02-sample-reports.md), [03](docs/03-test-environment.md), [04](docs/04-rest-permissions-and-update-data.md) |
| 2 | Secure status endpoint; collector for core, all plugins and all themes | ✅ [05](docs/05-status-endpoint.md), `wordpress-plugin/`, `src/collect.ts` |
| 3 | Snapshots, site configuration, license register, change detection, R1 and R2 | ✅ [06](docs/06-license-register-and-maintenance-log.md), `src/snapshot.ts`, `src/reports/` |
| 4 | Confirmed work log, branded R3, Claude skill, command line | ✅ [07](docs/07-monthly-workflow.md), `src/reports/r3.ts`, `.claude/skills/`, `src/index.ts` |
| 5 | Error cases, documentation, handover, demo | ✅ [08](docs/08-handover.md), [09](docs/09-code-guide.md), [10](docs/10-demo-script.md), [11](docs/11-test-report.md), `tests/negative.test.ts` |
| 5 | Test on 2–3 authorised client sites | needs the agency's access: checklist in [11](docs/11-test-report.md), section 5 |
