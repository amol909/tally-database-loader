import fs from 'node:fs';
import process from 'node:process';
export const STATUS_PATH = './sync-status.json';
function nowIso() {
    return new Date().toISOString();
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export function writeSyncStatus(status) {
    fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 4) + '\n', { encoding: 'utf8' });
}
export function readSyncStatus() {
    if (!fs.existsSync(STATUS_PATH))
        return undefined;
    return JSON.parse(fs.readFileSync(STATUS_PATH, 'utf8'));
}
export function createSyncStatus(frequency) {
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
export function updateSyncStatus(status, patch) {
    const nextStatus = {
        ...status,
        ...patch,
        updatedAt: nowIso()
    };
    writeSyncStatus(nextStatus);
    return nextStatus;
}
export function describeSyncStatus(status) {
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
//# sourceMappingURL=status.mjs.map