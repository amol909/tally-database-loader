import http from 'http';
import process from 'process';
import { createHash } from 'crypto';
import { tallyConfig } from './definition.mjs';
import { logger } from './logger.mjs';
import { MetricsSink } from './metrics.mjs';
import { withTallyLock } from './tally-lock.mjs';

//Tally holds the socket silent while it builds the report, so this is a build-time budget.
//
//Measured against the production company: a voucher collection walks the whole company on every
//request regardless of period or filters, and completes in 168s warm / 399s cold for ~300 MB. The
//previous 600000 sat close enough to that range that a cold cache, a richer fetch list or another
//user's load tipped runs over it - which is what the "Tally request exceeded 600000ms" failures
//were. They were never a crash or a hang: our own stopwatch was destroying a socket that would
//have delivered. 1800000 clears the measured worst case with room to spare.
export function tallyRequestTimeoutMs(): number {
    const configured = parseInt(process.env['TALLY_REQUEST_TIMEOUT_MS'] || '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : 1800000;
}

//req.setTimeout is an inactivity timeout, so on its own nothing bounds a request's wall-clock
//time. An unbounded request outlives the lock's staleness window and ends up running beside the
//next one, which is the confirmed way to kill Tally. This is the hard ceiling.
export function tallyRequestMaxMs(): number {
    const configured = parseInt(process.env['TALLY_REQUEST_MAX_MS'] || '', 10);
    return Number.isFinite(configured) && configured > 0 ? configured : tallyRequestTimeoutMs();
}

export interface TallyTransport {
    post(xml: string): Promise<string>;
}

export class HttpTallyTransport implements TallyTransport {
    constructor(private readonly config: tallyConfig, private readonly metrics?: MetricsSink) { }

    /**
     * Emits one `tally_request` metric per call with lock wait, time-to-first-byte and request
     * time kept apart. The caller's own timer around post() cannot tell them apart, so a request
     * queued behind another one used to be indistinguishable from a slow Tally report.
     */
    async post(msg: string): Promise<string> {
        const startedAt = Date.now();
        let lockWaitMs = 0;
        try {
            const response = await withTallyLock(
                this.config.server,
                this.config.port,
                'tally export',
                () => this.postUnlocked(msg),
                waitMs => { lockWaitMs = waitMs; }
            );
            this.recordRequest(msg, startedAt, lockWaitMs, true, undefined, response);
            return response;
        } catch (err) {
            this.recordRequest(msg, startedAt, lockWaitMs, false, err);
            throw err;
        }
    }

    private recordRequest(msg: string, startedAt: number, lockWaitMs: number, success: boolean, error?: unknown, response?: string): void {
        if (!this.metrics) {
            return;
        }
        const elapsedMs = Date.now() - startedAt;
        this.metrics.record({
            phase: 'tally_request',
            elapsedMs,
            success,
            error: error instanceof Error ? error.message : error ? String(error) : undefined,
            calls: 1,
            lockWaitMs,
            ttfbMs: this.lastTtfbMs,
            xmlSha256: createHash('sha256').update(msg, 'utf8').digest('hex'),
            xmlBytes: Buffer.byteLength(msg, 'utf16le'),
            responseBytes: response == undefined ? undefined : Buffer.byteLength(response, 'utf16le')
        });
    }

    //set by the in-flight request so recordRequest can report it without threading a return value
    private lastTtfbMs?: number;

    private postUnlocked(msg: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const requestStartedAt = Date.now();
            this.lastTtfbMs = undefined;
            let settled = false;
            let hardCap: NodeJS.Timeout | undefined;
            const settle = (fn: () => void) => {
                if (settled) {
                    return; //a destroyed request emits both a timeout and an error
                }
                settled = true;
                if (hardCap) {
                    clearTimeout(hardCap);
                }
                fn();
            };

            try {
                const req = http.request({
                    hostname: this.config.server,
                    port: this.config.port,
                    path: '',
                    method: 'POST',
                    headers: {
                        'Content-Length': Buffer.byteLength(msg, 'utf16le'),
                        'Content-Type': 'text/xml;charset=utf-16'
                    }
                },
                    (res) => {
                        let data = '';
                        res
                            .setEncoding('utf16le')
                            .on('data', (chunk) => {
                                if (this.lastTtfbMs == undefined) {
                                    this.lastTtfbMs = Date.now() - requestStartedAt;
                                }
                                data += chunk.toString() || '';
                            })
                            .on('end', () => {
                                settle(() => resolve(data));
                            })
                            .on('error', (httpErr) => {
                                settle(() => {
                                    logger.logMessage('Unable to connect with Tally. Ensure tally XML port is enabled');
                                    logger.logError('tally.postTallyXML()', httpErr['message'] || '');
                                    reject(httpErr);
                                });
                            });
                    });
                req.on('error', (reqError) => {
                    settle(() => {
                        logger.logMessage('Unable to connect with Tally. Ensure tally XML port is enabled');
                        logger.logError('tally.postTallyXML()', reqError['message'] || '');
                        reject(reqError);
                    });
                });
                req.setTimeout(tallyRequestTimeoutMs(), () => {
                    req.destroy(new Error('Tally request timed out'));
                });
                hardCap = setTimeout(() => {
                    req.destroy(new Error(`Tally request exceeded ${tallyRequestMaxMs()}ms`));
                }, tallyRequestMaxMs());
                hardCap.unref();
                req.write(msg, 'utf16le');
                req.end();
            } catch (err) {
                settle(() => {
                    logger.logError('tally.postTallyXML()', err);
                    reject(err);
                });
            }
        });
    }
}

export class FakeTallyTransport implements TallyTransport {
    calls: string[] = [];

    constructor(private readonly response: string | ((xml: string) => string | Promise<string>)) { }

    async post(xml: string): Promise<string> {
        this.calls.push(xml);
        if (typeof this.response === 'function') {
            return await this.response(xml);
        }
        return this.response;
    }
}
