import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildVoucherInventoryIncrementalOptions,
    buildVoucherInventoryLinesRequest,
    parseVoucherInventoryRows,
    resolveVoucherInventoryMarkerAlterId,
    resolveVoucherInventoryUpdateMarker
} from '../dist/voucher-inventory-lines.mjs';

test('custom voucher inventory request filters at voucher AlterID level', () => {
    const xml = buildVoucherInventoryLinesRequest({
        definition: '',
        server: 'localhost',
        port: 9000,
        fromdate: '',
        todate: '',
        sync: 'incremental',
        batchsize: 1000,
        frequency: 0,
        company: 'A&B Traders'
    }, { fromAlterId: 100, toAlterId: 200 });

    assert.match(xml, /<ID>DB Voucher Inventory Lines<\/ID>/);
    assert.match(xml, /<DBVILFROMALTERID>100<\/DBVILFROMALTERID>/);
    assert.match(xml, /<DBVILTOALTERID>200<\/DBVILTOALTERID>/);
    assert.match(xml, /<SVCURRENTCOMPANY>A&amp;B Traders<\/SVCURRENTCOMPANY>/);
});

test('parses inventory rows from custom voucher inventory XML', () => {
    const xml = `
<ENVELOPE>
  <rowType>VOUCHER</rowType>
  <guid>vch-1</guid>
  <alterid>123</alterid>
  <item></item>
  <rowType>INVENTORY</rowType>
  <guid>vch-1</guid>
  <alterid>123</alterid>
  <item>Sample Item</item>
  <itemGuid>item-guid</itemGuid>
  <quantity>-2.50</quantity>
  <rate>10.25</rate>
  <amount>-25.63</amount>
  <additionalAmount></additionalAmount>
  <discountAmount>1.5</discountAmount>
  <godown>Kukatpally</godown>
  <godownGuid>godown-guid</godownGuid>
  <trackingNumber>TN-1</trackingNumber>
  <orderNumber>SO-1</orderNumber>
  <orderDueDate>20260709</orderDueDate>
</ENVELOPE>`;

    assert.deepEqual(parseVoucherInventoryRows(xml), [
        {
            guid: 'vch-1',
            alterId: 123,
            item: 'Sample Item',
            itemGuid: 'item-guid',
            quantity: '-2.50',
            rate: '10.25',
            amount: '-25.63',
            additionalAmount: null,
            discountAmount: '1.5',
            godown: 'Kukatpally',
            godownGuid: 'godown-guid',
            trackingNumber: 'TN-1',
            orderNumber: 'SO-1',
            orderDueDate: '2026-07-09'
        }
    ]);
});

test('uses bounded range end as marker when voucher inventory range has no rows', () => {
    assert.equal(resolveVoucherInventoryMarkerAlterId([], 250), 250);
});

test('uses max imported AlterID as marker for open voucher inventory ranges', () => {
    assert.equal(resolveVoucherInventoryMarkerAlterId([
        { guid: 'vch-1', alterId: 122, item: 'A' },
        { guid: 'vch-2', alterId: 125, item: 'B' }
    ]), 125);
});

test('honors Commander negated update marker option', () => {
    assert.equal(resolveVoucherInventoryUpdateMarker({ updateMarker: false }), false);
    assert.equal(resolveVoucherInventoryUpdateMarker({ updateMarker: true }), true);
    assert.equal(resolveVoucherInventoryUpdateMarker({ noUpdateMarker: true }), false);
    assert.equal(resolveVoucherInventoryUpdateMarker({}), true);
});

test('builds bounded voucher inventory options for sync runs', () => {
    assert.deepEqual(buildVoucherInventoryIncrementalOptions(1817300, 1817355), {
        fromAlterId: 1817300,
        toAlterId: 1817355
    });
});

test('does not build a backwards voucher inventory sync window', () => {
    assert.deepEqual(buildVoucherInventoryIncrementalOptions(1817355, 1817300), {
        fromAlterId: 1817355,
        toAlterId: 1817355
    });
});
