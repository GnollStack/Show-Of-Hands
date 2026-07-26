import { posix } from 'node:path';

export const EXPECTED_MODULE_ID = 'show-of-hands';

export const RELEASE_PAYLOAD_PATHS = Object.freeze([
    'LICENSE.txt',
    'README.md',
    'module.json',
    'scripts',
    'styles',
    'templates'
]);

export function getManifestPath(entry) {
    if (typeof entry === 'string') return entry;
    if (entry && typeof entry === 'object' && typeof entry.src === 'string') return entry.src;
    return null;
}

export function isSafeRepositoryPath(value) {
    if (typeof value !== 'string' || value.length === 0) return false;
    if (value.includes('\\') || value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false;
    const normalized = posix.normalize(value);
    return normalized === value && normalized !== '..' && !normalized.startsWith('../');
}

export function isPathIncludedInRelease(value) {
    if (!isSafeRepositoryPath(value)) return false;
    return RELEASE_PAYLOAD_PATHS.some(root => value === root || value.startsWith(`${root}/`));
}

export function getManifestRuntimePaths(manifest = {}) {
    return [...(manifest.esmodules ?? []), ...(manifest.scripts ?? []), ...(manifest.styles ?? [])]
        .map(getManifestPath);
}

export function getExpectedReleaseTag(version) {
    return `V${version}`;
}

export function validateReleaseContract({
    manifest,
    packageJson,
    readme,
    ciTag = null,
    currentCommit = null,
    existingReleaseTagCommit = null
} = {}) {
    const errors = [];
    const version = manifest?.version;
    const repositoryUrl = typeof manifest?.url === 'string' ? manifest.url.replace(/\/$/, '') : '';

    if (manifest?.id !== EXPECTED_MODULE_ID) {
        errors.push(`module.json id must be ${EXPECTED_MODULE_ID}.`);
    }
    if (packageJson?.name !== EXPECTED_MODULE_ID) {
        errors.push(`package.json name must be ${EXPECTED_MODULE_ID}.`);
    }
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
        errors.push('module.json version must be a semantic x.y.z version.');
    }
    if (packageJson?.version !== version) {
        errors.push('package.json version must match module.json version.');
    }

    if (version && typeof readme === 'string') {
        if (!readme.includes(`**Module version:** \`${version}\``)) {
            errors.push('README Module version must match module.json version.');
        }
        if (!readme.includes(`**Version:** ${version}`)) {
            errors.push('README footer version must match module.json version.');
        }
    } else if (typeof readme !== 'string') {
        errors.push('README content is required for release validation.');
    }

    if (!repositoryUrl) {
        errors.push('module.json url must identify the release repository.');
    } else if (version) {
        const expected = {
            manifest: `${repositoryUrl}/releases/latest/download/module.json`,
            download: `${repositoryUrl}/releases/download/V${version}/${EXPECTED_MODULE_ID}.zip`,
            readme: `${repositoryUrl}/blob/main/README.md`,
            bugs: `${repositoryUrl}/issues`
        };
        for (const [key, expectedValue] of Object.entries(expected)) {
            if (manifest?.[key] !== expectedValue) {
                errors.push(`module.json ${key} must be ${expectedValue}.`);
            }
        }
    }

    if (ciTag !== null && ciTag !== undefined && ciTag !== '') {
        const expectedTag = getExpectedReleaseTag(version);
        if (ciTag !== expectedTag) errors.push(`Release tag must be ${expectedTag}.`);
    }
    if (existingReleaseTagCommit && currentCommit && existingReleaseTagCommit !== currentCommit) {
        errors.push(`${getExpectedReleaseTag(version)} already points at a different commit; bump the release version instead of reusing or moving the tag.`);
    }

    for (const path of getManifestRuntimePaths(manifest)) {
        if (!isSafeRepositoryPath(path)) errors.push(`Unsafe or unsupported manifest runtime path: ${String(path)}.`);
        else if (!isPathIncludedInRelease(path)) errors.push(`Manifest runtime path is excluded from the release payload: ${path}.`);
    }

    for (const path of RELEASE_PAYLOAD_PATHS) {
        if (!isSafeRepositoryPath(path)) errors.push(`Unsafe release payload path: ${path}.`);
    }

    return errors;
}
