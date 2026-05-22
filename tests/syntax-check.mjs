import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const roots = ['scripts', 'tests'];
const extensions = new Set(['.js', '.mjs']);
const files = [];

async function collect(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            await collect(path);
        } else if (extensions.has(extname(entry.name))) {
            files.push(path);
        }
    }
}

for (const root of roots) await collect(root);

const failures = [];
for (const file of files.sort()) {
    const result = spawnSync(process.execPath, ['--check', file], {
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        failures.push({
            file,
            stdout: (result.stdout ?? '').trim(),
            stderr: (result.stderr ?? '').trim()
        });
    }
}

if (failures.length) {
    console.error(JSON.stringify({ success: false, failures }, null, 2));
    process.exitCode = 1;
} else {
    console.log(JSON.stringify({ success: true, checked: files.length, files: files.sort() }, null, 2));
}
