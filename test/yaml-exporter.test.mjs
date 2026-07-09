import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'js-yaml';
import { YamlReportExporter, processTdlOutputManipulation, withAdditionalFilters } from '../dist/yaml-report-exporter.mjs';
import { MetricsSink } from '../dist/metrics.mjs';
import { FakeTallyTransport } from '../dist/tally-transport.mjs';

const tableConfig = {
    name: 'mst_sample',
    collection: 'Ledger',
    nature: 'Primary',
    fields: [
        { name: 'guid', field: 'Guid', type: 'text' },
        { name: 'name', field: 'Name', type: 'text' }
    ],
    filters: ['BaseFilter']
};

function tallyXml() {
    return '<ENVELOPE><F01>g1</F01><F02>Cash &amp; Bank</F02><F01>g2</F01><F02>Sales</F02></ENVELOPE>';
}

test('exports one YAML table to .data with counts and metrics', async () => {
    const cwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-export-'));
    process.chdir(tmp);
    try {
        const metrics = new MetricsSink(path.join(tmp, 'import-metrics.jsonl'), 'run-test');
        const exporter = new YamlReportExporter(new FakeTallyTransport(tallyXml()), metrics, {
            syncMode: 'incremental',
            dbTechnology: 'postgres',
            loadMethod: 'copy'
        });

        const result = await exporter.exportTable('mst_sample', tableConfig);
        const data = fs.readFileSync(result.filePath, 'utf8');
        const events = fs.readFileSync(metrics.filePath, 'utf8').trim().split('\n').map(JSON.parse);

        assert.equal(data, 'guid\tname\r\ng1\tCash & Bank\r\ng2\tSales');
        assert.equal(result.rows, 2);
        assert.equal(result.bytes, Buffer.byteLength(data));
        assert.equal(events.some(event => event.phase == 'table_export' && event.success && event.rows == 2), true);
        assert.equal(events.some(event => event.phase == 'tally_http' && event.calls == 1), true);
    } finally {
        process.chdir(cwd);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('adding incremental filters does not mutate original YAML table config', () => {
    const cloned = withAdditionalFilters(tableConfig, ['$AlterID > 10']);

    assert.deepEqual(tableConfig.filters, ['BaseFilter']);
    assert.deepEqual(cloned.filters, ['BaseFilter', '$AlterID > 10']);
    assert.notEqual(cloned.filters, tableConfig.filters);
});

test('streaming exporter transform matches legacy transform output', () => {
    const xml = '<ENVELOPE>\r\n<F01>g1</F01><F02>A&amp;B</F02>\r\n<F01>g2</F01><F02>&lt;Done&gt;</F02></ENVELOPE>';
    assert.equal(processTdlOutputManipulation(xml), '\r\ng1\tA&B\r\ng2\t<Done>');
});

test('failed transport rethrows and records failure metrics', async () => {
    const cwd = process.cwd();
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tally-export-fail-'));
    process.chdir(tmp);
    try {
        const metrics = new MetricsSink(path.join(tmp, 'import-metrics.jsonl'), 'run-fail');
        const exporter = new YamlReportExporter(new FakeTallyTransport(() => {
            throw new Error('Tally offline');
        }), metrics);

        await assert.rejects(() => exporter.exportTable('mst_sample', tableConfig), /Tally offline/);
        const events = fs.readFileSync(metrics.filePath, 'utf8').trim().split('\n').map(JSON.parse);

        assert.equal(events.some(event => event.phase == 'tally_http' && event.success == false && event.error == 'Tally offline'), true);
        assert.equal(events.some(event => event.phase == 'table_export' && event.success == false), true);
    } finally {
        process.chdir(cwd);
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});

test('focused incremental export includes voucher inventory lines required for reconciliation', () => {
    const definition = yaml.load(fs.readFileSync('tally-export-config-focused-incremental.yaml', 'utf8'));
    const inventoryTable = definition.transaction.find(table => table.name == 'trn_inventory');

    assert.ok(inventoryTable, 'trn_inventory must be exported for Frappe voucher reconciliation');
    assert.equal(inventoryTable.collection, 'Voucher.AllInventoryEntries');
    assert.deepEqual(
        inventoryTable.fields.map(field => field.name),
        [
            'guid',
            'item',
            '_item',
            'quantity',
            'rate',
            'amount',
            'additional_amount',
            'discount_amount',
            'godown',
            '_godown',
            'tracking_number',
            'order_number',
            'order_duedate'
        ]
    );
});
