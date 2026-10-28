# WordPress Maintenance Skill

A tool that reads WordPress client sites once a month and makes reports. It never changes a site.

It writes three reports:

- **R1**: all sites in one PDF and one CSV (internal)
- **R2**: one PDF per site (internal)
- **R3**: one PDF per site for the client

## Run Commands

```powershell
yarn install
yarn demo
yarn verify
```

- `yarn demo` makes demo reports in `sample-output\reports\2026-10\`. It ends with "exit code 2", which is normal: one demo site fails on purpose.
- `yarn verify` runs all 102 tests.

## How use with real sites

1. Copy the example files:

   ```powershell
   copy clients.example.json clients.json
   copy .env.example .env
   copy agency.example.json agency.json
   ```

2. Install the status plugin on each site: [docs/05](docs/05-status-endpoint.md#add-a-client-site-checklist).
3. Every month run:

   ```powershell
   yarn check-config
   yarn monthly
   ```

## Commands

| Command | What it does |
|---|---|
| `yarn check-config` | checks the settings, sends nothing |
| `yarn collect` | reads the sites |
| `yarn report` | makes the reports |
| `yarn monthly` | `collect`, then `report` |
| `yarn demo` | the same with demo sites |
| `yarn verify` | runs all tests |
| `yarn clean` | deletes old snapshots and reports |

## Security

- Only reads, never writes.
- Passwords are only in `.env`.
- HTTPS only (plain `http://` only for a test site on this computer).

More: [docs/08-handover.md](docs/08-handover.md).

## WP Control

The two WordPress plugins from the WP Control spec (Manager and Agent) are in [wp-control/](wp-control/README.md).
