import fs from 'node:fs';
export const CONFIG_PATH = './config.json';
export const defaultConfig = {
    database: {
        technology: 'mssql',
        server: 'localhost',
        port: 0,
        ssl: false,
        schema: 'tallydb',
        username: '',
        password: '',
        loadmethod: 'file'
    },
    tally: {
        definition: 'tally-export-config.yaml',
        server: 'localhost',
        port: 9000,
        fromdate: 'auto',
        todate: 'auto',
        sync: 'full',
        batchsize: 5000,
        frequency: 0,
        company: ''
    }
};
export function cloneConfig(config) {
    return JSON.parse(JSON.stringify(config));
}
export function configExists() {
    return fs.existsSync(CONFIG_PATH);
}
export function loadConfig() {
    if (!configExists()) {
        throw new Error('config.json was not found. Run "tallydb config init" or "tallydb setup".');
    }
    const rawConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
        database: { ...defaultConfig.database, ...(rawConfig.database || {}) },
        tally: { ...defaultConfig.tally, ...(rawConfig.tally || {}) }
    };
}
export function saveConfig(config) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 4) + '\n', { encoding: 'utf8' });
}
export function maskConfig(config) {
    const masked = cloneConfig(config);
    if (masked.database.password) {
        masked.database.password = '********';
    }
    return masked;
}
export function validateConfig(config) {
    const errors = [];
    const dbTech = ['mssql', 'mysql', 'postgres', 'bigquery'];
    const syncModes = ['full', 'incremental'];
    const loadMethods = ['insert', 'file'];
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (!config.database)
        errors.push('Missing "database" section.');
    if (!config.tally)
        errors.push('Missing "tally" section.');
    if (errors.length)
        return errors;
    if (!dbTech.includes(config.database.technology.toLowerCase())) {
        errors.push(`database.technology must be one of: ${dbTech.join(', ')}.`);
    }
    if (!config.database.server)
        errors.push('database.server is required.');
    if (!Number.isInteger(config.database.port) || config.database.port < 0) {
        errors.push('database.port must be a non-negative integer.');
    }
    if (!config.database.schema)
        errors.push('database.schema is required.');
    if (typeof config.database.username !== 'string')
        errors.push('database.username must be a string.');
    if (typeof config.database.password !== 'string')
        errors.push('database.password must be a string.');
    if (!loadMethods.includes(config.database.loadmethod.toLowerCase())) {
        errors.push(`database.loadmethod must be one of: ${loadMethods.join(', ')}.`);
    }
    if (typeof config.database.ssl !== 'boolean')
        errors.push('database.ssl must be true or false.');
    if (!config.tally.definition)
        errors.push('tally.definition is required.');
    if (!config.tally.server)
        errors.push('tally.server is required.');
    if (!Number.isInteger(config.tally.port) || config.tally.port <= 0) {
        errors.push('tally.port must be a positive integer.');
    }
    for (const fieldName of ['fromdate', 'todate']) {
        const value = config.tally[fieldName];
        if (value !== 'auto' && !datePattern.test(value)) {
            errors.push(`tally.${fieldName} must be "auto" or YYYY-MM-DD.`);
        }
    }
    if (!syncModes.includes(config.tally.sync.toLowerCase())) {
        errors.push(`tally.sync must be one of: ${syncModes.join(', ')}.`);
    }
    if (!Number.isInteger(config.tally.batchsize) || config.tally.batchsize <= 0) {
        errors.push('tally.batchsize must be a positive integer.');
    }
    if (!Number.isInteger(config.tally.frequency) || config.tally.frequency < 0) {
        errors.push('tally.frequency must be a non-negative integer.');
    }
    if (typeof config.tally.company !== 'string')
        errors.push('tally.company must be a string.');
    return errors;
}
//# sourceMappingURL=config.mjs.map