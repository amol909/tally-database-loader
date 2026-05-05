# CLI Conversion Plan

This document captures the agreed plan for converting the terminal application from a batch-file driven Node script into a proper CLI. It should stay up to date as the CLI is implemented, so future contributors can quickly understand the intended behavior.

## Implementation Status

The v1 CLI described here has been implemented. See [cli.md](cli.md) for the user-facing command reference.

## Goals

- Make `tallydb` the primary terminal application.
- Keep `config.json` as the single source of truth for configuration.
- Let users configure the app either by editing `config.json` manually or by running an interactive setup wizard.
- Provide a high-quality terminal experience with clear commands, readable output, masked secrets, and safe prompts.
- Keep the existing GUI path out of scope for the first CLI version.
- Reuse the existing sync engine and table creation behavior instead of building a separate import path.

## Command Names

The CLI should expose two executable names:

```bash
tallydb
tally-db-connector
```

`tallydb` is the primary command because it is short and easier to type repeatedly.

`run.bat` should launch the CLI menu by running the built CLI entrypoint.

## Dependencies

Planned CLI dependencies:

- `commander` for command routing, options, and help output.
- `@inquirer/prompts` for the interactive setup wizard and main menu.
- `chalk` for polished terminal output and visual hierarchy.

The first version should avoid progress bars or long-running spinners during sync because the existing logger already streams import details.

## Configuration Model

The only supported config path in v1 is:

```text
./config.json
```

There is no `--config` option in v1, and there are no named profiles. Users who need multiple configurations can copy the project folder or manually swap `config.json`.

Users can configure the app in three ways:

- Edit `config.json` manually.
- Run `tallydb setup`.
- Pass runtime-only sync overrides to `tallydb sync`.

`config.json` remains the source of truth. The setup wizard updates the same file rather than maintaining a separate CLI config.

## Password Handling

The database password remains stored in `config.json` for compatibility with the current application model.

CLI behavior:

- Hide password input during setup.
- Mask password output in `tallydb config show`.
- Do not print secrets in summaries or errors.

## Starter Config

`tallydb config init` should create a starter `config.json` if one does not exist.

If `config.json` already exists, the command should not overwrite it automatically. Interactive behavior should offer:

- Keep existing file.
- Overwrite with starter config.
- Show current config.

Non-interactive overwrite should be available via:

```bash
tallydb config init --force
```

Starter config should avoid insecure sample credentials like `sa/admin`.

Recommended starter config:

```json
{
  "database": {
    "technology": "mssql",
    "server": "localhost",
    "port": 0,
    "ssl": false,
    "schema": "tallydb",
    "username": "",
    "password": "",
    "loadmethod": "file"
  },
  "tally": {
    "definition": "tally-export-config.yaml",
    "server": "localhost",
    "port": 9000,
    "fromdate": "auto",
    "todate": "auto",
    "sync": "full",
    "batchsize": 5000,
    "frequency": 0,
    "company": ""
  }
}
```

## V1 Command Set

### `tallydb`

Runs an interactive main menu.

Menu options:

- Run sync.
- Setup or update config.
- Test connections.
- List open Tally companies.
- Show config.
- Exit.

Plain `tallydb` should not start sync automatically. This avoids accidental destructive or long-running operations.

### `tallydb setup`

Runs a guided setup wizard that reads existing `config.json` values as defaults.

The wizard should ask for the common settings first, then advanced settings.

Common Tally settings:

- Server, default `localhost`.
- Port, default `9000`.
- Company.
- From date.
- To date.
- Sync mode, `full` or `incremental`.

Common database settings:

- Technology: `mssql`, `mysql`, `postgres`, or `bigquery`.
- Server.
- Port, default based on technology when set to `0`.
- Database/schema.
- Username.
- Password.
- SSL.
- Load method.

Advanced settings:

- Definition file.
- Batch size.
- Frequency for continuous sync.

Operational flags like master-only, transaction-only, and truncate behavior should remain runtime sync options rather than persisted setup fields.

Setup should test Tally and database connections before saving when possible. If a check fails, the wizard should explain the failure and ask whether to save the config anyway.

At the end, setup should show a summary and ask whether to run the first sync.

### `tallydb sync`

Runs the import process using `config.json`.

Before syncing, it should validate config shape and print the active mode:

```text
Mode: one-time sync
```

or:

```text
Mode: continuous sync every 5 minute(s)
```

Behavior:

- If `tally.frequency` is `0`, run one sync and exit.
- If `tally.frequency` is greater than `0`, run continuous sync and keep the terminal open.
- Existing table creation and verification remains part of the sync flow.

Runtime-only options:

```bash
tallydb sync --once
tallydb sync --frequency 5
```

Rules:

- `--once` forces one-time sync for this run only.
- `--frequency 5` runs continuous sync every 5 minutes for this run only.
- Neither option edits `config.json`.
- Passing both `--once` and `--frequency` should fail fast.

Friendly sync aliases should be supported first:

```bash
tallydb sync --from 2025-04-01 --to 2026-03-31 --company "ABC Traders" --schema tallydb
```

