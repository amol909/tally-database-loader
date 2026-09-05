/**
 * Attributes a run's wall-clock time to phases, so "the sync takes 101 minutes" becomes a list of
 * which requests spent it. ttfb is separated from total because Tally sends nothing while building
 * a report - ttfb is Tally thinking, the remainder is transfer plus our own parsing and loading.
 * lockWait is separated again so contention cannot be mistaken for either.
 *
 * Usage:
 *   node bench/analyze-metrics.mjs                 (last run)
 *   node bench/analyze-metrics.mjs 3               (last 3 runs)
 *   node bench/analyze-metrics.mjs all             (every run, summary only)
 */
import fs from 'fs';

const file = process.env['METRICS_FILE'] || 'import-metrics.jsonl';
if (!fs.existsSync(file)) { console.log(`no ${file} in this directory`); process.exit(1); }

const events = fs.readFileSync(file, 'utf8').split('\n')
    .filter(line => line.trim())
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);

const runIds = [...new Set(events.map(e => e.runId))];
const arg = process.argv[2] || '1';
const wanted = arg === 'all' ? runIds : runIds.slice(-Math.max(1, parseInt(arg, 10) || 1));

function ms(value) {
    if (value == null) return '-';
    return value >= 60000 ? `${(value / 60000).toFixed(1)}m` : value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${Math.round(value)}ms`;
}
function mb(value) {
    if (value == null) return '-';
    return value >= 1048576 ? `${(value / 1048576).toFixed(1)}MB` : `${(value / 1024).toFixed(0)}KB`;
}

for (const runId of wanted) {
    const runEvents = events.filter(e => e.runId === runId);
    const total = runEvents.reduce((sum, e) => sum + (e.elapsedMs || 0), 0);
    const failed = runEvents.filter(e => !e.success);

    console.log(`\nrun ${runId.slice(0, 8)}  -  ${runEvents.length} events, ${ms(total)} of recorded phase time${failed.length ? `, ${failed.length} FAILED` : ''}`);
    console.log('-'.repeat(96));
    console.log('elapsed    ttfb      lock     bytes      rows   phase / table');
    console.log('-'.repeat(96));

    for (const event of [...runEvents].sort((a, b) => (b.elapsedMs || 0) - (a.elapsedMs || 0))) {
        if ((event.elapsedMs || 0) < 500 && event.success) continue; //trivia hides the shape
        const label = [event.phase, event.table || event.collection].filter(Boolean).join(' / ');
        const bytes = event.responseBytes ?? event.bytes;
        console.log(
            `${ms(event.elapsedMs).padStart(8)}  ${ms(event.ttfbMs).padStart(8)}  ${ms(event.lockWaitMs).padStart(7)}  ${mb(bytes).padStart(9)}  ${String(event.rows ?? '-').padStart(7)}   ${label}${event.success ? '' : `  <-- FAILED: ${event.error || ''}`}`
        );
    }

    //grouping by phase answers "is this the walk or the load" in a way per-event rows do not
    const byPhase = {};
    for (const event of runEvents) {
        byPhase[event.phase] = byPhase[event.phase] || { ms: 0, count: 0, ttfb: 0 };
        byPhase[event.phase].ms += event.elapsedMs || 0;
        byPhase[event.phase].ttfb += event.ttfbMs || 0;
        byPhase[event.phase].count++;
    }
    console.log('-'.repeat(96));
    console.log('totals by phase:');
    for (const [phase, stat] of Object.entries(byPhase).sort((a, b) => b[1].ms - a[1].ms)) {
        const share = total ? ` ${(stat.ms / total * 100).toFixed(0)}%` : '';
        console.log(`  ${ms(stat.ms).padStart(8)}${share.padStart(5)}  ${String(stat.count).padStart(3)} calls  ${stat.ttfb ? `${ms(stat.ttfb)} of it Tally build time` : ''}  ${phase}`);
    }
}

if (arg === 'all') {
    console.log(`\n${runIds.length} runs in ${file}`);
}
