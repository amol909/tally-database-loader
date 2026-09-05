import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';

//Tally builds a whole report in memory before sending anything, so two requests at once double
//its peak footprint and can kill it. Every Tally caller on this machine takes this lock first.

const WAIT_MS = 900000;      //how long to queue before giving up
const HEARTBEAT_MS = 15000;  //how often a holder refreshes its claim while it works
const STALE_MS = 120000;     //a claim not refreshed for this long is abandoned

function lockPath(server: string, port: number): string {
    return path.join(os.tmpdir(), `tally-lock-${`${server}-${port}`.replace(/[^\w.-]/g, '_')}`);
}

function claim(label: string): string {
    return JSON.stringify({ pid: process.pid, label, at: Date.now() });
}

function holder(file: string): { pid: number, label: string, at: number } | null {
    try {
        const p = JSON.parse(fs.readFileSync(file, 'utf8'));
        return typeof p?.pid == 'number' ? p : null;
    } catch {
        return null;
    }
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0); //signal 0 tests existence without touching the process
        return true;
    } catch (err: any) {
        return err?.code == 'EPERM';
    }
}

/**
 * A live holder must never lose its lock: a stolen lock puts a second request on Tally, which is
 * the only cause measurement has confirmed kills tally.exe outright. Age alone is therefore not
 * evidence of staleness - the holder refreshes `at` while it works, so an expired claim means the
 * holder is dead or wedged, never merely slow.
 */
function isStale(file: string): boolean {
    const h = holder(file);
    if (!h) {
        return true; //unreadable lock must not wedge the app forever
    }
    if (h.pid == process.pid) {
        return false;
    }
    return !isAlive(h.pid) || Date.now() - h.at > STALE_MS;
}

/**
 * `onAcquired` reports how long the caller queued behind another Tally request. Callers that
 * measure their own request must subtract this, or a busy queue reads as a slow Tally.
 */
export async function withTallyLock<T>(server: string, port: number, label: string, action: () => Promise<T>, onAcquired?: (lockWaitMs: number) => void): Promise<T> {
    const file = lockPath(server, port);
    const startedAt = Date.now();
    const deadline = startedAt + WAIT_MS;

    while (true) {
        try {
            //'wx' fails if the file exists, which makes creation an atomic test-and-set
            fs.writeFileSync(file, claim(label), { flag: 'wx' });
            break;
        } catch (err: any) {
            if (err?.code != 'EEXIST') {
                throw err;
            }
            if (isStale(file)) {
                try { fs.unlinkSync(file); } catch { }
                continue;
            }
            if (Date.now() >= deadline) {
                const h = holder(file);
                throw new Error(`Timed out waiting for Tally ${server}:${port}, held by pid ${h?.pid} (${h?.label}).`);
            }
            await new Promise(r => setTimeout(r, 200));
        }
    }

    if (onAcquired) {
        onAcquired(Date.now() - startedAt);
    }

    //keep the claim fresh so a long but healthy request is never mistaken for an abandoned one
    const heartbeat = setInterval(() => {
        try {
            const h = holder(file);
            if (h && h.pid == process.pid) {
                fs.writeFileSync(file, claim(label));
            }
        } catch { }
    }, HEARTBEAT_MS);
    heartbeat.unref(); //never keep the process alive just to hold a lock

    try {
        return await action();
    } finally {
        clearInterval(heartbeat);
        try {
            const h = holder(file);
            if (!h || h.pid == process.pid) { //never delete a lock a takeover handed to someone else
                fs.unlinkSync(file);
            }
        } catch { }
    }
}
