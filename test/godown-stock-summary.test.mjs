import test from 'node:test';
import assert from 'node:assert/strict';
import {
    acquireGodownStockRefreshLock,
    buildGodownStockSnapshotRequest,
    buildGodownSummaryRequest,
    buildStockSummaryRequest,
    ensureGodownStockSnapshotSchema,
    GodownStockSnapshotValidationError,
    parseGodownStockSnapshot,
    parseGodownStockSnapshotRows,
    populateGodownGuids,
    parseGodownSummaryRows,
    parseStockSummaryRows,
    publishGodownStockSnapshot,
    releaseGodownStockRefreshLock,
    replaceGodownStockSummaryRows
} from '../dist/godown-stock-summary.mjs';

test('rejects an overlapping cross-process Godown stock refresh', async () => {
    const client = {
        async query() {
            return { rows: [{ acquired: false }] };
        }
    };

    await assert.rejects(
        acquireGodownStockRefreshLock(client),
        /Godown stock refresh is already running/
    );
});

test('holds and releases the cross-process lock around a Godown stock refresh', async () => {
    const queries = [];
    const client = {
        async query(sql) {
            queries.push(String(sql).replace(/\s+/g, ' ').trim().toLowerCase());
            return { rows: [{ acquired: true }] };
        }
    };

    await acquireGodownStockRefreshLock(client);
    await releaseGodownStockRefreshLock(client);

    assert.match(queries[0], /pg_try_advisory_lock/);
    assert.match(queries[1], /pg_advisory_unlock/);
});

test('parses old TDL quantity output before Godown GUID enrichment', () => {
    const xml = `<ENVELOPE>
      <rowType>GODOWN</rowType>
      <stockItem>Negative Item</stockItem>
      <itemGuid>item-guid-negative</itemGuid>
      <godown>Main</godown>
      <closingQty>(-)2 PCS</closingQty>
      <asOnDate>20260817</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>
      <rowType>GODOWN</rowType>
      <stockItem>Zero Item</stockItem>
      <itemGuid>item-guid-zero</itemGuid>
      <godown>Branch</godown>
      <closingQty>0 PCS</closingQty>
      <asOnDate>20260817</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>
    </ENVELOPE>`;

    const result = parseGodownStockSnapshot(xml);

    assert.deepEqual(result.rows.map(row => [row.closingQty, row.godownGuid]), [
        ['-2', ''],
        ['0', '']
    ]);
    assert.equal(result.metrics.negativeRows, 1);
    assert.equal(result.metrics.zeroRows, 1);
});

test('populates Godown GUIDs from PostgreSQL master rows by Godown name', () => {
    const rows = [
        { godown: ' Main ', godownGuid: '' },
        { godown: 'Branch', godownGuid: 'tdl-guid-is-not-authoritative' }
    ];

    const populated = populateGodownGuids(rows, [
        { name: 'Main', guid: 'main-guid' },
        { name: 'Branch', guid: 'branch-guid' }
    ]);

    assert.deepEqual(populated.map(row => row.godownGuid), ['main-guid', 'branch-guid']);
    assert.equal(rows[0].godownGuid, '');
});

test('rejects a snapshot when PostgreSQL has no unique Godown name mapping', () => {
    assert.throws(
        () => populateGodownGuids(
            [{ godown: 'Main', godownGuid: '' }],
            [
                { name: 'Main', guid: 'first-guid' },
                { name: 'Main', guid: 'second-guid' }
            ]
        ),
        error => error instanceof GodownStockSnapshotValidationError
            && /multiple PostgreSQL GUIDs/.test(error.message)
    );
    assert.throws(
        () => populateGodownGuids(
            [{ godown: 'Missing', godownGuid: '' }],
            [{ name: 'Main', guid: 'main-guid' }]
        ),
        error => error instanceof GodownStockSnapshotValidationError
            && /no PostgreSQL GUID/.test(error.message)
    );
});

