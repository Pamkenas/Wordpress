# 10 · Ten-minute demo

A script for showing the project in 10 minutes. The demo uses only fake data, so it is safe to show on a projector.

## Before the meeting (5 minutes)

```powershell
yarn install
yarn verify        # tests 102, pass 102
yarn demo          # builds sample-output\reports\2026-10\
```

Open in advance:

- `sample-output\reports\2026-10\` in Explorer
- `samples\maintenance_log.sample.csv` in Excel or VS Code
- optional, for the live part: XAMPP Control Panel with **Apache** and **MySQL** started

## The ten minutes

| Time | Show | Say |
|---|---|---|
| 0:00–1:00 | README, first paragraph | "The agency maintains many WordPress sites. Once a month this tool reads every site, never changes one, and writes three reports. A person checks everything before a client sees it." |
| 1:00–2:30 | Run `yarn demo` | "Four demo sites: a healthy site with 15 plugins (demo-bakery), a shop with updates and license problems, a site without our status plugin (partial), and a site that refuses access (failed). The failing site doesn't stop the others. That's the 'exit code 2' at the end." |
| 2:30–4:00 | `r1-consolidated-2026-10.pdf`, then `r1-inventory-2026-10.csv` in Excel | "R1 is the overview for the agency: every site's status, updates, unknowns and license problems. The CSV has a row for every plugin on every site. In Excel, filter by plugin name, update status or license status." |
| 4:00–5:30 | `r2-internal-demo-shop-2026-10.pdf` | "R2 is the internal report for one site: all plugins including inactive ones; *unknown* always with a reason; an expired license that was recorded as valid; a typo in the register with a 'did you mean' hint; and the changes since last month, clearly marked as *observations*." |
| 5:30–7:00 | `maintenance_log.sample.csv`, then `r3-client-demo-shop-2026-10.pdf` | "Only work that a person confirmed reaches the client. The Old Slider removal isn't confirmed yet, so it isn't in R3. Internal notes are never in R3. The report is in Slovenian; English is one setting in `agency.json`." |
| 7:00–8:30 | Live (optional): `yarn check-config`, then `yarn monthly` against the local WordPress | "On a real WordPress the account we use is read-only. Every attempt to change something gets HTTP 403; we tested this. Deactivating our plugin removes all its access immediately." If XAMPP isn't running, show the security table in [11](11-test-report.md#4-security-checks) instead. |
| 8:30–9:30 | Claude Code: `/wordpress-maintenance demo` | "The Claude Code skill runs the same commands and summarises the result. It never opens the password file and never changes the work log." |
| 9:30–10:00 | `yarn verify` result | "102 automated tests, including every acceptance test from the specification." |

## Questions people usually ask

| Question | Short answer |
|---|---|
| Can it break a client site? | No. It only sends GET requests, and the WordPress account it uses is refused for every write (tested). |
| What if a site is down? | That site is marked *failed* with the reason; all other sites are still reported. |
| Why are some plugins "unknown"? | WordPress can't tell us, for example premium plugins with their own updater. The tool says so instead of guessing "up to date". |
| Where are the passwords? | Only in `.env` on the agency computer. They are never in reports, snapshots or Git. |
| Does it update plugins automatically? | No, by design. People update; the tool reports. |
| How is work shown to the client? | Only rows in `maintenance_log.csv` that a person confirmed (`confirmation_by` and `confirmation_at`). |
| How long does a run take? | A few seconds per site. Sites are read two at a time. |
