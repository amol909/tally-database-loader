# Every voucher request reads the whole company

> The sync was never crashing. It was finishing — slowly — against a timeout set too low. Raising it took the pipeline from a week of failures to a completed run. What remains is that a normal sync costs 101 minutes to import 410 changed rows.

| | |
|---|---|
| **Status** | Sync restored, cost unresolved |
| **TallyPrime** | 2.1 |
| **Company** | Books from 1-Apr-2024 |
| **Vouchers** | 108,200 |
| **Last full run** | 101 min, completed |
| **Updated** | 5 Sep 2026 |

## 01. What this system does

A Node service pulls accounting data out of TallyPrime and lands it in PostgreSQL so it can be queried and reported on outside Tally. Tally has no SQL interface; it exposes an XML gateway on port 9000 that accepts hand-built **TDL** programs — Tally’s own report definition language — and answers with XML.

Each table in the export profile becomes one TDL program: name a collection, list the methods to fetch, list filters, list output fields. The loader sends it, parses the response into TSV, and bulk-loads it. Masters and transactions are separate tables with separate requests.

Sync is incremental, watermarked on Tally’s **AlterID** — a monotonic counter Tally bumps on every change. The loader stores the last seen value in a `config` table and asks only for objects above it. The watermark is written only after a run fully succeeds, so a failed run repeats rather than skipping data.

Deletions have no equivalent. Nothing in Tally answers “what was removed since AlterID N”, so before each sync the loader pulls the complete guid + AlterID set for every primary table and diffs it against PostgreSQL. That scan is unavoidable by design and, as measured below, is one of the most expensive things the loader does.

Two custom TDL reports are installed inside Tally beyond the profile: one flattening voucher inventory lines, one snapshotting godown stock. A machine-wide lockfile with PID liveness and a heartbeat serialises all Tally access, because concurrent requests were previously confirmed to destabilise Tally.

## 02. The environment, and why the version matters

|  |  |  |
|---|---|---|
| **TallyPrime version** | 2.1 | Rules out two mechanisms outright — see below |
| **Topology** | Multi-user | Company data lives on a LAN Tally Server; the loader talks to a local TallyPrime acting as client, which pulls objects across the network on demand |
| **Company** | Books from 1-Apr-2024 | ~886 days of history at time of writing |
| **Vouchers** | 108,200 | Measured, not estimated — the `_vchnumber` walk returns exactly this many rows |
| **Voucher types** | 127 | Nearly all custom (`BRANCH SALE GST GREENPANEL`, `BT Goshamahal to Kukatpally Inward`). No reliance on stock type names is safe |
| **Export profile** | focused-incremental | 8 master tables plus `trn_voucher`. No `cascade_delete` anywhere in it |

### Version 2.1 closes two doors

**JSON export requires TallyPrime 7.0+.** Tally’s own API Explorer states this. On 2.1 an unrecognised `SVEXPORTFORMAT` does not fall back or error — the request *hangs*. Never send one.

**The indexed collection `Vouchers : VoucherType` does not exist on 2.1.** This is the mechanism Tally’s current documentation recommends for pulling vouchers, and it is what would let a request enter one branch of an index instead of walking everything. Asking for it returns zero rows in about one second — the signature of an unrecognised collection type, not an empty branch. Verified with both `$$VchTypeSales` and a real voucher type name from this company.

Any advice found in current Tally documentation should be checked against 2.1 before being trusted. Two full investigation cycles were spent on mechanisms that simply are not present in this build.

## 03. How it failed, and what fixed it

For roughly a week every run died at `trn_voucher` with `Tally request exceeded 600000ms`. The log line printed alongside it — *“Unable to connect with Tally. Ensure tally XML port is enabled”* — is emitted on *our own* timeout, not on a connection failure, and it sent the investigation after network and stability causes for days.

Tally was never crashing. Historical metrics show 521 successes against 83 timeouts and only 6 genuine `ECONNRESET`s. The voucher request simply takes longer than 600 seconds under load, and our stopwatch was destroying a socket that would have delivered.

### The fix, applied and verified

`tallyRequestTimeoutMs()` default raised from `600000` to `1800000` in `src/tally-transport.mts`. Both the inactivity timer and the hard wall-clock cap read it, and both are **per request**, not per run.

Result: first clean end-to-end sync in a week. Every phase completed, the AlterID checkpoint advanced, `stock_godown_summary` imported 10,539 rows with zero rejections.

## 04. Where the 101 minutes goes

From `import-metrics.jsonl`, the completed run. The decisive column is `ttfb`: on every single request it equals total elapsed time. Tally sends nothing while building a report, so this is time spent inside Tally, not transfer, parsing or database load. Lock wait was 0–3 ms everywhere — contention is not a factor.