test('parses stock summary rows when godown stock info is nested inside SSBATCHNAME blocks', () => {
    const xml = `
<ENVELOPE>
  <DSPACCNAME>
    <DSPDISPNAME>Sample Item</DSPDISPNAME>
  </DSPACCNAME>
  <SSBATCHNAME>
    <SSGODOWN>Main Godown</SSGODOWN>
    <DSPSTKINFO>
      <DSPCLQTY>1,250 PCS</DSPCLQTY>
      <DSPCLRATE>10.50</DSPCLRATE>
      <DSPCLAMTA>13,125.00</DSPCLAMTA>
    </DSPSTKINFO>
  </SSBATCHNAME>
  <SSBATCHNAME>
    <SSGODOWN>Shop &amp; Floor</SSGODOWN>
    <DSPSTKINFO>
      <DSPCLQTY>20 BOX</DSPCLQTY>
      <DSPCLRATE>5</DSPCLRATE>
      <DSPCLAMTA>100</DSPCLAMTA>
    </DSPSTKINFO>
  </SSBATCHNAME>
</ENVELOPE>`;

    assert.deepEqual(parseStockSummaryRows(xml), [
        {
            item: 'Sample Item',
            godown: 'Main Godown',
            closingQty: '1250',
            uom: 'PCS',
            closingRate: '10.50',
            closingValue: '13125.00'
        },
        {
            item: 'Sample Item',
            godown: 'Shop & Floor',
            closingQty: '20',
            uom: 'BOX',
            closingRate: '5',
            closingValue: '100'
        }
    ]);
});

test('stock summary request enables godown-wise item explosion', () => {
    const xml = buildStockSummaryRequest({
        definition: '',
        server: 'localhost',
        port: 9000,
        fromdate: '',
        todate: '',
        sync: 'incremental',
        batchsize: 1000,
        frequency: 0,
        company: 'A&B Traders'
    });

    assert.match(xml, /<EXPLODEFLAG>Yes<\/EXPLODEFLAG>/);
    assert.match(xml, /<ISITEMWISE>Yes<\/ISITEMWISE>/);
    assert.match(xml, /<SVCURRENTCOMPANY>A&amp;B Traders<\/SVCURRENTCOMPANY>/);
});

test('parses Tally Godown Summary sequential godown and item rows', () => {
    const xml = `
<ENVELOPE>
  <DSPACCNAME><DSPDISPNAME>Main Location</DSPDISPNAME></DSPACCNAME>
  <DSPSTKINFO><DSPSTKCL><DSPCLQTY></DSPCLQTY><DSPCLRATE></DSPCLRATE><DSPCLAMTA>-100</DSPCLAMTA></DSPSTKCL></DSPSTKINFO>
  <DSPACCNAME><DSPDISPNAME>Sample Item</DSPDISPNAME></DSPACCNAME>
  <DSPSTKINFO><DSPSTKCL><DSPCLQTY>12 PCS</DSPCLQTY><DSPCLRATE>10</DSPCLRATE><DSPCLAMTA>-120</DSPCLAMTA></DSPSTKCL></DSPSTKINFO>
  <DSPACCNAME><DSPDISPNAME>Shop &amp; Floor</DSPDISPNAME></DSPACCNAME>
  <DSPSTKINFO><DSPSTKCL><DSPCLQTY></DSPCLQTY><DSPCLRATE></DSPCLRATE><DSPCLAMTA>-50</DSPCLAMTA></DSPSTKCL></DSPSTKINFO>
  <DSPACCNAME><DSPDISPNAME>Second Item</DSPDISPNAME></DSPACCNAME>
  <DSPSTKINFO><DSPSTKCL><DSPCLQTY>2 BOX</DSPCLQTY><DSPCLRATE>25</DSPCLRATE><DSPCLAMTA>-50</DSPCLAMTA></DSPSTKCL></DSPSTKINFO>
</ENVELOPE>`;

    assert.deepEqual(parseGodownSummaryRows(xml, ['Main Location', 'Shop & Floor']), [
        {
            item: 'Sample Item',
            godown: 'Main Location',
            closingQty: '12',
            uom: 'PCS',
            closingRate: '10',
            closingValue: '-120'
        },
        {
            item: 'Second Item',
            godown: 'Shop & Floor',
            closingQty: '2',
            uom: 'BOX',
            closingRate: '25',
            closingValue: '-50'
        }
    ]);
});

