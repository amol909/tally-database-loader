import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';

test('CLI exposes stock-only godown import command', () => {
    const help = childProcess.execFileSync(process.execPath, ['dist/cli.mjs', '--help'], { encoding: 'utf8' });

    assert.match(help, /stock-godown/);
    assert.match(help, /custom TDL godown stock data/);
});
