import { database } from './database.mjs';
import { logger } from './logger.mjs';
import type { PoolClient } from 'pg';

export interface syncRunPing {
    operation: string;
    status: 'success' | 'failure';
    startedAt: Date;
    finishedAt: Date;
    rowsImported?: number | null;
    message?: string | null;
    errorMessage?: string | null;
}

export function buildSyncRunPingDDL(): string {
    return `create table if not exists public.sync_run_ping (
        id bigserial primary key,
        operation text not null,
        status text not null,
        started_at timestamptz not null,
        finished_at timestamptz not null,
        duration_ms integer not null,
        rows_imported integer null,
        message text null,
        error_message text null,
        created_at timestamptz not null default now()
    )`;
}

export function buildSyncRunPingInsert(run: syncRunPing): { sql: string; params: (string | number | Date | null)[] } {
    const durationMs = Math.max(0, run.finishedAt.getTime() - run.startedAt.getTime());
    return {
        sql: `insert into public.sync_run_ping (
            operation,
            status,
            started_at,
            finished_at,
            duration_ms,
            rows_imported,
            message,
            error_message
        ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        params: [
            run.operation,
            run.status,
            run.startedAt,
            run.finishedAt,
            durationMs,
            run.rowsImported ?? null,
            run.message ?? null,
            run.errorMessage ?? null
        ]
    };
}

export function buildNoChangeSyncRunPing(startedAt: Date, finishedAt = new Date()): syncRunPing {
    return {
        operation: 'sync',
        status: 'success',
        startedAt,
        finishedAt,
        rowsImported: 0,
        message: 'No change in Tally data found.'
    };
}

export async function recordSyncRunPing(run: syncRunPing): Promise<void> {
    if (database.config.technology != 'postgres') {
        return;
    }

    let client: PoolClient | null = null;
    let shouldClosePool = false;
    try {
        shouldClosePool = true;
        await database.openConnectionPool();
        client = await database.connectionPoolPostgres.connect();
        await client.query(buildSyncRunPingDDL());
        const insert = buildSyncRunPingInsert(run);
        await client.query(insert.sql, insert.params);
    } catch (err) {
        logger.logError('recordSyncRunPing()', err);
    } finally {
        if (client) {
            client.release();
        }
        if (shouldClosePool) {
            try {
                await database.closeConnectionPool();
            } catch (err) {
                logger.logError('recordSyncRunPing.closeConnectionPool()', err);
            }
        }
    }
}
