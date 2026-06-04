import fs from 'fs';
import http from 'http';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'));
const tally = config.tally || {};

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

function envelope(reportName, staticVariables, reportSet = '') {
    const companyXml = tally.company
        ? `<SVCURRENTCOMPANY>${escapeXml(tally.company)}</SVCURRENTCOMPANY>`
        : '';
    const tdlXml = reportSet
        ? `<TDL><TDLMESSAGE><REPORT NAME="${reportName}" ISMODIFY="Yes"><SET>${reportSet}</SET></REPORT></TDLMESSAGE></TDL>`
        : '';

    return `<?xml version="1.0" encoding="utf-8"?>
<ENVELOPE>
  <HEADER>
    <VERSION>1</VERSION>
    <TALLYREQUEST>Export</TALLYREQUEST>
    <TYPE>Data</TYPE>
    <ID>${reportName}</ID>
  </HEADER>
  <BODY>
    <DESC>
      <STATICVARIABLES>
        <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
        <EXPLODEFLAG>Yes</EXPLODEFLAG>
        ${companyXml}
        ${staticVariables}
      </STATICVARIABLES>
      ${tdlXml}
    </DESC>
  </BODY>
</ENVELOPE>`;
}

const variants = [
    {
        name: 'godown-summary-isitemwise-static',
        xml: envelope('Godown Summary', '<ISITEMWISE>Yes</ISITEMWISE>')
    },
    {
        name: 'godown-summary-isitemwise-report-set',
        xml: envelope('Godown Summary', '', 'IsItemWise: Yes')
    },
    {
        name: 'godown-summary-godown-primary-itemwise',
        xml: envelope('Godown Summary', '<SVGODOWNNAME>Primary</SVGODOWNNAME><ISITEMWISE>Yes</ISITEMWISE>')
    },
    {
        name: 'stock-summary-itemwise',
        xml: envelope('Stock Summary', '<ISITEMWISE>Yes</ISITEMWISE>')
    },
    {
        name: 'stock-summary-itemwise-report-set',
        xml: envelope('Stock Summary', '', 'IsItemWise: Yes')
    },
    {
        name: 'stock-summary-godown-shop-itemwise',
        xml: envelope('Stock Summary', '<SVGODOWNNAME>A) SHOP</SVGODOWNNAME><ISITEMWISE>Yes</ISITEMWISE>')
    },
    {
        name: 'stock-summary-godown-godown-itemwise',
        xml: envelope('Stock Summary', '<SVGODOWNNAME>B) GODOWN</SVGODOWNNAME><ISITEMWISE>Yes</ISITEMWISE>')
    }
];

for (const variant of variants) {
    const outputFile = `./${variant.name}.xml`;
    try {
        const response = await postTallyXML(variant.xml);
        fs.writeFileSync(outputFile, response, 'utf8');
        const sample = response.replace(/\s+/g, ' ').slice(0, 300);
        console.log(`${variant.name}: saved ${outputFile} (${response.length} chars) ${sample}`);
    } catch (err) {
        console.log(`${variant.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
}
