import { performance } from 'node:perf_hooks';
import { processTdlOutputManipulation } from '../dist/yaml-report-exporter.mjs';

const sizes = [1_000, 10_000, 100_000];

function fixture(rows) {
    let xml = '<ENVELOPE>';
    for (let i = 0; i < rows; i++) {
        xml += `<F01>guid-${i}</F01><F02>Voucher ${i}</F02><F03>${100 + i}</F03>`;
    }
    xml += '</ENVELOPE>';
    return xml;
}

function run(label, fn) {
    const start = performance.now();
    const result = fn();
    return { label, elapsedMs: performance.now() - start, bytes: Buffer.byteLength(result), rows: result.split(/\r\n/g).filter(Boolean).length };
}

for (const rows of sizes) {
    const xml = fixture(rows);
    const legacy = run(`legacy ${rows}`, () => processTdlOutputManipulation(xml));
    const streamingEquivalent = run(`streaming ${rows}`, () => processTdlOutputManipulation(xml));
    console.log(JSON.stringify({ rows, legacy, streamingEquivalent }));
}
