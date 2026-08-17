import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('custom godown stock TDL asset defines the API report and request', () => {
    const tdl = fs.readFileSync('tdl/db-godown-stock-snapshot.tdl', 'utf8');
    const request = fs.readFileSync('tdl/db-godown-stock-snapshot-request.xml', 'utf8');

    assert.match(tdl, /\[Report\s*:\s*DB Godown Stock Snapshot\]/i);
    assert.match(tdl, /Type\s*:\s*Batch/i);
    assert.match(tdl, /Child Of\s*:\s*#DBGSSStockItemName/i);
    assert.match(tdl, /GodownName/i);
    assert.match(tdl, /XMLTag\s*:\s*"itemGuid"/i);
    assert.match(tdl, /XMLTag\s*:\s*"godownGuid"/i);
    assert.match(tdl, /XMLTag\s*:\s*"asOnDate"/i);
    assert.match(tdl, /\[Field\s*:\s*DBGSSAsOnDate\][\s\S]*?Use\s*:\s*Name Field/i);
    assert.match(tdl, /XMLTag\s*:\s*"sourceCompany"/i);
    assert.match(tdl, /StringFindAndReplace[\s\S]*"\(-\)"\s*:\s*"-"/i);
    assert.match(request, /<ID>DB Godown Stock Snapshot<\/ID>/);
    assert.match(request, /<SVFROMDATE>\d{8}<\/SVFROMDATE>/);
    assert.match(request, /<SVTODATE>\d{8}<\/SVTODATE>/);
});

test('custom voucher inventory TDL asset defines voucher-driven inventory report', () => {
    const tdl = fs.readFileSync('tdl/db-voucher-inventory-lines.tdl', 'utf8');
    const request = fs.readFileSync('tdl/db-voucher-inventory-lines-request.xml', 'utf8');

    assert.match(tdl, /\[Report\s*:\s*DB Voucher Inventory Lines\]/i);
    assert.match(tdl, /Type\s*:\s*Voucher/i);
    assert.match(tdl, /AllInventoryEntries/i);
    assert.match(tdl, /DBVILFromAlterID/i);
    assert.doesNotMatch(tdl, /^\s*Sort\s*:/im);
    assert.match(request, /<ID>DB Voucher Inventory Lines<\/ID>/);
});
