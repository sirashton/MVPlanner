import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlanError, applyEdits } from './core/index.ts';
import type { Edit, Marker } from './core/index.ts';
import { scanRepo } from './scan.ts';
import { repoTopLevel } from './storage/git.ts';
import type { PlanStore } from './storage/stores.ts';
import { buildView } from './view.ts';

// `mvplan serve`: the interactive plan page on localhost. It reads and writes through the same store and operations
// as the agents, so there is nothing new to keep in sync, and the hosted service can serve the same page later.

export interface ServeOptions {
    store: PlanStore;
    cwd: string;
    port?: number;
    // Who is making changes from the page, for the plan's log.
    human?: string;
    // How often to look for changes made by agents elsewhere.
    pollMs?: number;
    scanMarkers?: boolean;
}

export interface PlanServer {
    url: string;
    close(): Promise<void>;
}

const MARKER_SCAN_MS = 60_000;

async function loadPage(): Promise<string> {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // page.html sits beside the bundle in plugin/dist, and in src/web when run from source.
    for (const candidate of [path.join(here, 'page.html'), path.join(here, 'web', 'page.html')]) {
        const page = await fs.readFile(candidate, 'utf-8').catch(() => undefined);
        if (page !== undefined) {
            return page;
        }
    }
    throw new PlanError('The web page is missing from this install of MVPlanner.');
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => {
            data += chunk;
            if (data.length > 1_000_000) {
                reject(new PlanError('Request too large.'));
                req.destroy();
            }
        });
        req.on('end', () => resolve(data));
        req.on('error', reject);
    });
}

export async function startServer(options: ServeOptions): Promise<PlanServer> {
    const { store } = options;
    const human = options.human ?? os.userInfo().username;
    const page = await loadPage();
    const root = (await repoTopLevel(options.cwd)) ?? options.cwd;

    let markers: Marker[] = [];
    let markersAt = 0;
    const freshMarkers = async () => {
        if (options.scanMarkers !== false && Date.now() - markersAt > MARKER_SCAN_MS) {
            markersAt = Date.now();
            markers = await scanRepo(root).catch(() => markers);
        }
        return markers;
    };

    let last = { revision: -1, json: '' };
    const clients = new Set<http.ServerResponse>();
    const publish = (json: string) => {
        for (const client of clients) {
            client.write(`data: ${json}\n\n`);
        }
    };
    const current = async (fresh: boolean) => {
        const plan = await store.read({ fresh });
        const json = JSON.stringify(buildView(plan, await freshMarkers()));
        if (json !== last.json) {
            last = { revision: plan.revision, json };
            publish(json);
        }
        return last.json;
    };

    let polling = false;
    const poll = setInterval(() => {
        if (clients.size === 0 || polling) {
            return;
        }
        polling = true;
        current(true).catch(() => undefined).finally(() => (polling = false));
    }, options.pollMs ?? 4000);

    const server = http.createServer(async (req, res) => {
        const send = (status: number, body: string, type = 'application/json') => {
            res.writeHead(status, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
            res.end(body);
        };
        // Only answer requests addressed to this machine, so a web page can't reach the plan by DNS rebinding.
        const host = (req.headers.host ?? '').replace(/:\d+$/, '');
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) {
            return send(403, JSON.stringify({ error: 'Forbidden host' }));
        }
        try {
            const url = new URL(req.url ?? '/', 'http://localhost');
            if (req.method === 'GET' && url.pathname === '/') {
                return send(200, page, 'text/html');
            }
            if (req.method === 'GET' && url.pathname === '/api/view') {
                return send(200, await current(url.searchParams.has('fresh')));
            }
            if (req.method === 'GET' && url.pathname === '/api/events') {
                const json = await current(false);
                res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
                res.write(`data: ${json}\n\n`);
                clients.add(res);
                req.on('close', () => clients.delete(res));
                return;
            }
            if (req.method === 'POST' && url.pathname === '/api/edits') {
                // A custom header and JSON body force a CORS preflight, which this server never grants, so other
                // sites can't post edits from someone's browser.
                if (req.headers['x-mvplanner'] !== '1' || !String(req.headers['content-type']).startsWith('application/json')) {
                    return send(403, JSON.stringify({ error: 'Missing MVPlanner header' }));
                }
                const { edits } = JSON.parse(await readBody(req)) as { edits: Edit[] };
                if (!Array.isArray(edits) || edits.length === 0) {
                    return send(400, JSON.stringify({ error: 'Send {"edits": [...]}' }));
                }
                const { plan, result } = await store.mutate(`${human} edits the plan in the web UI`, p =>
                    applyEdits(p, undefined, edits, `${human} in the web UI`));
                const json = JSON.stringify(buildView(plan, await freshMarkers()));
                last = { revision: plan.revision, json };
                publish(json);
                return send(200, JSON.stringify({ results: result, view: JSON.parse(json) }));
            }
            return send(404, JSON.stringify({ error: 'Not found' }));
        } catch (error) {
            const message = error instanceof PlanError || error instanceof SyntaxError ? error.message : `Unexpected error: ${(error as Error).message}`;
            return send(error instanceof PlanError || error instanceof SyntaxError ? 400 : 500, JSON.stringify({ error: message }));
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(options.port ?? 0, '127.0.0.1', resolve);
    });
    const { port } = server.address() as { port: number };
    return {
        url: `http://127.0.0.1:${port}/`,
        close: () => new Promise(resolve => {
            clearInterval(poll);
            for (const client of clients) {
                client.end();
            }
            server.close(() => resolve());
            server.closeAllConnections();
        }),
    };
}

export function openInBrowser(url: string) {
    const command = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
    spawn(command, args, { stdio: 'ignore', detached: true }).on('error', () => undefined).unref();
}
