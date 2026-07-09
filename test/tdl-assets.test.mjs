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
    assert.match(request, /<ID>DB Godown Stock Snapshot<\/ID>/);
});
