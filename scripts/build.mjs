// Bundles the CLI, MCP server and hook handler into plugin/dist so the plugin runs with no npm install.
// --check rebuilds into a temporary folder and fails if the committed bundles are out of date.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const check = process.argv.includes('--check');
const root = path.resolve(import.meta.dirname, '..');
const outdir = check ? await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-build-')) : path.join(root, 'plugin', 'dist');

await build({
    entryPoints: ['cli', 'mcp', 'hook'].map(name => path.join(root, 'src', `${name}.ts`)),
    outdir,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
    banner: { js: "#!/usr/bin/env node\nimport { createRequire as __mvplannerRequire } from 'node:module';\nconst require = __mvplannerRequire(import.meta.url);" },
});

for (const file of await fs.readdir(outdir)) {
    await fs.chmod(path.join(outdir, file), 0o755);
}

if (check) {
    const stale = [];
    for (const file of await fs.readdir(outdir)) {
        const fresh = await fs.readFile(path.join(outdir, file), 'utf-8');
        const committed = await fs.readFile(path.join(root, 'plugin', 'dist', file), 'utf-8').catch(() => '');
        if (fresh !== committed) {
            stale.push(file);
        }
    }
    if (stale.length) {
        console.error(`plugin/dist is out of date (${stale.join(', ')}). Run "npm run build" and commit the result.`);
        process.exit(1);
    }
    console.log('plugin/dist is up to date.');
}