test('godown summary request selects the Tally godown report', () => {
    const xml = buildGodownSummaryRequest({
        definition: '',
        server: 'localhost',
        port: 9000,
        fromdate: '',
        todate: '',
        sync: 'incremental',
        batchsize: 1000,
        frequency: 0,
        company: 'A&B Traders'
    });

    assert.match(xml, /<ID>Godown Summary<\/ID>/);
    assert.match(xml, /<EXPLODEFLAG>Yes<\/EXPLODEFLAG>/);
    assert.match(xml, /<SVCURRENTCOMPANY>A&amp;B Traders<\/SVCURRENTCOMPANY>/);
});

test('parses positive and zero rows with immutable identities from custom stock XML', () => {
    const xml = `
<ENVELOPE>
  <rowType>ITEM</rowType>
  <stockGroup>SF</stockGroup>
  <stockItem>10002 SF</stockItem>
  <itemGuid>item-guid-10002</itemGuid>
  <batchName></batchName>
  <godown></godown>
  <godownGuid></godownGuid>
  <asOnDate>20260817</asOnDate>
  <sourceCompany>Kunal &amp; Co</sourceCompany>
  <closingQty>20.00 SHEET</closingQty>
  <uom>SHEET</uom>
  <closingRate>1220.51</closingRate>
  <closingValue>24483.39</closingValue>
  <rowType>GODOWN</rowType>
  <stockGroup>SF</stockGroup>
  <stockItem>10002 SF</stockItem>
  <itemGuid>item-guid-10002</itemGuid>
  <batchName>Primary Batch</batchName>
  <godown>Goshamahal</godown>
  <godownGuid>godown-guid-goshamahal</godownGuid>
  <asOnDate>20260817</asOnDate>
  <sourceCompany>Kunal &amp; Co</sourceCompany>
  <closingQty>14.00 SHEET</closingQty>
  <uom>SHEET</uom>
  <closingRate>1232.70</closingRate>
  <closingValue>-17257.75</closingValue>
  <rowType>GODOWN</rowType>
  <stockGroup>SF</stockGroup>
  <stockItem>10002 SF</stockItem>
  <itemGuid>item-guid-10002</itemGuid>
  <batchName>Primary Batch</batchName>
  <godown>Kukatpally</godown>
  <godownGuid>godown-guid-kukatpally</godownGuid>
  <asOnDate>20260817</asOnDate>
  <sourceCompany>Kunal &amp; Co</sourceCompany>
  <closingQty>0.00 SHEET</closingQty>
  <uom>SHEET</uom>
  <closingRate>1204.27</closingRate>
  <closingValue></closingValue>
</ENVELOPE>`;

    assert.deepEqual(parseGodownStockSnapshotRows(xml), [
        {
            rowType: 'GODOWN',
            stockGroup: 'SF',
            item: '10002 SF',
            itemGuid: 'item-guid-10002',
            batchName: 'Primary Batch',
            godown: 'Goshamahal',
            godownGuid: 'godown-guid-goshamahal',
            closingQty: '14.00',
            uom: 'SHEET',
            closingRate: '1232.70',
            closingValue: '-17257.75',
            asOnDate: '2026-08-17',
            sourceCompany: 'Kunal & Co'
        },
        {
            rowType: 'GODOWN',
            stockGroup: 'SF',
            item: '10002 SF',
            itemGuid: 'item-guid-10002',
            batchName: 'Primary Batch',
            godown: 'Kukatpally',
            godownGuid: 'godown-guid-kukatpally',
            closingQty: '0.00',
            uom: 'SHEET',
            closingRate: '1204.27',
            closingValue: null,
            asOnDate: '2026-08-17',
            sourceCompany: 'Kunal & Co'
        }
    ]);
});

test('accepts a compact Tally date exported with numeric display separators', () => {
    const xml = `<ENVELOPE>
      <rowType>GODOWN</rowType>
      <stockItem>Item A</stockItem>
      <itemGuid>item-guid-a</itemGuid>
      <godown>Main</godown>
      <godownGuid>godown-guid-main</godownGuid>
      <closingQty>1 PCS</closingQty>
      <asOnDate>20,260,817</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>
    </ENVELOPE>`;

    assert.equal(parseGodownStockSnapshot(xml).asOnDate, '2026-08-17');
});

