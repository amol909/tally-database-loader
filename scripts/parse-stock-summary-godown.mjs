import fs from 'fs';

const inputFile = process.argv[2] || './stock-summary-itemwise.xml';
const outputFile = process.argv[3] || './stock-summary-godown.csv';
const itemFilter = (process.argv[4] || '').trim().toLowerCase();

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

function parseAmount(value) {
    if (!value) return '';
    const normalized = value.replace(/,/g, '').trim();
    return /^-?\d+(\.\d+)?$/.test(normalized) ? normalized : '';
}

function parseQuantity(value) {
    const match = /^(-?\d+(?:\.\d+)?)\s*(.*)$/.exec((value || '').replace(/,/g, '').trim());
    return {
        qty: match ? match[1] : '',
        uom: match ? match[2].trim() : ''
    };
}

function csv(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

const xml = fs.readFileSync(inputFile, 'utf8');
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

    if (itemFilter && !currentItem.toLowerCase().includes(itemFilter)) {
        pendingGodown = '';
        continue;
    }

    const { qty, uom } = parseQuantity(textBetween(token, 'DSPCLQTY'));
    rows.push({
        item: currentItem,
        godown: pendingGodown,
        closing_qty: qty,
        uom,
        closing_rate: parseAmount(textBetween(token, 'DSPCLRATE')),
        closing_value: parseAmount(textBetween(token, 'DSPCLAMTA'))
    });
    pendingGodown = '';
}

const lines = [
    'item,godown,closing_qty,uom,closing_rate,closing_value',
    ...rows.map(row => [
        csv(row.item),
        csv(row.godown),
        row.closing_qty,
        csv(row.uom),
        row.closing_rate,
        row.closing_value
    ].join(','))
];

fs.writeFileSync(outputFile, lines.join('\r\n'), 'utf8');
console.log(`Wrote ${rows.length} rows to ${outputFile}`);
