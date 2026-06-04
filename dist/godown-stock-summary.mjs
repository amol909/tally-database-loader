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
function buildStockSummaryRequest(config) {
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
function parseStockSummaryRows(xml) {
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
        rows.push({
            item: currentItem,
            godown: pendingGodown,
            closingQty: qty,
            uom,
            closingRate: parseNumeric(textBetween(token, 'DSPCLRATE')),
            closingValue: parseNumeric(textBetween(token, 'DSPCLAMTA'))
        });
        pendingGodown = '';
    }
    return rows;
}
export async function refreshGodownStockSummary(config) {
    if (database.config.technology != 'postgres') {
        logger.logMessage('Skipping godown stock summary refresh for %s database', database.config.technology);
        return 0;
    }
    logger.logMessage('Refreshing godown stock summary [%s]', new Date().toLocaleString());
    const transport = new HttpTallyTransport(config);
    const xml = await transport.post(buildStockSummaryRequest(config));
    const rows = parseStockSummaryRows(xml);
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
            imported_at timestamptz not null default now()
        )`);
        await client.query(`truncate table ${qualifiedTable}`);
        const batchSize = 500;
        for (let index = 0; index < rows.length; index += batchSize) {
            const batch = rows.slice(index, index + batchSize);
            const params = [];
            const values = batch.map((row, rowIndex) => {
                const offset = rowIndex * 6;
                params.push(row.item, row.godown, row.closingQty, row.uom, row.closingRate, row.closingValue);
                return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`;
            }).join(',');
            await client.query(`insert into ${qualifiedTable} (item, godown, closing_qty, uom, closing_rate, closing_value) values ${values}`, params);
        }
        await client.query('commit');
        logger.logMessage('  stock_godown_summary: imported %d rows', rows.length);
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
//# sourceMappingURL=godown-stock-summary.mjs.map