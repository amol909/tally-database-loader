import fs from 'fs';
import http from 'http';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const tally = config.tally || {};
const outputFile = './stock-godown-item-probe.xml';
const itemName = process.argv.slice(2).join(' ') || '0.7MM CATCH LINER';

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function postTallyXML(payload) {
    return new Promise((resolve, reject) => {
        const req = http.request({
            hostname: tally.server || 'localhost',
            port: tally.port || 9000,
            path: '',
            method: 'POST',
            headers: {
                'Content-Length': Buffer.byteLength(payload, 'utf16le'),
                'Content-Type': 'text/xml;charset=utf-16'
            }
        }, res => {
            let data = '';
            res.setEncoding('utf16le');
            res.on('data', chunk => data += chunk.toString());
            res.on('end', () => resolve(data));
            res.on('error', reject);
        });

        req.on('error', reject);
        req.setTimeout(30000, () => req.destroy(new Error('Tally request timed out')));
        req.write(payload, 'utf16le');
        req.end();
    });
}

const companyXml = tally.company
    ? `<SVCURRENTCOMPANY>${escapeXml(tally.company)}</SVCURRENTCOMPANY>`
    : '';

const payload = `<?xml version="1.0" encoding="utf-8"?>
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
        ${companyXml}
        <StockItemName>${escapeXml(itemName)}</StockItemName>
        <SVStockItem>${escapeXml(itemName)}</SVStockItem>
        <DSPSHOWQTY>Yes</DSPSHOWQTY>
        <DSPSHOWRATE>Yes</DSPSHOWRATE>
        <DSPSHOWVALUE>Yes</DSPSHOWVALUE>
        <DSPSHOWCL>Yes</DSPSHOWCL>
        <EXPLODEFLAG>Yes</EXPLODEFLAG>
      </STATICVARIABLES>
    </DESC>
  </BODY>
</ENVELOPE>`;

try {
    const response = await postTallyXML(payload);
    fs.writeFileSync(outputFile, response, 'utf8');
    console.log(`Saved ${outputFile}`);
    console.log(response.slice(0, 1500));
} catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
}
