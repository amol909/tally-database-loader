# Focused Incremental Sync

Use this profile when you do not want to sync every Tally table, and only need item, item group, stock report, warehouse/godown, ledger, and customer-related data.

## Files

| File | Purpose |
| --- | --- |
| `tally-export-config-focused-incremental.yaml` | Focused Tally export definition. |
| `database-structure-focused-incremental.sql` | Optional smaller DB schema for only the focused tables. |
| `config.focused-incremental.example.json` | Example focused incremental config. |
| `config.default.example.json` | Example default full-sync config. |

## Included Tables

```text
mst_group
mst_ledger
mst_vouchertype
mst_uom
mst_godown
mst_stock_category
mst_stock_group
mst_stock_item
mst_opening_batch_allocation
trn_voucher
trn_accounting
trn_inventory
trn_bill
trn_batch
```

Customers are stored in Tally as ledgers, usually under groups such as Sundry Debtors. Use `mst_ledger` plus `mst_group` to identify and filter them.

## Recommended Setup

Use a separate database/schema for focused incremental sync, for example:

```text
tallydb_focused_incremental
```

Do not reuse an existing full-sync database. Incremental sync stores AlterID markers in the database `config` table, so mixing profiles in the same database can cause confusing results.

## Configure

Copy the focused example config:

```powershell
Copy-Item config.focused-incremental.example.json config.json
```

Then edit `config.json`:

```json
{
    "database": {
        "schema": "tallydb_focused_incremental",
        "username": "<your-db-user>",
        "password": "<your-db-password>"
    },
    "tally": {
        "definition": "tally-export-config-focused-incremental.yaml",
        "sync": "incremental",
        "frequency": 0,
        "company": "<exact-open-tally-company-name>"
    }
}
```

Keep `frequency` as `0` for the first baseline run. After the baseline succeeds, set it to `1` or another interval for continuous sync.

## Create The Focused Schema

If you want the database to contain only the focused tables, run `database-structure-focused-incremental.sql` manually in your database before the first sync.

If you skip this step, the connector can still auto-create tables, but it uses the normal `database-structure-incremental.sql` file and may create extra unused tables.

## Test

Validate the config and connections:

```powershell
node ./dist/cli.mjs config validate
node ./dist/cli.mjs test
```

Run the initial baseline:

```powershell
node ./dist/cli.mjs sync --once
```

Check change markers:

```powershell
node ./dist/cli.mjs check-changes
```

Make a small edit in Tally, such as changing a stock item note, ledger mobile number, or creating a test voucher. Then run:

```powershell
node ./dist/cli.mjs check-changes
node ./dist/cli.mjs sync --once
```

The second sync should process only changed master or transaction data.

## Continuous Sync

After the baseline works, edit `config.json`:

```json
"frequency": 1
```

Then start continuous sync:

```powershell
node ./dist/cli.mjs sync
```

Use status and logs to monitor it:

```powershell
node ./dist/cli.mjs status
```

Logs are written to:

```text
import-log.txt
error-log.txt
sync-status.json
```

## Switching Back To Default

To return to the default profile:

```powershell
Copy-Item config.default.example.json config.json
```

Update database credentials, company, and schema as needed before running sync.