test('normalizes supported Tally negative quantity formats and records sign metrics', () => {
    const quantityRows = ['-12 PCS', '(-)13 PCS', '14 PCS(-)', '(15) PCS'];
    const xml = `<ENVELOPE>${quantityRows.map((quantity, index) => `
      <rowType>GODOWN</rowType>
      <stockGroup>SF</stockGroup>
      <stockItem>Negative Item ${index}</stockItem>
      <itemGuid>item-guid-${index}</itemGuid>
      <batchName>Primary Batch</batchName>
      <godown>Godown ${index}</godown>
      <godownGuid>godown-guid-${index}</godownGuid>
      <closingQty>${quantity}</closingQty>
      <uom>PCS</uom>
      <closingRate>10</closingRate>
      <closingValue>(120)</closingValue>
      <asOnDate>20260817</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>`).join('')}
    </ENVELOPE>`;

    const result = parseGodownStockSnapshot(xml);

    assert.deepEqual(result.rows.map(row => row.closingQty), ['-12', '-13', '-14', '-15']);
    assert.deepEqual(result.rows.map(row => row.closingValue), ['-120', '-120', '-120', '-120']);
    assert.deepEqual(result.metrics, {
        rawRows: 4,
        acceptedRows: 4,
        positiveRows: 0,
        negativeRows: 4,
        zeroRows: 0,
        rejectedRows: 0
    });
});

test('treats an explicitly empty TDL closing quantity as zero stock', () => {
    const xml = `<ENVELOPE>
      <rowType>GODOWN</rowType>
      <stockItem>Zero Item</stockItem>
      <itemGuid>zero-item-guid</itemGuid>
      <godown>Main Location</godown>
      <closingQty></closingQty>
      <uom>PCS</uom>
      <asOnDate>20260820</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>
    </ENVELOPE>`;

    const result = parseGodownStockSnapshot(xml);

    assert.equal(result.rows[0].closingQty, '0');
    assert.equal(result.rows[0].uom, 'PCS');
    assert.equal(result.metrics.zeroRows, 1);
});

test('rejects a Godown row when the closing quantity tag is missing', () => {
    const xml = `<ENVELOPE>
      <rowType>GODOWN</rowType>
      <stockItem>Broken Item</stockItem>
      <itemGuid>broken-item-guid</itemGuid>
      <godown>Main Location</godown>
      <asOnDate>20260820</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>
    </ENVELOPE>`;

    assert.throws(
        () => parseGodownStockSnapshot(xml),
        error => error instanceof GodownStockSnapshotValidationError
            && /invalid closingQty/.test(error.message)
    );
});

test('rejects an unterminated empty closing quantity tag', () => {
    const xml = `<ENVELOPE>
      <rowType>GODOWN</rowType>
      <stockItem>Broken Item</stockItem>
      <itemGuid>broken-item-guid</itemGuid>
      <godown>Main Location</godown>
      <closingQty>
      <uom>PCS</uom>
      <asOnDate>20260820</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>
    </ENVELOPE>`;

    assert.throws(
        () => parseGodownStockSnapshot(xml),
        error => error instanceof GodownStockSnapshotValidationError
            && /invalid closingQty/.test(error.message)
    );
});

test('rejects malformed quantity rows instead of publishing a partial snapshot', () => {
    const xml = `<ENVELOPE>
      <rowType>GODOWN</rowType>
      <stockItem>Broken Item</stockItem>
      <itemGuid>broken-item-guid</itemGuid>
      <godown>Main Location</godown>
      <godownGuid>main-location-guid</godownGuid>
      <closingQty>not-a-quantity</closingQty>
      <asOnDate>20260817</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>
    </ENVELOPE>`;

    assert.throws(
        () => parseGodownStockSnapshotRows(xml),
        error => error instanceof GodownStockSnapshotValidationError && /invalid closingQty/.test(error.message)
    );
});

test('rejects a response without snapshot metadata before replacing PostgreSQL data', () => {
    assert.throws(
        () => parseGodownStockSnapshotRows('<ENVELOPE></ENVELOPE>'),
        error => error instanceof GodownStockSnapshotValidationError
            && /missing sourceCompany/.test(error.message)
            && /missing or invalid asOnDate/.test(error.message)
    );
});

