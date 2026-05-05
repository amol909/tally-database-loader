import process from 'node:process';
import { loadConfig, validateConfig } from './config.mjs';
import { runSync } from './sync.mjs';
function parseCommandlineOptions(args) {
    const retval = new Map();
    for (let i = 2; i < args.length - 1; i += 2) {
        const argName = args[i];
        const argValue = args[i + 1];
        if (/^--\w+-\w+$/.test(argName)) {
            retval.set(argName.substring(2), argValue);
        }
    }
    return retval;
}
const config = loadConfig();
const errors = validateConfig(config);
if (errors.length) {
    throw new Error(`Config validation failed:\n${errors.map(p => `- ${p}`).join('\n')}`);
}
await runSync({
    config,
    overrides: parseCommandlineOptions(process.argv)
});
//# sourceMappingURL=index.mjs.map