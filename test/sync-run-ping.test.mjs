import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSyncRunPingDDL, buildSyncRunPingInsert } from '../dist/sync-run-ping.mjs';

test('sync run ping SQL creates one append-only status table', () => {
    const ddl = buildSyncRunPingDDL();

    assert.match(ddl, /create table if not exists public\.sync_run_ping/i);
    assert.match(ddl, /operation text not null/i);
    assert.match(ddl, /status text not null/i);
    assert.match(ddl, /rows_imported integer null/i);
    assert.match(ddl, /error_message text null/i);
});

test('sync run ping insert stores status and timing fields', () => {
    const startedAt = new Date('2026-07-09T07:30:00.000Z');
    const finishedAt = new Date('2026-07-09T07:30:05.250Z');
    const insert = buildSyncRunPingInsert({
        operation: 'sync',
        status: 'success',
        startedAt,
        finishedAt,
        rowsImported: 6094,
        message: 'Import completed successfully.'
    });

    assert.match(insert.sql, /insert into public\.sync_run_ping/i);
    assert.deepEqual(insert.params, [
        'sync',
        'success',
        startedAt,
        finishedAt,
        5250,
        6094,
        'Import completed successfully.',
        null
    ]);
});
