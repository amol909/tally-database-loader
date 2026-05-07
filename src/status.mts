import fs from 'node:fs';
import process from 'node:process';

export const STATUS_PATH = './sync-status.json';

export interface syncStatus {
    pid: number;
    state: 'starting' | 'idle' | 'checking' | 'importing' | 'error' | 'stopped';
    startedAt: string;
    updatedAt: string;
    frequency: number;
    message: string;
    lastCheckAt?: string;
    lastImportStartedAt?: string;
    lastImportFinishedAt?: string;
    lastErrorAt?: string;
}

function nowIso(): string {
    return new Date().toISOString();
}

function isProcessAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

export function writeSyncStatus(status: syncStatus): void {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 4) + '\n', { encoding: 'utf8' });
}

export function readSyncStatus(): syncStatus | undefined {
    if (!fs.existsSync(STATUS_PATH)) return undefined;
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8')) as syncStatus;
}

export function createSyncStatus(frequency: number): syncStatus {
    const currentTime = nowIso();
    return {
        pid: process.pid,
        state: 'starting',
        startedAt: currentTime,
        updatedAt: currentTime,
        frequency,
        message: 'Sync process is starting.'
    };
}

export function updateSyncStatus(status: syncStatus, patch: Partial<syncStatus>): syncStatus {
    const nextStatus = {
        ...status,
        ...patch,
        updatedAt: nowIso()
    };
    writeSyncStatus(nextStatus);
    return nextStatus;
}

export function describeSyncStatus(status: syncStatus | undefined): string[] {
    if (!status) {
        return ['No sync status file found. Background sync has not reported yet.'];
    }

    const updatedAt = new Date(status.updatedAt);
    const ageSeconds = Number.isNaN(updatedAt.getTime()) ? Number.POSITIVE_INFINITY : Math.round((Date.now() - updatedAt.getTime()) / 1000);
    const alive = isProcessAlive(status.pid);
    const freshness = ageSeconds <= 90 ? `fresh, ${ageSeconds}s ago` : `stale, ${ageSeconds}s ago`;

    return [
        `State: ${status.state}`,
        `PID: ${status.pid} (${alive ? 'running' : 'not running'})`,
        `Frequency: ${status.frequency > 0 ? `${status.frequency} minute(s)` : 'one-time sync'}`,
        `Last update: ${status.updatedAt} (${freshness})`,
        `Message: ${status.message}`,
        ...(status.lastCheckAt ? [`Last check: ${status.lastCheckAt}`] : []),
        ...(status.lastImportFinishedAt ? [`Last import: ${status.lastImportFinishedAt}`] : []),
        ...(status.lastErrorAt ? [`Last error: ${status.lastErrorAt}`] : [])
    ];
}
