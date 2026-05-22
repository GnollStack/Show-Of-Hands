import { readFile } from 'node:fs/promises';

import {
    DIAGNOSTIC_ACTION_METADATA,
    buildSmokeReport,
    makeSmokeCheck,
    validateCursorConfig
} from '../scripts/diagnostics-core.js';

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
        'diagnostics metadata declares no document creation',
        Object.values(DIAGNOSTIC_ACTION_METADATA).every(metadata => metadata.createsDocuments === false)
    )
]);

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.passed ? 0 : 1;