| Phase | Elapsed | Returned | Bytes | Reading |
|---|---|---|---|---|
| _vchnumber | 22.1m | 108,200 | 22.7 MB | Full walk; genuinely needs every voucher |
| voucher inventory TDL | 22.0m | 820 | — | Worst cost per row in the pipeline |
| trn_voucher export | 20.1m | 410 | 388 KB | Watermark worked perfectly and saved nothing |
| _diff (delete detection) | 19.1m | 318,860 | 63.3 MB | Cannot use the watermark by design |
| godown stock TDL | 5.6m | 10,539 | — | Cheapest phase, despite being flagged all week as the riskiest |
| bulk_load (all tables) | 23.2s | — | — | PostgreSQL side is not a factor |
| file_write / tdl_transform | 3.3s | — | — | Neither is our own parsing |

**Four separate full-company walks per run**, each paying the same cost regardless of what it returns. The `trn_voucher` row is the clearest statement of the problem: 20 minutes to deliver 410 rows. The incremental watermark did its job — only 410 vouchers had changed — and it made no difference at all, because Tally still traversed all 108,200 to find them.

## 05. Mechanisms measured

All against the same company on the same machine. The first request in any sequence pays a cold-cache penalty of 5–15× — identical requests measured at 10,810 ms then 1,883 ms — so only warm figures are comparable.

| Request | Shape | Warm | Returned |
|---|---|---|---|
| Day Book, one date | Data / built-in report | 13s | 45.8 MB |
| Voucher collection, production filters, AlterId > 1.84M | Collection | 19–22s | 3,326 rows |
| Voucher collection, filter matching nothing | Collection | 42s | 2,846 B |
| Voucher collection, 5 fields, no filter | Collection | 168s | 300 MB |
| `trn_voucher` via the loader’s own generator | Data / REPORT+PART+LINE | >15m | capped |
| `Vouchers : VoucherType` indexed | Collection | 1s | 0 rows |

### The unexplained 50×

A `TYPE=Collection` export returned 3,326 rows in **19 seconds**. The loader’s own request — same collection, same filters, same company — exceeded **15 minutes**. Removing all five cross-object field lookups from it changed nothing. Neither filters, fields, nor data volume account for the gap.

The remaining difference is the request *shape*. The loader uses `TYPE=Data` with a full `REPORT` / `FORM` / `PART` / `LINE` / `FIELD` definition rendered through `<REPEAT>MyLine : MyCollection</REPEAT>`. Every fast probe used a plain collection export.

## 06. The one open question

`generateXMLfromYAML` emits `<SVEXPORTFORMAT>XML</SVEXPORTFORMAT>`. Every fast probe sent `$$SysName:XML`. A bare `XML` string may not resolve to the export-format constant at all, leaving Tally rendering through a display path rather than a data path — which would explain the entire 50× in one token.

Live test in `bench/filter-cost-probe.mjs`: the loader’s request verbatim, the same request with only that token changed, and a known-fast collection export as a warmth control. Three minute cap each.

- **Token variant fast** → one-line fix in `generateXMLfromYAML`, and the 101-minute run becomes minutes.
- **Both slow, control fast** → report-style rendering is inherently the cost; move the loader onto collection exports.
- **Control also slow** → Tally was busy; rerun when idle.

## 07. Hypotheses tested

- **[KILLED] Tally is crashing or the connection is dropping** — 521 successes, 83 timeouts, 6 real resets. The error text on our own timeout falsely names the XML port. Nothing crashed.
- **[KILLED] `SVFROMDATE` / `SVTODATE` scope a voucher collection** — One day and three months both returned ~300 MB in the same time. Without them a collection returns nothing at all — they establish a period, they do not bound a walk.
- **[KILLED] Date chunking will bound the cost** — Follows from the above: N chunks would cost N full walks. Strictly worse.
- **[KILLED] Streaming the response will help** — `ttfb` equals elapsed on every request. Tally emits nothing until the report is complete. There is no stream.
- **[KILLED] Delete detection is the cause** — Runs failed with it disabled. It is not the cause — but it is 19 minutes of unavoidable full-scan per run, and skippable.
- **[KILLED] The custom TDL reports are the cause** — Probes loading no custom TDL still timed out. The godown snapshot, flagged all week as most dangerous, was the cheapest phase at 5.6 minutes.
- **[KILLED] The `$$IsInventoryVch` filter is the cost** — Full production filters returned 3,326 rows in 19s via collection export. Note an earlier YAML comment recorded 146.6s vs 10.7s for this clause — real, but two orders of magnitude short of explaining the run.
- **[KILLED] Per-row cross-object field lookups are the cost** — Removing `$Guid:VoucherType:`, `$Guid:Ledger:` and all three `$$Is*Vch` flags from the config left the request over 15 minutes. Not the fields.
- **[CONFIRMED] Cold cache is real but secondary** — 5.7× on byte-identical requests; `CMPINFO` object counts visibly climb between calls. It inflates every measurement but explains no failure.
- **[CONFIRMED] Day Book is genuinely date-scoped via `SVCURRENTDATE`** — Falsification-tested: two dates gave different responses, the same date reproduced byte-exactly. `SVFROMDATE` does not steer it; `SVCURRENTDATE` does, and persists across requests in the session.
- **[OPEN] Report-shaped export is the cost** — The last untested explanation, and the only one still consistent with every measurement. See §06.

