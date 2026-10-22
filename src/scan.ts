import fs from 'node:fs/promises';
import path from 'node:path';
import { findMarkers } from './core/markers.ts';
import type { Marker } from './core/markers.ts';
import { gitOk } from './storage/git.ts';

// Docs and data files talk about markers rather than carry them, and bundles repeat their sources.
const SKIP_EXTENSIONS = new Set(['.md', '.json', '.lock', '.svg', '.png', '.jpg', '.jpeg', '.gif', '.ico', '.pdf', '.zip', '.woff', '.woff2']);
const SKIP_DIRS = ['dist/', 'node_modules/', 'vendor/'];
const MAX_BYTES = 1024 * 1024;

export function shouldScan(file: string): boolean {
    const normalized = file.split(path.sep).join('/');
    if (SKIP_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
        return false;
    }
    return !SKIP_DIRS.some(dir => normalized.startsWith(dir) || normalized.includes(`/${dir}`));
}

// Markers in every tracked or new (not ignored) file of the repository at root.
export async function scanRepo(root: string): Promise<Marker[]> {
    const files = (await gitOk(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])).split('\0').filter(f => f && shouldScan(f));
    const markers: Marker[] = [];
    for (const file of files) {
        const full = path.join(root, file);
        const stat = await fs.stat(full).catch(() => undefined);
        if (!stat?.isFile() || stat.size > MAX_BYTES) {
            continue;
        }
        const content = await fs.readFile(full, 'utf-8');
        if (content.includes('\0')) {
            continue;
        }
        markers.push(...findMarkers(content, file));
    }
    return markers;
}
