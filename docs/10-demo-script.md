# 10 · Ten-minute demo

The demo uses only fake data, so it is safe to show.

## Before the meeting

```powershell
yarn install
yarn verify        # tests 102, pass 102
yarn demo          # makes sample-output\reports\2026-10\
```

Open these in advance:

- the folder `sample-output\reports\2026-10\`
- `samples\maintenance_log.sample.csv`
- optional: XAMPP with Apache and MySQL running

## The ten minutes

| Time | Show | Say |
|---|---|---|
| 0–1 | the README | "Once a month this tool reads every client site, never changes one, and makes three reports." |
| 1–2:30 | run `yarn demo` | "Four demo sites: a healthy one with 15 plugins, a shop with updates, one without our plugin, and one that refuses access. The failing site doesn't stop the others." |
| 2:30–4 | R1 PDF, then the CSV in Excel | "R1 is the overview. The CSV has every plugin of every site, so you can filter it." |
| 4–5:30 | R2 for demo-shop | "R2 shows all plugins, why something is unknown, license problems, and changes since last month." |
| 5:30–7 | the work log, then R3 for demo-shop | "Only work a person confirmed reaches the client. Internal notes never do." |
| 7–8:30 | optional: `yarn monthly` on the local WordPress | "Our WordPress account is read-only. Every write gets 403." Without XAMPP, show [11](11-test-report.md#security-checks). |
| 8:30–9:30 | Claude Code: `/wordpress-maintenance demo` | "Claude runs the same commands and summarises. It never sees the passwords." |
| 9:30–10 | the `yarn verify` result | "102 tests, including every acceptance test from the spec." |

## Common questions

| Question | Answer |
|---|---|
| Can it break a site? | No. It only reads, and every write is refused (tested). |
| What if a site is down? | That site is marked *failed*. The others are still reported. |
| Why are some plugins "unknown"? | WordPress can't check them (for example premium plugins). The tool doesn't guess. |
| Where are the passwords? | Only in `.env` on the agency computer. |
| Does it update plugins? | No. People update, the tool reports. |
| How is work shown to the client? | Only confirmed rows of `maintenance_log.csv`. |
| How long does it take? | A few seconds per site. |