test('rejects item-only or truncated responses instead of publishing an empty snapshot', () => {
    const itemOnlyXml = `<ENVELOPE>
      <rowType>ITEM</rowType>
      <stockItem>Item A</stockItem>
      <itemGuid>item-guid-a</itemGuid>
      <asOnDate>20260817</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>
    </ENVELOPE>`;
    const truncatedXml = `<ENVELOPE>
      <rowType>GODOWN</rowType>
      <stockItem>Item A</stockItem>
      <itemGuid>item-guid-a</itemGuid>
      <godown>Main</godown>
      <godownGuid>godown-guid-main</godownGuid>
      <closingQty>1</closingQty>
      <asOnDate>20260817</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>`;

    assert.throws(
        () => parseGodownStockSnapshotRows(itemOnlyXml),
        error => error instanceof GodownStockSnapshotValidationError && /no GODOWN rows/.test(error.message)
    );
    assert.throws(
        () => parseGodownStockSnapshotRows(truncatedXml),
        error => error instanceof GodownStockSnapshotValidationError && /invalid XML envelope/.test(error.message)
    );
});

test('rejects invalid calendar dates and mixed snapshot metadata', () => {
    const xml = `<ENVELOPE>
      <rowType>GODOWN</rowType>
      <stockItem>Item A</stockItem>
      <itemGuid>item-guid-a</itemGuid>
      <godown>Main</godown>
      <godownGuid>godown-guid-main</godownGuid>
      <closingQty>1</closingQty>
      <asOnDate>20260231</asOnDate>
      <sourceCompany>Kunal Enterprises</sourceCompany>
      <rowType>GODOWN</rowType>
      <stockItem>Item B</stockItem>
      <itemGuid>item-guid-b</itemGuid>
      <godown>Main</godown>
      <godownGuid>godown-guid-main</godownGuid>
      <closingQty>2</closingQty>
      <asOnDate>20260817</asOnDate>
      <sourceCompany>Different Company</sourceCompany>
    </ENVELOPE>`;

    assert.throws(
        () => parseGodownStockSnapshotRows(xml),
        error => error instanceof GodownStockSnapshotValidationError
            && /invalid asOnDate|metadata does not match/.test(error.message)
    );
});

test('validates replacement metrics before opening PostgreSQL', async () => {
    const row = {
        rowType: 'GODOWN',
        stockGroup: 'SF',
        item: 'Item A',
        itemGuid: 'item-guid-a',
        batchName: '',
        godown: 'Main',
        godownGuid: 'godown-guid-main',
        closingQty: '-2',
        uom: 'PCS',
        closingRate: null,
        closingValue: null,
        asOnDate: '2026-08-17',
        sourceCompany: 'Kunal Enterprises'
    };

    await assert.rejects(
        replaceGodownStockSummaryRows([row], {
            sourceCompany: 'Kunal Enterprises',
            asOnDate: '2026-08-17',
            metrics: {
                rawRows: 1,
                acceptedRows: 1,
                positiveRows: 1,
                negativeRows: 0,
                zeroRows: 0,
                rejectedRows: 0
            }
        }),
        error => error instanceof GodownStockSnapshotValidationError && /positiveRows/.test(error.message)
    );
});

test('rejects empty replacements and blank quantities before opening PostgreSQL', async () => {
    const emptyMetrics = {
        rawRows: 0,
        acceptedRows: 0,
        positiveRows: 0,
        negativeRows: 0,
        zeroRows: 0,
        rejectedRows: 0
    };
    await assert.rejects(
        replaceGodownStockSummaryRows([], {
            sourceCompany: 'Kunal Enterprises',
            asOnDate: '2026-08-17',
            metrics: emptyMetrics
        }),
        error => error instanceof GodownStockSnapshotValidationError && /no GODOWN rows/.test(error.message)
    );

    const blankQuantityRow = {
        rowType: 'GODOWN',
        stockGroup: '',
        item: 'Item A',
        itemGuid: 'item-guid-a',
        batchName: '',
        godown: 'Main',
        godownGuid: 'godown-guid-main',
        closingQty: '',
        uom: 'PCS',
        closingRate: null,
        closingValue: null,
        asOnDate: '2026-08-17',
        sourceCompany: 'Kunal Enterprises'
    };
    await assert.rejects(
        replaceGodownStockSummaryRows([blankQuantityRow], {
            sourceCompany: 'Kunal Enterprises',
            asOnDate: '2026-08-17',
            metrics: { ...emptyMetrics, rawRows: 1, acceptedRows: 1, zeroRows: 1 }
        }),
        error => error instanceof GodownStockSnapshotValidationError && /invalid closingQty/.test(error.message)
    );
});