Legacy nested override names may be supported as a courtesy, but they should not drive the design.

Useful friendly options:

- `--from` maps to `tally.fromdate`.
- `--to` maps to `tally.todate`.
- `--company` maps to `tally.company`.
- `--schema` maps to `database.schema`.
- `--db-server` maps to `database.server`.
- `--db-port` maps to `database.port`.
- `--sync-mode` maps to `tally.sync`.
- `--frequency` maps to runtime `tally.frequency`.
- `--master`, `--transaction`, and `--truncate` control runtime import behavior.

### `tallydb test`

Runs read-only checks.

It should:

- Load `config.json`.
- Validate config shape.
- Test Tally HTTP reachability.
- Check open companies when possible.
- Test database authentication.
- Print a pass/fail summary.

It should not:

- Create tables.
- Truncate tables.
- Write CSV files.
- Change the active Tally company.
- Run import.

### `tallydb companies`

Lists open companies from Tally.

If Tally is reachable, the command should show open companies and identify the active/current one when that information is available.

This command should reuse the existing Tally company listing capability. The current code already has company listing logic internally in `tally.mts`, and the GUI server exposes a related `/list-company` route.

### `tallydb config init`

Creates starter `config.json`.

See the starter config and overwrite behavior above.

### `tallydb config show`

Prints the current `config.json` with secrets masked.

The output should be easy to scan and should not expose `database.password`.

### `tallydb config validate`

Validates config shape only.

Validation should check:

- `config.json` exists.
- Required sections exist: `database` and `tally`.
- Required values are present.
- Database technology is one of `mssql`, `mysql`, `postgres`, or `bigquery`.
- Dates are either `auto` or `YYYY-MM-DD`.
- Sync mode is `full` or `incremental`.
- Frequency is a non-negative number.
- Batch size is a positive number.

Connectivity should not be part of `config validate`; use `tallydb test` for connection checks.

## Tally Company Selection

During setup, the CLI should prefer selecting from open Tally companies when Tally is reachable.

Suggested flow:

```text
Checking Tally...
Found open companies:
1. ABC Traders
2. Demo Company FY 2025-26
3. Use currently active company
4. Enter company name manually
```

Recommended default is to save an explicit selected company name. This reduces the risk of syncing the wrong company if the active company in Tally changes.

Blank company should still be allowed for quick local use and for users who intentionally want the active company behavior.

## Terminal Output

The CLI should look polished and high quality.

Example sync header:

```text
Tally DB Connector
Config  config.json
Mode    One-time sync
Tally   localhost:9000
Company ABC Traders
DB      MSSQL localhost:1433/tallydb
```

Example checks:

```text
Checks
OK  Config valid
OK  Tally reachable
OK  Database reachable
```

Example sync section:

```text
Sync
10:31:02  Preparing database
10:31:05  Importing mst_ledger
10:31:08  Importing trn_voucher
OK  Sync completed in 00:02:14
```

Unicode symbols may be used if they render well in modern Windows Terminal. If compatibility issues appear, prefer ASCII status labels like `[OK]` and `[FAIL]`.

The existing logger should remain mostly intact in v1. CLI should provide a polished frame around the existing logs rather than deeply refactoring logging.

## GUI Scope

The existing GUI files remain untouched in the CLI v1 plan:

- `gui.html`
- `run-gui.bat`
- `src/server.mts`

The CLI fork can revisit GUI cleanup or deprecation after the CLI is stable.

## Implementation Phases

### Phase 1: Core CLI Skeleton

- Add `commander`, `@inquirer/prompts`, and `chalk`.
- Add package `bin` entries for `tallydb` and `tally-db-connector`.
- Create `src/cli.mts`.
- Update `run.bat` to launch `dist/cli.mjs`.
- Add the interactive main menu for plain `tallydb`.

### Phase 2: Config Module

- Add `src/config.mts`.
- Load and save `config.json`.
- Provide starter config for `config init`.
- Validate config shape.
- Mask password for `config show`.

### Phase 3: Sync Runner Extraction

- Move the import loop from `src/index.mts` into a reusable `src/sync.mts`.
- Let CLI sync call the sync runner.
- Always show sync mode before running.
- Add `--once` and `--frequency` runtime overrides.

### Phase 4: Tally and Database Test Helpers

- Expose read-only Tally connection and company listing helpers.
- Expose a database authentication test helper.
- Implement `tallydb test`.
- Implement `tallydb companies`.

### Phase 5: Setup Wizard

- Build guided prompts with existing config values as defaults.
- Test Tally and database during setup.
- List/select open companies when Tally is reachable.
- Allow save anyway when checks fail.
- Ask before running first sync.

### Phase 6: Documentation and Build Polish

- Update README and command-line documentation.
- Add build/start scripts if missing.
- Compile TypeScript.
- Smoke test CLI commands.

## Out of Scope for V1

- Multiple config files or named profiles.
- Global user-profile config.
- Automatic schema migration commands separate from sync.
- Deep logger refactor.
- GUI rewrite or removal.
- Progress bars for table-level sync.
