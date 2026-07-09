import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildGodownStockSnapshotRequest,
    buildGodownSummaryRequest,
    buildStockSummaryRequest,
    parseGodownStockSnapshotRows,
    parseGodownSummaryRows,
    parseStockSummaryRows
} from '../dist/godown-stock-summary.mjs';

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

test('parses non-zero godown rows from custom DB Godown Stock Snapshot XML', () => {
    const xml = `
<ENVELOPE>
  <rowType>ITEM</rowType>
  <stockGroup>SF</stockGroup>
  <stockItem>10002 SF</stockItem>
  <batchName></batchName>
  <godown></godown>
  <closingQty>20.00 SHEET</closingQty>
  <uom>SHEET</uom>
  <closingRate>1220.51</closingRate>
  <closingValue>24483.39</closingValue>
  <rowType>GODOWN</rowType>
  <stockGroup>SF</stockGroup>
  <stockItem>10002 SF</stockItem>
  <batchName>Primary Batch</batchName>
  <godown>Goshamahal</godown>
  <closingQty>14.00 SHEET</closingQty>
  <uom>SHEET</uom>
  <closingRate>1232.70</closingRate>
  <closingValue>-17257.75</closingValue>
  <rowType>GODOWN</rowType>
  <stockGroup>SF</stockGroup>
  <stockItem>10002 SF</stockItem>
  <batchName>Primary Batch</batchName>
  <godown>Kukatpally</godown>
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
            batchName: 'Primary Batch',
            godown: 'Goshamahal',
            closingQty: '14.00',
            uom: 'SHEET',
            closingRate: '1232.70',
            closingValue: '-17257.75'
        }
    ]);
});

test('custom stock snapshot request selects the loaded TDL report', () => {
    const xml = buildGodownStockSnapshotRequest({
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

    assert.match(xml, /<ID>DB Godown Stock Snapshot<\/ID>/);
    assert.match(xml, /<EXPLODEFLAG>Yes<\/EXPLODEFLAG>/);
    assert.match(xml, /<SVCURRENTCOMPANY>A&amp;B Traders<\/SVCURRENTCOMPANY>/);
});
