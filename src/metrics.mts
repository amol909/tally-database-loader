import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

export interface MetricEvent {
    runId: string;
    phase: string;
    table?: string;
    collection?: string;
    rows?: number;
    bytes?: number;
    elapsedMs: number;
    success: boolean;
    error?: string;
    syncMode?: string;
    dbTechnology?: string;
    loadMethod?: string;
    calls?: number;
}

export class MetricsSink {
    readonly runId: string;
    readonly filePath: string;

    constructor(filePath: string = path.join(process.cwd(), 'import-metrics.jsonl'), runId: string = randomUUID()) {
        this.filePath = filePath;
        this.runId = runId;
    }

    record(event: Omit<MetricEvent, 'runId'>): void {
        const metric: MetricEvent = {
            runId: this.runId,
            ...event
        };
        fs.appendFileSync(this.filePath, `${JSON.stringify(metric)}\n`, 'utf8');
    }
}

export class PhaseTimer {
    private readonly startedAt = process.hrtime.bigint();

    constructor(
        private readonly sink: MetricsSink,
        private readonly baseEvent: Omit<MetricEvent, 'runId' | 'elapsedMs' | 'success' | 'error'>
    ) { }

    end(success: boolean = true, error?: unknown, extra?: Partial<Omit<MetricEvent, 'runId' | 'elapsedMs' | 'success' | 'error'>>): number {
        const elapsedMs = Number(process.hrtime.bigint() - this.startedAt) / 1_000_000;
        this.sink.record({
            ...this.baseEvent,
            ...extra,
            elapsedMs,
            success,
            error: error instanceof Error ? error.message : error ? String(error) : undefined
        });
        return elapsedMs;
    }
}
