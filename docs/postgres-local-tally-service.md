# Local Tally To PostgreSQL With Background Sync

This runbook covers the usual production path:

1. Load data from a local Tally company into PostgreSQL.
2. Keep PostgreSQL updated every 1 minute using incremental sync.
3. Start the sync automatically after Windows reboots.

Run all commands from the folder that contains `config.json`.

## Prerequisites

1. PostgreSQL is running and you have a database, user, and password ready.
2. The PostgreSQL user can create tables and insert/update/delete rows in the target database.
3. Tally is running on the same machine, the target company is loaded, and the Tally XML server is enabled.
4. Tally XML server port matches `config.json > tally > port`. The default is `9000`.
5. If using the source checkout instead of the packaged release, build once:

```bat
npm run build
```

## 1. Load Local Tally Data To PostgreSQL

If you plan to turn on continuous incremental sync, use incremental mode from the first load. This creates the normal tables plus the incremental helper tables (`_diff`, `_delete`, `_vchnumber`) and stores the first AlterID markers in the database.

Edit `config.json`:

```json
{
  "database": {
    "technology": "postgres",
    "server": "localhost",
    "port": 5432,
    "ssl": false,
    "schema": "tallydb",
    "username": "postgres",
    "password": "your_password",
    "loadmethod": "file"
  },
  "tally": {
    "definition": "tally-export-config-incremental.yaml",
    "server": "localhost",
    "port": 9000,
    "fromdate": "auto",
    "todate": "auto",
    "sync": "incremental",
    "batchsize": 5000,
    "frequency": 0,
    "company": "Your Company Name"
  }
}
```

Notes:

- `database.schema` is the PostgreSQL database name used by this utility.
- Use `ssl: false` for local/LAN PostgreSQL. Use `true` only when your PostgreSQL server requires SSL.
- Set `tally.company` explicitly. Leaving it blank uses the active company in Tally, which is risky for background sync.
- In incremental mode, `fromdate` and `todate` are forced to `auto`.

Run read-only checks:

```bat
tallydb test
```

Run the initial load once:

```bat
tallydb sync --once
```

Check the result:

```bat
tallydb status
```

Also review:

- `import-log.txt`
- `error-log.txt`

## 2. Turn On 1 Minute Incremental Sync

After the initial load succeeds, set `frequency` to `1` in `config.json`:

```json
"tally": {
  "definition": "tally-export-config-incremental.yaml",
  "sync": "incremental",
  "frequency": 1
}
```

Start continuous sync in the foreground:

```bat
tallydb sync
```

Expected mode:

```text
Mode    continuous sync every 1 minute(s)
```

To verify whether Tally changes are being detected:

```bat
tallydb check-changes
```

If you edit something in Tally and the AlterID numbers do not change, Tally is not exposing that edit through the incremental counters used by this utility.

## 3. Run Sync Automatically After Reboot

Install the background task:

```bat
tallydb service install
```

Start it immediately:

```bat
tallydb service start
```

Check status:

```bat
tallydb service status
tallydb status
```

By default, the task runs at computer startup as `SYSTEM` and executes:

```bat
tallydb service-run
```

`service-run` forces continuous sync every 1 minute. If Tally is only available after a user logs in, install it as a logon task instead:

```bat
tallydb service uninstall
tallydb service install --startup logon
tallydb service start
```

To stop or remove the background sync:

```bat
tallydb service stop
tallydb service uninstall
```

## Operational Checklist

Before leaving it running:

1. `tallydb test` passes.
2. `tallydb sync --once` completes without errors.
3. `config.json > tally > sync` is `incremental`.
4. `config.json > tally > frequency` is `1`.
5. `config.json > tally > company` names the exact Tally company.
6. `tallydb service status` shows the scheduled task.
7. `tallydb status` shows recent heartbeat/activity.

## Troubleshooting

- `relation "_diff" does not exist`: run the latest build and start sync again. The utility should now create missing incremental helper tables automatically.
- `Missing "alterid" column in...`: the database was created with the full-sync schema before incremental sync was enabled. Stop the background task, create a fresh PostgreSQL database or clear the existing one, keep `definition` as `tally-export-config-incremental.yaml`, keep `sync` as `incremental`, set `frequency` to `0`, then run `tallydb sync --once`. After that succeeds, set `frequency` back to `1` and start the service again. Do not fix this by manually adding only the `alterid` columns; the initial incremental baseline needs to be rebuilt cleanly.
- `Tally is not reachable`: confirm Tally is open, the company is loaded, and the XML server port is enabled.
- PostgreSQL authentication fails: verify `server`, `port`, database name, username, password, SSL setting, and `pg_hba.conf`.
- No changes are syncing: run `tallydb check-changes` after editing data in Tally and confirm Tally AlterIDs changed.
- Background task runs but sync does nothing: use `tallydb service install --startup logon` if Tally only starts after user login.

## Rebuild After Accidentally Using Full Schema

Use this when you see an error like:

```text
Incremental sync requires tables to be created from database-structure-incremental.sql.
Missing "alterid" column in: mst_group, mst_ledger, ...
```

1. Stop background sync if it is running:

```bat
tallydb service stop
```

2. Create a fresh PostgreSQL database, or clear the current database. If you can delete the old database, run this from a PostgreSQL admin account and replace `tallydb` with your database name:

```bat
psql -U postgres -d postgres -c "DROP DATABASE IF EXISTS tallydb;"
psql -U postgres -d postgres -c "CREATE DATABASE tallydb;"
```

If you cannot drop the database, use a new database name such as `tallydb_incremental` and update `config.json > database > schema` to that new database.

3. Confirm `config.json` uses incremental settings:

```json
"tally": {
  "definition": "tally-export-config-incremental.yaml",
  "fromdate": "auto",
  "todate": "auto",
  "sync": "incremental",
  "frequency": 0,
  "company": "Your Company Name"
}
```

4. Run the initial incremental baseline load:

```bat
tallydb test
tallydb sync --once
```

5. Turn continuous sync back on:

```json
"frequency": 1
```

6. Start the background task:

```bat
tallydb service start
tallydb status
```
