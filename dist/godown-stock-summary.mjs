import { database } from './database.mjs';
import { logger } from './logger.mjs';
import { HttpTallyTransport } from './tally-transport.mjs';
function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function decodeXml(value) {
    return String(value ?? '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}
function textBetween(block, tag) {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    return match ? decodeXml(match[1].trim()) : '';
}
function parseNumeric(value) {
    if (!value)
        return null;
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
export function buildStockSummaryRequest(config) {
    const companyXml = config.company
        ? `<SVCURRENTCOMPANY>${escapeXml(config.company)}</SVCURRENTCOMPANY>`
        : '';
    return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Stock Summary</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <EXPLODEFLAG>Yes</EXPLODEFLAG>
        <ISITEMWISE>Yes</ISITEMWISE>
        ${companyXml}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}
export function buildGodownSummaryRequest(config) {
    const companyXml = config.company
        ? `<SVCURRENTCOMPANY>${escapeXml(config.company)}</SVCURRENTCOMPANY>`
        : '';
    return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>Godown Summary</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <EXPLODEFLAG>Yes</EXPLODEFLAG>
        ${companyXml}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}
export function buildGodownStockSnapshotRequest(config) {
    const companyXml = config.company
        ? `<SVCURRENTCOMPANY>${escapeXml(config.company)}</SVCURRENTCOMPANY>`
        : '';
    return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>DB Godown Stock Snapshot</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <EXPLODEFLAG>Yes</EXPLODEFLAG>
        ${companyXml}
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;
}
function readStockInfoRow(item, godown, stockInfo) {
    const { qty, uom } = parseQuantity(textBetween(stockInfo, 'DSPCLQTY'));
    return {
        item,
        godown,
        closingQty: qty,
        uom,
        closingRate: parseNumeric(textBetween(stockInfo, 'DSPCLRATE')),
        closingValue: parseNumeric(textBetween(stockInfo, 'DSPCLAMTA'))
    };
}
export function parseStockSummaryRows(xml) {
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
            for (const stockInfo of token.matchAll(/<DSPSTKINFO>[\s\S]*?<\/DSPSTKINFO>/gi)) {
                if (currentItem && pendingGodown) {
                    rows.push(readStockInfoRow(currentItem, pendingGodown, stockInfo[0]));
                }
            }
            if (/<DSPSTKINFO>/i.test(token)) {
                pendingGodown = '';
            }
            continue;
        }
        if (!/^<DSPSTKINFO>/i.test(token) || !currentItem || !pendingGodown) {
            continue;
        }
        rows.push(readStockInfoRow(currentItem, pendingGodown, token));
        pendingGodown = '';
    }
    return rows;
}
export function parseGodownSummaryRows(xml, godownNames) {
    const knownGodowns = new Set(godownNames.map(name => name.trim()).filter(Boolean));
    const blocks = [...xml.matchAll(/<DSPACCNAME>[\s\S]*?<\/DSPSTKINFO>/gi)]
        .map(match => match[0]);
    const rows = [];
    let currentGodown = '';
    for (const block of blocks) {
        const name = textBetween(block, 'DSPDISPNAME');
        if (knownGodowns.has(name)) {
            currentGodown = name;
            continue;
        }
        if (!currentGodown || !name) {
            continue;
        }
        rows.push(readStockInfoRow(name, currentGodown, block));
    }
    return rows;
}
export function parseGodownStockSnapshotRows(xml) {
    const blocks = [...xml.matchAll(/<rowType>[\s\S]*?(?=<rowType>|<\/ENVELOPE>)/gi)]
        .map(match => match[0]);
    const rows = [];
    for (const block of blocks) {
        const rowType = textBetween(block, 'rowType');
        if (rowType != 'GODOWN') {
            continue;
        }
        const item = textBetween(block, 'stockItem');
        const godown = textBetween(block, 'godown');
        const { qty, uom } = parseQuantity(textBetween(block, 'closingQty'));
        if (!item || !godown || !qty || Number(qty) == 0) {
            continue;
        }
        rows.push({
            rowType,
            stockGroup: textBetween(block, 'stockGroup'),
            item,
            batchName: textBetween(block, 'batchName'),
            godown,
            closingQty: qty,
            uom: textBetween(block, 'uom') || uom,
            closingRate: parseNumeric(textBetween(block, 'closingRate')),
            closingValue: parseNumeric(textBetween(block, 'closingValue'))
        });
    }
    return rows;
}
export async function replaceGodownStockSummaryRows(rows) {
    const qualifiedTable = `${ident('public')}.${ident('stock_godown_summary')}`;
    await database.openConnectionPool();
    const client = await database.connectionPoolPostgres.connect();
    try {
        await client.query('begin');
        await client.query(`create table if not exists ${qualifiedTable} (
            item text not null,
            godown text not null,
            closing_qty numeric null,
            uom text null,
            closing_rate numeric null,
            closing_value numeric null,
            stock_group text null,
            batch_name text null,
            row_type text not null default 'GODOWN',
            imported_at timestamptz not null default now()
        )`);
        await client.query(`alter table ${qualifiedTable} add column if not exists stock_group text null`);
        await client.query(`alter table ${qualifiedTable} add column if not exists batch_name text null`);
        await client.query(`alter table ${qualifiedTable} add column if not exists row_type text not null default 'GODOWN'`);
        await client.query(`truncate table ${qualifiedTable}`);
        const batchSize = 500;
        for (let index = 0; index < rows.length; index += batchSize) {
            const batch = rows.slice(index, index + batchSize);
            const params = [];
            const values = batch.map((row, rowIndex) => {
                const offset = rowIndex * 9;
                params.push(row.item, row.godown, row.closingQty, row.uom, row.closingRate, row.closingValue, row.stockGroup, row.batchName, row.rowType);
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
            }).join(',');
            await client.query(`insert into ${qualifiedTable} (item, godown, closing_qty, uom, closing_rate, closing_value, stock_group, batch_name, row_type) values ${values}`, params);
        }
        await client.query('commit');
        return rows.length;
    }
    catch (err) {
        await client.query('rollback');
        throw err;
    }
    finally {
        client.release();
        await database.closeConnectionPool();
    }
}
export async function refreshGodownStockSummary(config) {
    if (database.config.technology != 'postgres') {
        logger.logMessage('Skipping godown stock summary refresh for %s database', database.config.technology);
        return 0;
    }
    logger.logMessage('Refreshing godown stock summary [%s]', new Date().toLocaleString());
    const transport = new HttpTallyTransport(config);
    const xml = await transport.post(buildGodownStockSnapshotRequest(config));
    const rows = parseGodownStockSnapshotRows(xml);
    const rowCount = await replaceGodownStockSummaryRows(rows);
    logger.logMessage('  stock_godown_summary: imported %d rows', rowCount);
    return rowCount;
}
//# sourceMappingURL=godown-stock-summary.mjs.map