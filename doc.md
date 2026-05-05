
# Config and Inventory Notes

This is the short operator-facing guide for configuring the loader and interpreting stock data.

## Config Options

Main config lives in `config.json`.

### `database`

| Option | Meaning |
| --- | --- |
| `technology` | Target output: `mssql`, `mysql`, `postgres`, `bigquery`, `adls`, or `csv`. |
| `server` | Database host. Use `localhost` when the database runs on the same machine. |
| `port` | Database port. `0` lets the utility apply defaults: SQL Server `1433`, MySQL `3306`, PostgreSQL `5432`. |
| `ssl` | Use `true` for secured/cloud connections. Keep `false` for local/LAN database servers unless required. |
| `schema` | Database or dataset name where the loader creates and fills tables. |
| `username` | Database login user. SQL Server defaults to `sa`, MySQL to `root`, PostgreSQL to `postgres`. |
| `password` | Database password. SQL Server trusted/passwordless login is not supported. |
| `loadmethod` | `insert` is slower but most compatible. `file` is faster but mainly suitable when the utility and DB server are on the same machine. |

### `tally`

| Option | Meaning |
| --- | --- |
| `definition` | Export definition file. Use `tally-export-config.yaml` for full YAML sync, `tally-export-config.json` for collection-based full sync, or `tally-export-config-incremental.yaml` for incremental sync. |
| `server` | Tally XML server host. Usually `localhost`. |
| `port` | Tally XML server port. Usually `9000`. |
| `fromdate`, `todate` | Export period in `YYYY-MM-DD`, or `auto` to let the loader detect the company period. |
| `sync` | `full` reloads complete data. `incremental` syncs changed data since the last sync point. |
| `batchsize` | Voucher collection batch size for JSON/collection extraction. Default `5000`; avoid going above `10000`. |
| `frequency` | Minutes between change checks for continuous sync. `0` means run once and exit. |
| `company` | Specific Tally company name. Blank means use the active company in Tally. |

Command-line overrides follow `--parent-child value`, for example:

```bat
node ./dist/index.mjs --tally-fromdate "2025-04-01" --tally-todate "2026-03-31" --database-schema tallydb
```

## SKU Definition

The closest SKU master is `mst_stock_item`.

| Field | Meaning |
| --- | --- |
| `guid` | Tally stock item GUID. Best technical identifier. |
| `name` | Tally stock item name. This is the main join key used by transaction tables. |
| `part_number` | Optional item part number. Treat this as the business SKU only if your Tally data consistently maintains it. |
| `parent` | Stock group. |
| `category` | Stock category. |
| `uom`, `alternate_uom`, `conversion` | Base unit, alternate unit, and conversion factor. |
| `opening_balance`, `opening_rate`, `opening_value` | Opening quantity/rate/value for the selected period. |
| `closing_balance`, `closing_rate`, `closing_value` | Tally's closing quantity/rate/value snapshot for the selected period. |
| `costing_method` | Tally costing method, such as weighted average/FIFO depending on item setup. |
| GST fields | `gst_type_of_supply`, `gst_hsn_code`, `gst_rate`, `gst_taxability`, etc. |

Practical rule: use `guid` for internal identity, `name` for joins to exported transaction rows, and `part_number` for SKU reporting only after validating it is populated and unique enough for your company.

## Inventory Count Definitions

Inventory movement is stored in `trn_inventory`, linked to `trn_voucher` by `guid`.

| Field | Meaning |
| --- | --- |
| `guid` | Voucher GUID. Join to `trn_voucher.guid`. |
| `item` | Stock item name. Join to `mst_stock_item.name`. |
| `quantity` | Movement quantity. Positive means inward; negative means outward. |
| `rate` | Item rate on the voucher line. |
| `amount` | Voucher line amount. |
| `additional_amount` | Additional line-level cost amount. |
| `discount_amount` | Discount amount. |
| `godown` | Godown/location for the stock movement. |
| `tracking_number` | Used to de-duplicate inventory impact when GRN/GDN workflows are partially followed. |
| `order_number`, `order_duedate` | Order linkage fields. |

For a basic stock movement report where order vouchers should not affect inventory:

```sql
SELECT
    v.date,
    v.voucher_number,
    v.voucher_type,
    i.item,
    i.quantity
FROM trn_inventory i
JOIN trn_voucher v ON v.guid = i.guid
WHERE v.is_order_voucher = 0;
```

If the business strictly uses GRN/GDN workflow, filter inventory impact to inventory vouchers:

```sql
WHERE v.is_order_voucher = 0
  AND v.is_inventory_voucher = 1
```

## Gotchas

- Tally must be running, and the XML server must be enabled on the configured port.
- For SQL Server, TCP/IP must be enabled; named instances like `PC-NAME\SQLEXPRESS` are not supported.
- `file` load method is fast, but it is not a good fit for cloud DBs or locked-down MySQL setups. Use `insert` when compatibility matters.
- `company` left blank uses whatever company is active in Tally. For scheduled or incremental sync, set it explicitly.
- Incremental sync is only for SQL Server, MySQL, and PostgreSQL. Do the required initial full sync and avoid manual `DELETE`/`TRUNCATE`, or integrity can break.
- In incremental sync, `fromdate` and `todate` are effectively `auto`; do not rely on them to limit the period.
- Order vouchers can emit rows for capture, but should usually be filtered out of accounting and inventory calculations.
- Partial GRN/GDN workflows can double-count stock movement. Use `tracking_number` logic when the business sometimes records GRN/GDN and sometimes records Purchase/Sales directly.
- Physical Stock vouchers override closing balances and can break simple movement-based stock calculations.
- If Tally has been running for days, it may occasionally return stale data; restart Tally before investigating phantom sync issues.
- If using Windows Task Scheduler, disconnect instead of logging off because Tally is GUI-based.
