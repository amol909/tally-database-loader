import fs from 'fs';

const inputFile = process.argv[2] || './godown-summary-probe.xml';
const outputFile = process.argv[3] || './godown-summary.csv';
const godownNames = (process.argv[4] || 'A) SHOP|B) GODOWN')
    .split('|')
    .map(p => p.trim())
    .filter(Boolean);

function textBetween(block, tag) {
    const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
    return match ? match[1].trim() : '';
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
const blocks = [...xml.matchAll(/<DSPACCNAME>[\s\S]*?<\/DSPSTKINFO>/gi)].map(match => match[0]);
const rows = [];
let currentGodown = '';

for (const block of blocks) {
    const name = textBetween(block, 'DSPDISPNAME');
    const quantityText = textBetween(block, 'DSPCLQTY');
    const rateText = textBetween(block, 'DSPCLRATE');
    const amountText = textBetween(block, 'DSPCLAMTA');

    if (godownNames.includes(name)) {
        currentGodown = name;
        continue;
    }

    if (!currentGodown || !name) {
        continue;
    }

    const { qty, uom } = parseQuantity(quantityText);
    rows.push({
        godown: currentGodown,
        item: name,
        closing_qty: qty,
        uom,
        closing_rate: parseAmount(rateText),
        closing_value: parseAmount(amountText)
    });
}

const lines = [
    'godown,item,closing_qty,uom,closing_rate,closing_value',
    ...rows.map(row => [
        csv(row.godown),
        csv(row.item),
        row.closing_qty,
        csv(row.uom),
        row.closing_rate,
        row.closing_value
    ].join(','))
];

fs.writeFileSync(outputFile, lines.join('\r\n'), 'utf8');
console.log(`Wrote ${rows.length} rows to ${outputFile}`);
