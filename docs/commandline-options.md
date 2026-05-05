## Commandline Options

The preferred terminal entrypoint is now:

```bat
tallydb
```

See [CLI documentation](cli.md) for the full command reference.

The utility is still driven by **config.json**. Runtime overrides can be supplied to `tallydb sync` without editing the config file.

### Friendly Options

```bat
tallydb sync --from 2025-04-01 --to 2026-03-31
tallydb sync --company "Reliance Industries" --schema client_reliance
tallydb sync --sync-mode incremental
tallydb sync --once
tallydb sync --frequency 5
```

Common mappings:

| Option | Config value |
| --- | --- |
| `--from` | `tally.fromdate` |
| `--to` | `tally.todate` |
| `--company` | `tally.company` |
| `--schema` | `database.schema` |
| `--db-server` | `database.server` |
| `--db-port` | `database.port` |
| `--sync-mode` | `tally.sync` |

Operational flags:

```bat
tallydb sync --master false
tallydb sync --transaction false
tallydb sync --truncate false
```

### Continuous Sync

`config.json` can persist continuous sync by setting `tally.frequency` greater than `0`.

Runtime-only mode overrides:

```bat
tallydb sync --once
tallydb sync --frequency 5
```

`--once` and `--frequency` do not edit `config.json`.

### Legacy Override Syntax

Legacy nested overrides remain accepted by `tallydb sync`:

```bat
tallydb sync [[--option 01] [value 01] [--option 02] [value 02] ...]
```

**option** syntax is `--parent-child`, where `parent` is the main config name and `child` is the sub-config name in **config.json**.

Example:

```bat
tallydb sync --tally-fromdate "2019-10-01" --tally-todate "2019-12-31"
```

Example with company and schema:

```bat
tallydb sync --tally-fromdate "2019-10-01" --tally-todate "2019-12-31" --tally-company "Reliance Industries" --database-schema client_reliance
```

Multiple company sync can still be scripted by running `tallydb sync` more than once:

```bat
tallydb sync --database-schema tallydb_airtel --tally-company "Bharti Airtel"
tallydb sync --database-schema tallydb_voda_idea --tally-company "Vodafone Idea Ltd FY 2021-22" --tally-fromdate "2021-04-01" --tally-todate "2022-03-31"
tallydb sync --database-schema tallydb_jio --tally-company "Reliance Jio from (01-Apr-2022)"
```

For multi-year imports, use runtime operational flags:

```bat
tallydb sync --tally-fromdate "2017-04-01" --tally-todate "2018-03-31"
tallydb sync --tally-fromdate "2018-04-01" --tally-todate "2019-03-31" --tally-master false --tally-truncate false
tallydb sync --tally-fromdate "2019-04-01" --tally-todate "2020-03-31" --tally-master false --tally-truncate false
```

