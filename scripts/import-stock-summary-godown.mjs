import fs from 'fs';
import postgres from 'pg';

const inputFile = process.argv[2] || './stock-summary-itemwise.xml';
const tableName = process.argv[3] || 'stock_godown_summary';
const tableSchema = process.argv[4] || 'public';
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));

function textBetween(block, tag) {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    return match ? decodeXml(match[1].trim()) : '';
}

function decodeXml(value) {
    return String(value ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

function parseNumeric(value) {
    if (!value) return null;
    const normalized = String(value).replace(/,/g, '').trim();
    return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : null;
}

function parseQuantity(value) {
    const match = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec((value || '').replace(/,/g, '').trim());
    return {
        qty: match ? match[1] : null,
        uom: match ? match[2].trim() : ''
    };
}

function ident(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

function parseRows(xml) {
    const tokens = [...xml.matchAll(/<DSPACCNAME>[\s\S]*?<\/DSPACCNAME>|<SSBATCHNAME>[\s\S]*?<\/SSBATCHNAME>|<DSPSTKINFO>[\s\S]*?<\/DSPSTKINFO>/gi)]
        .map(match => match[0]);
    const rows = [];
    let currentItem = '';
    let pendingGodown = '';

    for (const token of tokens) {
        if (/^<DSPACCNAME>/i.test(token)) {
            currentItem = textBetween(token, 'DSPDISPNAME');
            pendingGodown = '';
            continue;
        }

        if (/^<SSBATCHNAME>/i.test(token)) {
            pendingGodown = textBetween(token, 'SSGODOWN');
            continue;
        }

        if (!/^<DSPSTKINFO>/i.test(token) || !currentItem || !pendingGodown) {
            continue;
        }

        const { qty, uom } = parseQuantity(textBetween(token, 'DSPCLQTY'));
        rows.push([
            currentItem,
            pendingGodown,
            qty,
            uom,
            parseNumeric(textBetween(token, 'DSPCLRATE')),
            parseNumeric(textBetween(token, 'DSPCLAMTA'))
        ]);
        pendingGodown = '';
    }

    return rows;
}

const rows = parseRows(fs.readFileSync(inputFile, 'utf8'));
const schema = tableSchema;
const qualifiedTable = `${ident(schema)}.${ident(tableName)}`;
const pool = new postgres.Pool({
    host: config.database.server,
    port: config.database.port,
    user: config.database.username,
    password: config.database.password,
    database: config.database.schema,
    ssl: config.database.ssl ? { rejectUnauthorized: false } : false
});

const client = await pool.connect();
try {
    await client.query('begin');
    await client.query(`create table if not exists ${qualifiedTable} (
        item text not null,
        godown text not null,
        closing_qty numeric null,
        uom text null,
        closing_rate numeric null,
        closing_value numeric null,
        imported_at timestamptz not null default now()
    )`);
    await client.query(`truncate table ${qualifiedTable}`);

    const batchSize = 500;
    for (let index = 0; index < rows.length; index += batchSize) {
        const batch = rows.slice(index, index + batchSize);
        const params = [];
        const values = batch.map((row, rowIndex) => {
            const offset = rowIndex * 6;
            params.push(...row);
            return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
        }).join(',');
        await client.query(
            `insert into ${qualifiedTable} (item, godown, closing_qty, uom, closing_rate, closing_value) values ${values}`,
            params
        );
    }

    await client.query('commit');
    console.log(`Imported ${rows.length} rows into ${schema}.${tableName}`);
} catch (err) {
    await client.query('rollback');
    throw err;
} finally {
    client.release();
    await pool.end();
}
