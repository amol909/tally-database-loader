# Tally DB Connector CLI

`tallydb` is the primary terminal application for configuring and running Tally to database sync.

The CLI uses `config.json` in the project folder as its source of truth. You can edit that file manually or use the setup wizard.

## Commands

```bat
tallydb
tallydb setup
tallydb sync
tallydb test
tallydb companies
tallydb config init
tallydb config show
tallydb config validate
```

The long alias `tally-db-connector` points to the same CLI.

## Main Menu

Running `tallydb` without a command opens an interactive menu:

```text
Run sync
Setup / update config
Test connections
List open Tally companies
Show config
Exit
```

This is also what `run.bat` launches.

## Setup

Use setup to create or update `config.json` interactively:

```bat
tallydb setup
```

The wizard asks for Tally settings, database settings, and optional advanced settings. If Tally is reachable, it lists open companies so you can select one instead of typing the name manually.

Setup tests Tally and database connectivity before saving. If a check fails, you can still save the config.

At the end, setup asks whether to run the first sync.

## Manual Config

Manual editing is fully supported. After editing `config.json`, run:

```bat
tallydb config validate
```

To print the active config with the password masked:

```bat
tallydb config show
```

To create a starter config:

```bat
tallydb config init
```

If `config.json` already exists, the CLI asks before overwriting. To overwrite intentionally:

```bat
tallydb config init --force
```

## Sync

Run sync using `config.json`:

```bat
tallydb sync
```

The CLI always prints the active mode before syncing:

```text
Mode    one-time sync
```

or:

```text
Mode    continuous sync every 5 minute(s)
```

If `tally.frequency` in `config.json` is `0`, sync runs once and exits. If it is greater than `0`, sync keeps running and checks Tally at that interval.

Runtime-only mode overrides:

```bat
tallydb sync --once
tallydb sync --frequency 5
```

These do not edit `config.json`. Use either `--once` or `--frequency`, not both.

Common runtime overrides:

```bat
tallydb sync --from 2025-04-01 --to 2026-03-31
tallydb sync --company "ABC Traders" --schema tallydb_abc
tallydb sync --db-server localhost --db-port 5432
tallydb sync --sync-mode incremental
```

Operational runtime flags:

```bat
tallydb sync --master false
tallydb sync --transaction false
tallydb sync --truncate false
```

Legacy nested overrides are also accepted on `sync`:

```bat
tallydb sync --tally-fromdate 2025-04-01 --database-schema tallydb_abc
```

## Test

Run read-only connection checks:

```bat
tallydb test
```

This validates config shape, checks Tally reachability, tries to list open companies, and tests database authentication.

`test` does not create tables, truncate data, write CSV files, change the active Tally company, or run import.

## Companies

List open companies from Tally:

```bat
tallydb companies
```

This is useful before choosing a company in `config.json`.

## Build And Run

Compile TypeScript:

```bat
npm run build
```

Run the compiled CLI:

```bat
npm start
```

or:

```bat
node ./dist/cli.mjs
```

