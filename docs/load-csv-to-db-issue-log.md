# Load CSV to DB Issue Log

This document records issues found while testing the GUI `Load CSV to DB` workflow.

Always click `Load Config` before clicking `Load CSV to DB`, so the GUI uses the saved `config.json` database and Tally settings.

## 2026-05-13: PostgreSQL text column length failures

### Symptom

Clicking `Load CSV to DB` after `Load Config` started the CSV import, then failed while loading `mst_ledger`.

`error-log.txt` showed:

```text
Error from database.dumpDataPostges(mst_ledger)
error: value too long for type character varying(64)
COPY mst_ledger, line 263, column description
```

`import-log.txt` showed:

```text
Loading CSV folder to database tables
  mst_group: skipped, csv file not found
Error loading CSV folder to database: value too long for type character varying(64)
```

### Cause

The existing PostgreSQL database had narrow text columns from the schema script, for example `mst_ledger.description varchar(64)`. Tally CSV exports can contain longer real-world values for descriptive, address, GST, bank, and transaction text fields.

The loader created missing tables, but did not adjust existing tables whose text columns were too small. PostgreSQL then rejected rows during `COPY`.

### Resolution

Added `database.ensureTextColumnCapacity(...)` and call it before each table import in `loadCsvFolderToDatabase(...)`.

For CSV-backed tables, the loader now:

1. Reads text fields from the YAML export definition.
2. Checks existing database text columns.
3. Widens narrow text columns to `varchar(1024)` before bulk loading.
4. Logs widened columns in `import-log.txt`.

Files changed:

- `src/database.mts`
- `src/sync.mts`
- compiled output in `dist/database.mjs`
- compiled output in `dist/sync.mjs`

### Verification

Built successfully:

```text
npm run build
```

Browser verification:

1. Opened `http://localhost:8997`.
2. Clicked `Load Config`.
3. Confirmed PostgreSQL settings loaded from `config.json`.
4. Clicked `Load CSV to DB`.

Result:

```text
CSV folder database load completed successfully [13/5/2026, 10:52:28 am]
```

Selected imported row counts:

```text
mst_ledger: imported 12578 rows
mst_gst_effective_rate: imported 48423 rows
trn_voucher: imported 47151 rows
trn_accounting: imported 191017 rows
trn_inventory: imported 65021 rows
trn_inventory_additional_cost: imported 157624 rows
```

No browser console errors were reported during the successful run.

### Notes

The loader consumed all `./csv/*.data` files and removed the empty `csv` folder after the successful import.

Git status/diff could not be checked in the sandbox because Git blocked the repository with a dubious ownership warning for `D:/Development/tally-db-connector`.
