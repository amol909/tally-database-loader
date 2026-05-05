import { appConfig, cloneConfig } from './config.mjs';
import { database } from './database.mjs';
import { logger } from './logger.mjs';
import { tally } from './tally.mjs';

export interface syncRunOptions {
    config: appConfig;
    overrides?: Map<string, string>;
    once?: boolean;
    frequency?: number;
}

let isSyncRunning = false;
let lastMasterAlterId = 0;
let lastTransactionAlterId = 0;

export function applyRuntimeConfig(config: appConfig, overrides = new Map<string, string>()): appConfig {
    const runtimeConfig = cloneConfig(config);
    database.config = runtimeConfig.database;
    tally.config = runtimeConfig.tally;

    database.updateCommandlineConfig(overrides);
    tally.updateCommandlineConfig(overrides);

    return {
        database: database.config,
        tally: tally.config
    };
}

export function getSyncModeLabel(frequency: number): string {
    return frequency > 0 ? `continuous sync every ${frequency} minute(s)` : 'one-time sync';
}

async function invokeImport(): Promise<void> {
    try {
        isSyncRunning = true;
        await tally.importData();
        logger.logMessage('Import completed successfully [%s]', new Date().toLocaleString());
    }
    catch (err) {
        logger.logMessage('Error in importing data\r\nPlease check error-log.txt file for detailed errors [%s]', new Date().toLocaleString());
        throw err;
    }
    finally {
        isSyncRunning = false;
    }
}

export async function runSync(options: syncRunOptions): Promise<void> {
    logger.startRun();
    const runtimeConfig = applyRuntimeConfig(options.config, options.overrides);

    if (options.once && options.frequency !== undefined) {
        throw new Error('Use either --once or --frequency, not both.');
    }
    if (options.once) {
        tally.config.frequency = 0;
    }
    if (options.frequency !== undefined) {
        if (!Number.isInteger(options.frequency) || options.frequency < 0) {
            throw new Error('--frequency must be a non-negative integer.');
        }
        tally.config.frequency = options.frequency;
    }

    runtimeConfig.tally.frequency = tally.config.frequency;

    if (tally.config.frequency <= 0) {
        await invokeImport();
        logger.closeStreams();
        return;
    }

    const triggerImport = async () => {
        try {
            if (!isSyncRunning) {
                await tally.updateLastAlterId();

                const isDataChanged = !(lastMasterAlterId == tally.lastAlterIdMaster && lastTransactionAlterId == tally.lastAlterIdTransaction);
                if (isDataChanged) {
                    lastMasterAlterId = tally.lastAlterIdMaster;
                    lastTransactionAlterId = tally.lastAlterIdTransaction;
                    await invokeImport();
                }
                else {
                    logger.logMessage('No change in Tally data found [%s]', new Date().toLocaleString());
                }
            }
        } catch (err) {
            if (typeof err == 'string' && err.endsWith('is closed in Tally')) {
                logger.logMessage(err + ' [%s]', new Date().toLocaleString());
            }
            else {
                throw err;
            }
        }
    };

    if (!tally.config.company) {
        logger.logMessage('Continuous sync requires Tally company name to be specified in config.json');
    }
    else {
        setInterval(async () => await triggerImport(), tally.config.frequency * 60000);
        await triggerImport();
    }
}

export async function testDatabaseConnection(config: appConfig): Promise<void> {
    logger.setConsoleEnabled(false);
    try {
        applyRuntimeConfig(config);
        await database.openConnectionPool();
        await database.closeConnectionPool();
    } finally {
        logger.setConsoleEnabled(true);
    }
}

export async function listTallyCompanies(config: appConfig) {
    logger.setConsoleEnabled(false);
    try {
        applyRuntimeConfig(config);
        return await tally.listCompanies();
    } finally {
        logger.setConsoleEnabled(true);
    }
}

export async function testTallyConnection(config: appConfig): Promise<void> {
    logger.setConsoleEnabled(false);
    try {
        applyRuntimeConfig(config);
        await tally.testConnection();
    } finally {
        logger.setConsoleEnabled(true);
    }
}