test('publishes snapshots without table-exclusive statements and serializes writers', async () => {
    const queries = [];
    const client = {
        async query(sql, params = []) {
            queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
            return { rows: [] };
        }
    };
    const row = {
        rowType: 'GODOWN',
        stockGroup: '',
        item: 'Item A',
        itemGuid: 'item-guid-a',
        batchName: '',
        godown: 'Main',
        godownGuid: 'godown-guid-main',
        closingQty: '-2',
        uom: 'PCS',
        closingRate: null,
        closingValue: null,
        asOnDate: '2026-08-17',
        sourceCompany: 'Kunal Enterprises'
    };

    await publishGodownStockSnapshot(client, [row], {
        snapshotId: 'new-snapshot',
        sourceCompany: 'Kunal Enterprises',
        asOnDate: '2026-08-17',
        refreshedAt: new Date('2026-08-17T12:00:00Z'),
        metrics: {
            rawRows: 1,
            acceptedRows: 1,
            positiveRows: 0,
            negativeRows: 1,
            zeroRows: 0,
            rejectedRows: 0
        }
    });

    const sql = queries.map(query => query.sql.toLowerCase());
    assert.equal(sql[0], 'begin');
    assert.match(sql[1], /pg_advisory_xact_lock/);
    assert.doesNotMatch(sql.join('\n'), /truncate table|alter table|create table/);

    const replacementIndex = sql.findIndex(statement => statement === 'delete from "public"."stock_godown_summary"');
    const insertIndex = sql.findIndex(statement => statement.startsWith('insert into "public"."stock_godown_summary"'));
    const stateIndex = sql.findIndex(statement => statement.startsWith('insert into "public"."stock_godown_summary_state"'));
    assert.ok(replacementIndex > 1);
    assert.ok(insertIndex > replacementIndex);
    assert.ok(stateIndex > insertIndex);
    assert.equal(sql.at(-1), 'commit');
});

test('locks snapshot state before applying a legacy summary schema upgrade', async () => {
    const queries = [];
    const client = {
        async query(sql, params = []) {
            const normalized = String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
            queries.push({ sql: normalized, params });
            return { rows: normalized.startsWith('select to_regclass') ? [{ ready: false }] : [] };
        }
    };

    await ensureGodownStockSnapshotSchema(client);

    const sql = queries.map(query => query.sql);
    const stateCreateIndex = sql.findIndex(statement => statement.startsWith('create table if not exists public.stock_godown_summary_state'));
    const stateLockIndex = sql.findIndex(statement => statement.startsWith('lock table public.stock_godown_summary_state'));
    const summaryCreateIndex = sql.findIndex(statement => statement.startsWith('create table if not exists public.stock_godown_summary ('));
    assert.ok(stateCreateIndex > 1);
    assert.ok(stateLockIndex > stateCreateIndex);
    assert.ok(summaryCreateIndex > stateLockIndex);
    assert.match(sql.join('\n'), /alter table public\.stock_godown_summary add column if not exists source_snapshot_id/);
    assert.equal(sql.at(-1), 'commit');
});

test('custom stock snapshot request selects the loaded TDL report with an explicit period', () => {
    const xml = buildGodownStockSnapshotRequest({
        definition: '',
        server: 'localhost',
        port: 9000,
        fromdate: '2026-04-01',
        todate: '2026-08-17',
        sync: 'incremental',
        batchsize: 1000,
        frequency: 0,
        company: 'A&B Traders'
    });

    assert.match(xml, /<ID>DB Godown Stock Snapshot<\/ID>/);
    assert.match(xml, /<EXPLODEFLAG>Yes<\/EXPLODEFLAG>/);
    assert.match(xml, /<SVFROMDATE>20260401<\/SVFROMDATE>/);
    assert.match(xml, /<SVTODATE>20260817<\/SVTODATE>/);
    assert.match(xml, /<SVCURRENTCOMPANY>A&amp;B Traders<\/SVCURRENTCOMPANY>/);
});
