import { readFile } from 'node:fs/promises';

import {
    DIAGNOSTIC_ACTION_METADATA,
    READ_ONLY_DIAGNOSTIC_ACTION_NAMES,
    buildSmokeReport,
    makeSmokeCheck,
    runCoreSelfChecks,
    validateCursorConfig
} from '../scripts/diagnostics-core.js';
import { canBroadcastVisibleCursor } from '../scripts/foundry-permissions.js';

async function readFixture(name) {
    const text = await readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
    return JSON.parse(text);
}

const validFixture = await readFixture('cursor-profile.valid.json');
const invalidFixture = await readFixture('cursor-profile.invalid.json');

const report = buildSmokeReport([
    makeSmokeCheck('valid cursor profile fixture parses and validates', validateCursorConfig(validFixture)),
    makeSmokeCheck('bad cursor profile fixture is rejected', !validateCursorConfig(invalidFixture).valid),
    makeSmokeCheck(
        'read-only diagnostics metadata declares no document creation',
        READ_ONLY_DIAGNOSTIC_ACTION_NAMES.every(name => DIAGNOSTIC_ACTION_METADATA[name]?.createsDocuments === false)
    ),
    makeSmokeCheck('SHOW_CURSOR helper defaults to allowed without Foundry permission API', canBroadcastVisibleCursor({})),
    ...runCoreSelfChecks()
]);

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
