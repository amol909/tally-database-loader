import test from 'node:test';
import assert from 'node:assert/strict';
import { planIncrementalMasterTableSync } from '../dist/tally.mjs';

const stockItem = { name: 'mst_stock_item', fields: [] };
const ledger = { name: 'mst_ledger', fields: [] };

test('transaction-only incremental changes do not force mst_stock_item refresh', () => {
    assert.deepEqual(planIncrementalMasterTableSync([stockItem, ledger], false, true), []);
});

test('master incremental changes sync masters without full stock item refresh', () => {
    assert.deepEqual(planIncrementalMasterTableSync([stockItem, ledger], true, true), [
        { table: stockItem, refreshAll: false },
        { table: ledger, refreshAll: false }
    ]);
});
