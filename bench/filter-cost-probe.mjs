/**
 * The loader's own request takes over 15 min; a TYPE=Collection request over the same collection,
 * same filters, returned 3,326 rows in 19 s. Removing every cross-object field lookup from the
 * loader's request changed nothing, so the cost is not the fields, the filters or the data - it is
 * the shape of the request.
 *
 * One concrete difference: generateXMLfromYAML emits "<SVEXPORTFORMAT>XML</SVEXPORTFORMAT>", while
 * every fast probe sent "$$SysName:XML". A bare "XML" may not resolve to the export-format constant
 * at all, leaving Tally rendering through a display path rather than the data path.
 *
 * Variant 1 is the loader's request verbatim. Variant 2 changes only that one token. Variant 3 is
 * the known-fast collection export, as a check that Tally is warm and behaving as it did earlier -
 * without it, a slow result cannot be distinguished from a cold cache.
 *
 * Cap is deliberately short: anything still running at 3 minutes has already lost.
 *
 * Usage: node bench/filter-cost-probe.mjs [alterId]
 */
import fs from 'fs';
import http from 'http';
import yaml from 'js-yaml';
import { generateXMLfromYAML, withAdditionalFilters } from '../dist/yaml-report-exporter.mjs';

const server = process.env['TALLY_SERVER'] || 'localhost';
const port = parseInt(process.env['TALLY_PORT'] || '9000', 10);
const sinceAlterId = process.argv[2] || '1840000';

const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))['tally'];
const definition = yaml.load(fs.readFileSync(`./${config.definition}`, 'utf-8'));
const tables = [...(definition['master'] || []), ...(definition['transaction'] || [])];
const voucher = tables.find(table => table.name === 'trn_voucher');
if (!voucher) { console.log('trn_voucher not found in ' + config.definition); process.exit(1); }

function loaderXml() {
    return generateXMLfromYAML(withAdditionalFilters(voucher, [`$AlterId > ${sinceAlterId}`]))
        .replace('{fromDate}', '20240401')
        .replace('{toDate}', '20260903')
        .replace('<SVCURRENTCOMPANY>{targetCompany}</SVCURRENTCOMPANY>', '');
}

function esc(text) { return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

//the shape every fast probe used, with the production filters
function collectionXml() {
    const all = [`$AlterId > ${sinceAlterId}`, ...(voucher.filters || [])];
    return `<ENVELOPE>
 <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>CtlProbe</ID></HEADER>
 <BODY><DESC>
  <STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT><SVFROMDATE>20240401</SVFROMDATE><SVTODATE>20260903</SVTODATE></STATICVARIABLES>
  <TDL><TDLMESSAGE>
   <COLLECTION NAME="CtlProbe" ISMODIFY="No">
    <TYPE>Voucher</TYPE>
    <FETCH>Guid,AlterId,Date,VoucherTypeName,VoucherNumber</FETCH>
    ${all.map((_, i) => `<FILTER>CF${i}</FILTER>`).join('')}
   </COLLECTION>
   ${all.map((expr, i) => `<SYSTEM TYPE="Formulae" NAME="CF${i}">${esc(expr)}</SYSTEM>`).join('')}
  </TDLMESSAGE></TDL>
 </DESC></BODY>
</ENVELOPE>`;
}

const variants = [
    { name: 'loader request, as-is', xml: loaderXml() },
    { name: 'loader + $$SysName:XML', xml: loaderXml().replace('<SVEXPORTFORMAT>XML</SVEXPORTFORMAT>', '<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>') },
    { name: 'collection export (ctl)', xml: collectionXml() }
];

const CAP_MS = 180000;

function post(xml) {
    return new Promise(resolve => {
        const startedAt = Date.now();
        let firstByteAt = 0;
        const chunks = [];
        const request = http.request({
            hostname: server, port: port, method: 'POST', path: '',
            headers: { 'Content-Type': 'text/xml;charset=utf-16' }
        }, response => {
            response.on('data', chunk => { if (!firstByteAt) firstByteAt = Date.now(); chunks.push(chunk); });
            response.on('end', () => {
                clearTimeout(cap);
                const buffer = Buffer.concat(chunks);
                resolve({ bytes: buffer.length, ttfb: firstByteAt - startedAt,
                          lines: (buffer.toString('utf16le').match(/\r?\n/g) || []).length });
            });
        });
        const cap = setTimeout(() => { request.destroy(); resolve({ error: `over ${CAP_MS / 1000}s` }); }, CAP_MS);
        request.on('error', err => { clearTimeout(cap); resolve({ error: err.message }); });
        request.end(Buffer.from(xml, 'utf16le'));
    });
}

console.log(`trn_voucher, AlterId > ${sinceAlterId}, cap ${CAP_MS / 1000}s\n`);
console.log('variant                     ttfb        bytes     lines');
console.log('-----------------------------------------------------------');

for (const variant of variants) {
    const result = await post(variant.xml);
    if (result.error) { console.log(`${variant.name.padEnd(24)} ${result.error}`); continue; }
    console.log(`${variant.name.padEnd(24)} ${(result.ttfb / 1000).toFixed(1) + 's'} ${String(result.bytes).padStart(11)} ${String(result.lines).padStart(9)}`);
}

console.log('\nrow 2 fast, row 1 slow  => SVEXPORTFORMAT is the bug, and it is a one-line fix.');
console.log('rows 1 and 2 both slow, row 3 fast => the REPORT/PART/LINE shape is the cost, not the token.');
console.log('row 3 also slow => Tally is cold or loaded right now; rerun when it is idle.');
