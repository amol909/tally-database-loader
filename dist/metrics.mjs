import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
export class MetricsSink {
    runId;
    filePath;
    constructor(filePath = path.join(process.cwd(), 'import-metrics.jsonl'), runId = randomUUID()) {
        this.filePath = filePath;
        this.runId = runId;
    }
    record(event) {
        const metric = {
            runId: this.runId,
            ...event
        };
        fs.appendFileSync(this.filePath, `${JSON.stringify(metric)}\n`, 'utf8');
    }
}
export class PhaseTimer {
    sink;
    baseEvent;
    startedAt = process.hrtime.bigint();
    constructor(sink, baseEvent) {
        this.sink = sink;
        this.baseEvent = baseEvent;
    }
    end(success = true, error, extra) {
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
//# sourceMappingURL=metrics.mjs.map