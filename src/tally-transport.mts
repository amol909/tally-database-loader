import http from 'http';
import { tallyConfig } from './definition.mjs';
import { logger } from './logger.mjs';

export interface TallyTransport {
    post(xml: string): Promise<string>;
}

export class HttpTallyTransport implements TallyTransport {
    constructor(private readonly config: tallyConfig) { }

    post(msg: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            try {
                const req = http.request({
                    hostname: this.config.server,
                    port: this.config.port,
                    path: '',
                    method: 'POST',
                    headers: {
                        'Content-Length': Buffer.byteLength(msg, 'utf16le'),
                        'Content-Type': 'text/xml;charset=utf-16'
                    }
                },
                    (res) => {
                        let data = '';
                        res
                            .setEncoding('utf16le')
                            .on('data', (chunk) => {
                                data += chunk.toString() || '';
                            })
                            .on('end', () => {
                                resolve(data);
                            })
                            .on('error', (httpErr) => {
                                logger.logMessage('Unable to connect with Tally. Ensure tally XML port is enabled');
                                logger.logError('tally.postTallyXML()', httpErr['message'] || '');
                                reject(httpErr);
                            });
                    });
                req.on('error', (reqError) => {
                    logger.logMessage('Unable to connect with Tally. Ensure tally XML port is enabled');
                    logger.logError('tally.postTallyXML()', reqError['message'] || '');
                    reject(reqError);
                });
                req.setTimeout(180000, () => {
                    req.destroy(new Error('Tally request timed out'));
                });
                req.write(msg, 'utf16le');
                req.end();
            } catch (err) {
                logger.logError('tally.postTallyXML()', err);
                reject(err);
            }
        });
    }
}

export class FakeTallyTransport implements TallyTransport {
    calls: string[] = [];

    constructor(private readonly response: string | ((xml: string) => string | Promise<string>)) { }

    async post(xml: string): Promise<string> {
        this.calls.push(xml);
        if (typeof this.response === 'function') {
            return await this.response(xml);
        }
        return this.response;
    }
}
