import process from 'process';
import { logger } from './logger.mjs';

/**
 * Each flag removes one Tally-side activity from a sync run, so a crash can be bisected against a
 * progressively smaller workload without a rebuild between attempts.
 *
 * These are diagnostics, not configuration. A run with any flag set is not a correct sync: rows go
 * missing, deletes go undetected, or derived tables go stale. The AlterID checkpoint is therefore
 * held back whenever any flag is set (see `isSyncStripped`), so a stripped run never marks work as
 * done that it did not do.
 */
const flagEnvNames = {
    skipPeriod: 'TALLY_SKIP_PERIOD',
    skipDiff: 'TALLY_SKIP_DIFF',
    skipMasters: 'TALLY_SKIP_MASTERS',
    skipTransactions: 'TALLY_SKIP_TRANSACTIONS',
    skipVoucherNumber: 'TALLY_SKIP_VCHNUMBER',
    skipVoucherInventory: 'TALLY_SKIP_VOUCHER_INVENTORY',
    skipGodownStock: 'TALLY_SKIP_GODOWN_STOCK'
} as const;

export type diagnosticFlag = keyof typeof flagEnvNames;

const flagDescriptions: Record<diagnosticFlag, string> = {
    skipPeriod: 'SVFROMDATE/SVTODATE omitted - reports run unscoped instead of across the full books period',
    skipDiff: 'delete-detection _diff scans skipped - rows deleted inside Tally stay in the database, everything else syncs normally',
    skipMasters: 'master table exports skipped - master rows will not be refreshed',
    skipTransactions: 'transaction table exports skipped - voucher rows will not be refreshed',
    skipVoucherNumber: '_vchnumber walk skipped - auto-numbered voucher numbers will go stale',
    skipVoucherInventory: 'voucher inventory custom TDL skipped - trn_inventory will not be rebuilt',
    skipGodownStock: 'godown stock snapshot custom TDL skipped - stock_godown_summary will go stale'
};

export function isSkipEnabled(flag: diagnosticFlag): boolean {
    //trimmed because `set VAR=1 && cmd` on Windows puts the space before && into the value, which
    //would silently leave the flag off and make the run look like a test when it is a normal sync
    return /^(1|true|yes)$/i.test((process.env[flagEnvNames[flag]] || '').trim());
}

/**
 * Restricts delete detection to the named primary tables, so a single collection's _diff scan can
 * be issued in isolation, or a prefix of the normal nine-scan sequence replayed. That separates a
 * request that is expensive on its own from one that only becomes expensive after Tally has served
 * the scans that precede it. Unset means the normal full sequence.
 */
export function diffTableAllowList(): string[] | null {
    const names = (process.env['TALLY_DIFF_TABLES'] || '')
        .split(',')
        .map(name => name.trim().toLowerCase())
        .filter(name => name.length > 0);
    return names.length ? names : null;
}

export function activeDiagnosticFlags(): diagnosticFlag[] {
    return (Object.keys(flagEnvNames) as diagnosticFlag[]).filter(isSkipEnabled);
}

/**
 * True when the run deliberately did less work than a real sync, which makes advancing the AlterID
 * checkpoint unsafe: Tally would be told those changes are imported when they were never fetched.
 *
 * skipPeriod and skipDiff are excluded because neither loses imported rows. skipPeriod only widens
 * the reporting period. skipDiff drops delete detection, which for a profile with no cascade_delete
 * costs only the removal of rows deleted inside Tally - every row that still exists is imported,
 * and deleteRowsMatchingCsvGuid already clears modified rows before bulk load. Holding the
 * checkpoint back for those would force a full re-import of data that was correctly fetched.
 *
 * The tradeoff is real and one-way: rows deleted in Tally stay in the database until a run that
 * does scan for them.
 */
const flagsThatKeepTheCheckpoint: diagnosticFlag[] = ['skipPeriod', 'skipDiff'];

export function isSyncStripped(): boolean {
    return activeDiagnosticFlags().some(flag => !flagsThatKeepTheCheckpoint.includes(flag))
        || diffTableAllowList() != null;
}

export function logActiveDiagnosticFlags(): void {
    const active = activeDiagnosticFlags();
    const diffTables = diffTableAllowList();
    if (!active.length && !diffTables) {
        //stated rather than silent: an unset flag looks exactly like a normal run in the log, so a
        //bisect attempt whose variables never reached the process would otherwise read as a result
        logger.logMessage('No diagnostic flags set - all sync phases enabled.');
        return;
    }

    logger.logMessage('DIAGNOSTIC RUN - this is not a complete sync:');
    for (const flag of active) {
        logger.logMessage('  %s: %s', flagEnvNames[flag], flagDescriptions[flag]);
    }
    if (diffTables) {
        logger.logMessage('  TALLY_DIFF_TABLES: delete detection limited to %s - other tables keep stale deletions', diffTables.join(', '));
    }
    if (isSyncStripped()) {
        logger.logMessage('  AlterID checkpoint will NOT be advanced, so the next full run re-imports everything.');
    }
}
