import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import { test } from 'node:test';

import {
    EXPECTED_MODULE_ID,
    RELEASE_PAYLOAD_PATHS,
    getManifestRuntimePaths,
    getExpectedReleaseTag,
    isPathIncludedInRelease,
    isSafeRepositoryPath,
    validateReleaseContract
} from '../tools/release-contract.mjs';

const manifest = JSON.parse(await readFile('module.json', 'utf8'));
const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
const readme = await readFile('README.md', 'utf8');
const checksWorkflow = await readFile('.github/workflows/checks.yml', 'utf8');

test('release metadata is internally consistent', () => {
    const ciTag = process.env.GITHUB_REF_TYPE === 'tag' ? process.env.GITHUB_REF_NAME : null;
    assert.deepEqual(validateReleaseContract({ manifest, packageJson, readme, ciTag }), []);
    assert.equal(manifest.id, EXPECTED_MODULE_ID);
});

test('manifest runtime paths are safe, present, and included in the archive', async () => {
    for (const path of getManifestRuntimePaths(manifest)) {
        assert.equal(isSafeRepositoryPath(path), true, `unsafe runtime path: ${path}`);
        assert.equal(isPathIncludedInRelease(path), true, `runtime path excluded from archive: ${path}`);
        await access(path);
    }
});

test('release payload allowlist is exact, safe, and present', async () => {
    assert.deepEqual(RELEASE_PAYLOAD_PATHS, [
        'LICENSE.txt',
        'README.md',
        'module.json',
        'scripts',
        'styles',
        'templates'
    ]);
    for (const path of RELEASE_PAYLOAD_PATHS) {
        assert.equal(isSafeRepositoryPath(path), true, `unsafe payload path: ${path}`);
        await access(path);
    }
    for (const excluded of ['LLM-Instructions', 'tests', 'tools', '.git', '.github', 'package.json']) {
        assert.equal(isPathIncludedInRelease(excluded), false, `private/development path leaked: ${excluded}`);
    }
});

test('release contract refuses to reuse an immutable version tag for another commit', () => {
    const errors = validateReleaseContract({
        manifest,
        packageJson,
        readme,
        currentCommit: 'new-commit',
        existingReleaseTagCommit: 'released-commit'
    });
    assert.ok(errors.some(error => error.includes(`${getExpectedReleaseTag(manifest.version)} already points`)));
});

test('CI fetches full tag history before checking immutable release tags', () => {
    assert.match(checksWorkflow, /actions\/checkout@v4[\s\S]*?fetch-depth:\s*0/);
    assert.match(checksWorkflow, /actions\/checkout@v4[\s\S]*?fetch-tags:\s*true/);
});
