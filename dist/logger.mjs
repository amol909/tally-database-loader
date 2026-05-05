import fs from 'node:fs';
import util from 'node:util';
import process from 'node:process';
import { utility } from './utility.mjs';
class _logger {
    streamMessage;
    streamError;
    flgErrorLogged = false;
    consoleEnabled = true;
    constructor() {
    }
    startRun() {
        this.closeStreams();
        this.flgErrorLogged = false;
        this.consoleEnabled = true;
        this.streamMessage = fs.createWriteStream('./import-log.txt', { encoding: 'utf-8' });
        this.streamError = fs.createWriteStream('./error-log.txt', { encoding: 'utf-8' });
    }
    setConsoleEnabled(enabled) {
        this.consoleEnabled = enabled;
    }
    ensureStreams() {
        if (!this.streamMessage || !this.streamError) {
            this.streamMessage = fs.createWriteStream('./import-log.txt', { encoding: 'utf-8', flags: 'a' });
            this.streamError = fs.createWriteStream('./error-log.txt', { encoding: 'utf-8', flags: 'a' });
        }
    }
    logMessage(message, ...params) {
        this.ensureStreams();
        if (this.consoleEnabled)
            console.log(message, ...params); //graphical console
        this.streamMessage?.write(util.format(message, ...params) + '\r\n');
        if (process.send) { // GUI thread based invoke
            process.send(util.format(message, ...params) + '\r\n');
        }
    }
    logError(fnInfo, err) {
        if (!this.flgErrorLogged) {
            this.ensureStreams();
            this.flgErrorLogged = true;
            let errorLog = '';
            if (!fnInfo.endsWith(')'))
                fnInfo += '()';
            errorLog += `Error from ${fnInfo} at ${utility.Date.format(new Date(), 'yyyy-MM-dd HH:mm:ss')}\r\n`;
            if (typeof err == 'string')
                errorLog += err + '\r\n';
            else {
                let props = Object.getOwnPropertyNames(err);
                for (let i = 0; i < props.length; i++) {
                    let propName = props[i];
                    let propValue = err[propName];
                    if (typeof propValue == 'string')
                        errorLog += propValue + '\r\n';
                }
            }
            errorLog += '-'.repeat(80) + '\r\n\r\n\r\n';
            if (this.consoleEnabled)
                console.error(errorLog); //graphical console
            this.streamError?.write(errorLog);
        }
    }
    closeStreams() {
        this.streamMessage?.close();
        this.streamError?.close();
        this.streamMessage = undefined;
        this.streamError = undefined;
    }
}
let logger = new _logger();
export { logger };
//# sourceMappingURL=logger.mjs.map