## 08. What to do, in order

1. **Run the §06 probe.** It is nine minutes and it decides everything below.
2. **Set `frequency` to 60.** At 10 minutes a 101-minute run means the loader is permanently in flight against a shared server. Ticks do not overlap — two in-process guards plus the lockfile prevent it — but they queue pointlessly.
3. **Fix the watermark ordering bug.** In `sync.mts`, `lastMasterAlterId` and `lastTransactionAlterId` advance *before* `invokeImport()` rather than after. A failed run therefore leaves them advanced, the next tick concludes nothing changed, and continuous mode goes quiet with a silent gap in the data. This has been understating the failure count throughout.
4. **Correct the transport error message.** `“Unable to connect with Tally”` on our own timeout cost days of misdirection.
5. **Consider `TALLY_SKIP_DIFF` as normal operation.** This profile has no `cascade_delete`, and `deleteRowsMatchingCsvGuid` already clears modified rows before load. Skipping delete detection removes 19 minutes per run; the only loss is that rows deleted inside Tally linger until a run that scans for them. The flag now advances the checkpoint rather than holding it back.
6. **If the report shape is inherently the cost:** rebuild `trn_voucher` on per-day Day Book requests. ~13s per day, index-backed, and the response already carries `ALLINVENTORYENTRIES.LIST` — so it also retires the 22-minute inventory TDL. A day’s response is the authoritative set for that date, which finally makes delete detection correct *and* bounded. Backfilling ~886 days is a restartable overnight job. The trade is that AlterID stops being the watermark, so back-dated edits need a tiered refresh (recent days each run, a trailing window nightly, full books monthly).

## 09. Corrections

Recorded because each cost real time and could be repeated by the next person.

- **“Restart Tally before every run” was actively harmful advice.** It emptied the client object cache, forcing the cold path in five consecutive diagnostic runs and inflating every number they produced.
- **Cross-variant comparisons from the early probe are ordering-confounded.** It warmed a cache across sequential variants, so conclusions like “date scoping hurts” are unsound. Withdrawn.
- **Two probes measured nothing.** One used `$IsInventoryVch` where the config uses `$$IsInventoryVch`, so the clause matched nothing and ran fast for the wrong reason. Another used `TYPE=Collection`, which ignores `FIELD` definitions — the field variants were never applied. Reconstructing the loader’s request by hand failed twice; the working probe imports `generateXMLfromYAML` from `dist/` so the request is identical by construction.
- **The predicted “42-second walk floor” was wrong.** Measured on a lean five-field request, then used to predict a 3–8 minute run. The actual run took 101 minutes. Timing predictions in this investigation have been unreliable; measure instead.
- **“A current watermark will make runs fast” was wrong.** The watermark reduces output, and output is nearly free here. It does not reduce the walk.

## 10. Instrumentation left behind

|  |  |
|---|---|
| bench/analyze-metrics.mjs | Attributes a run’s wall-clock to phases from `import-metrics.jsonl`, separating Tally build time from transfer and load. Reads no Tally; safe during a sync. `node bench/analyze-metrics.mjs 3` for the last three runs. |
| bench/filter-cost-probe.mjs | The §06 test. Builds requests through the loader’s own generator. |
| src/diagnostic-flags.mts | `TALLY_SKIP_*` switches removing one activity each, with a banner naming what a run is not doing. `skipPeriod` and `skipDiff` keep the AlterID checkpoint; every other flag holds it back so a stripped run cannot claim work it did not do. |
| src/metrics.mts | Per-request `ttfb`, `lockWait`, `xmlSha256`, request and response bytes. The separation of lock wait from build time is what ruled out contention. |
| src/tally-lock.mts | Machine-wide single-flight with PID liveness and heartbeat. Protects across processes, not just timers. |

Environment overrides: `TALLY_REQUEST_TIMEOUT_MS` (idle budget, default 1800000), `TALLY_REQUEST_MAX_MS` (hard wall-clock ceiling, defaults to the same). Both are per request, so a run with twenty requests has no total bound.

---

Handoff document · updated 5 September 2026 · measurements from `import-metrics.jsonl` run 0256212c and the bench probes named above

Live version: https://claude.ai/code/artifact/f6453109-42cc-4e00-be84-849a475b1b19
