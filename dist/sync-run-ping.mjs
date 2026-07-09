import { database } from './database.mjs';
import { logger } from './logger.mjs';
export function buildSyncRunPingDDL() {
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
export function buildSyncRunPingInsert(run) {
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
export async function recordSyncRunPing(run) {
    if (database.config.technology != 'postgres') {
        return;
    }
    try {
        await database.openConnectionPool();
        const client = await database.connectionPoolPostgres.connect();
        try {
            await client.query(buildSyncRunPingDDL());
            const insert = buildSyncRunPingInsert(run);
            await client.query(insert.sql, insert.params);
        }
        finally {
            client.release();
            await database.closeConnectionPool();
        }
    }
    catch (err) {
        logger.logError('recordSyncRunPing()', err);
    }
}
//# sourceMappingURL=sync-run-ping.mjs.map