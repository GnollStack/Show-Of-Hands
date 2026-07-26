import { createHash } from 'node:crypto';
import { access, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

import {
    EXPECTED_MODULE_ID,
    RELEASE_PAYLOAD_PATHS,
    getExpectedReleaseTag,
    validateReleaseContract
} from './release-contract.mjs';

function parseArguments(argv) {
    const result = {
        ref: 'HEAD',
        output: `dist/${EXPECTED_MODULE_ID}.zip`
    };
    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];
        if (argument === '--ref' || argument === '--output') {
            const value = argv[index + 1];
            if (!value) throw new Error(`${argument} requires a value.`);
            result[argument.slice(2)] = value;
            index += 1;
            continue;
        }
        throw new Error(`Unknown argument: ${argument}`);
    }
    return result;
}

function runGit(args, { cwd, encoding = 'utf8' } = {}) {
    const result = spawnSync('git', args, { cwd, encoding });
    if (result.error || result.status !== 0) {
        const detail = result.error?.message || String(result.stderr ?? '').trim() || `exit status ${result.status}`;
        throw new Error(`git ${args[0]} failed: ${detail}`);
    }
    return result.stdout;
}

function readJsonAtRef(root, ref, path) {
    const source = runGit(['show', `${ref}:${path}`], { cwd: root });
    try {
        return JSON.parse(source);
    } catch (error) {
        throw new Error(`${path} at ${ref} is not valid JSON: ${error.message}`);
    }
}

function resolveOptionalCommit(root, ref) {
    const result = spawnSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], {
        cwd: root,
        encoding: 'utf8'
    });
    if (result.error) throw new Error(`git rev-parse failed: ${result.error.message}`);
    if (result.status === 0) return String(result.stdout).trim();
    if (result.status === 1) return null;
    throw new Error(`git rev-parse failed: ${String(result.stderr ?? '').trim() || `exit status ${result.status}`}`);
}

async function assertOutputDoesNotExist(outputPath) {
    try {
        await access(outputPath);
    } catch (error) {
        if (error?.code === 'ENOENT') return;
        throw error;
    }
    throw new Error(`Refusing to overwrite existing release archive: ${outputPath}`);
}

async function main() {
    const { ref, output } = parseArguments(process.argv.slice(2));
    const root = String(runGit(['rev-parse', '--show-toplevel'])).trim();
    const commit = String(runGit(['rev-parse', `${ref}^{commit}`], { cwd: root })).trim();
    const manifest = readJsonAtRef(root, ref, 'module.json');
    const packageJson = readJsonAtRef(root, ref, 'package.json');
    const readme = String(runGit(['show', `${ref}:README.md`], { cwd: root }));
    const existingReleaseTagCommit = resolveOptionalCommit(root, `refs/tags/${getExpectedReleaseTag(manifest.version)}`);
    const errors = validateReleaseContract({
        manifest,
        packageJson,
        readme,
        currentCommit: commit,
        existingReleaseTagCommit
    });
    if (errors.length) throw new Error(`Release contract failed:\n- ${errors.join('\n- ')}`);

    const outputPath = resolve(root, output);
    await assertOutputDoesNotExist(outputPath);
    await mkdir(dirname(outputPath), { recursive: true });
    runGit([
        'archive',
        '--format=zip',
        `--output=${outputPath}`,
        ref,
        '--',
        ...RELEASE_PAYLOAD_PATHS
    ], { cwd: root });

    const archive = await readFile(outputPath);
    const sha256 = createHash('sha256').update(archive).digest('hex');
    console.log(JSON.stringify({
        success: true,
        ref,
        commit,
        output: outputPath,
        bytes: archive.byteLength,
        sha256
    }, null, 2));
}

main().catch(error => {
    console.error(error?.stack ?? error);
    process.exitCode = 1;
});
