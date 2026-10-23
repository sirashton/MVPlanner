import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { claimTask, newPlan } from '../src/core/index.ts';
import { startServer, withView } from '../src/serve.ts';
import { FileStore } from '../src/storage/stores.ts';

async function setup() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-serve-'));
    const store = new FileStore(path.join(dir, 'plan.json'));
    await store.write(newPlan('Scoping demo'));
    const server = await startServer({ store, cwd: dir, human: 'alex', pollMs: 50, scanMarkers: false });
    return { store, server };
}

const post = (url: string, body: unknown, headers: Record<string, string> = { 'content-type': 'application/json', 'x-mvplanner': '1' }) =>
    fetch(new URL('api/edits', url), { method: 'POST', headers, body: JSON.stringify(body) });

test('the page and the view are served on localhost', async () => {
    const { server } = await setup();
    try {
        const page = await (await fetch(server.url)).text();
        assert.match(page, /<title>Plan<\/title>/);
        // The plan comes inside the page, so the first paint needs no second request.
        const initial = page.match(/<script type="application\/json" id="initial-view">(.*?)<\/script>/)?.[1];
        assert.equal((JSON.parse(initial!) as { name: string }).name, 'Scoping demo');
        const view = await (await fetch(new URL('api/view', server.url))).json() as { name: string };
        assert.equal(view.name, 'Scoping demo');
    } finally {
        await server.close();
    }
});

test('a batch of edits from the page saves in one revision', async () => {
    const { store, server } = await setup();
    try {
        const res = await post(server.url, { edits: [
            { op: 'add', parent: 'T-1', ref: 'a', name: 'Accounts', mscw: 'Should' },
            { op: 'add', parent: '$a', name: 'Sign up' },
            { op: 'add', parent: 'T-1', name: 'Dark mode', mscw: 'Could' },
        ] });
        assert.equal(res.status, 200);
        const body = await res.json() as { results: string[] };
        assert.equal(body.results.length, 3);
        const plan = await store.read();
        assert.equal(plan.revision, 2);
        assert.deepEqual(plan.root.subtasks!.map(t => [t.name, t.mscw]), [['Accounts', 'Should'], ['Dark mode', 'Could']]);
        assert.match(plan.root.subtasks![0].log![0].text, /approved by alex in the web UI/);

        const bad = await post(server.url, { edits: [{ op: 'remove', id: 'T-1' }] });
        assert.equal(bad.status, 400);
        assert.match((await bad.json() as { error: string }).error, /root task cannot be removed/);
    } finally {
        await server.close();
    }
});

test('other sites cannot write to the plan', async () => {
    const { store, server } = await setup();
    try {
        assert.equal((await post(server.url, { edits: [{ op: 'add', parent: 'T-1', name: 'x' }] }, { 'content-type': 'text/plain' })).status, 403);
        // fetch won't set Host, so ask the way a rebound DNS name would arrive.
        const rebound = await new Promise<number>(resolve =>
            http.get(server.url, { headers: { host: 'evil.example' } }, res => resolve(res.statusCode ?? 0)));
        assert.equal(rebound, 403);
        assert.equal((await store.read()).revision, 1);
    } finally {
        await server.close();
    }
});

test('changes made by agents elsewhere reach the page as they happen', async () => {
    const { store, server } = await setup();
    try {
        const res = await fetch(new URL('api/events', server.url));
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const nextView = async () => {
            while (!buffer.includes('\n\n')) {
                buffer += decoder.decode((await reader.read()).value);
            }
            const [event, rest] = [buffer.slice(0, buffer.indexOf('\n\n')), buffer.slice(buffer.indexOf('\n\n') + 2)];
            buffer = rest;
            return JSON.parse(event.replace(/^data: /, ''));
        };
        assert.equal((await nextView()).revision, 1);
        await store.mutate('agent claims', plan => claimTask(plan, 'T-1', 'agent-x'));
        const view = await nextView();
        assert.deepEqual(view.claims.map((c: { agent: string }) => c.agent), ['agent-x']);
        await reader.cancel();
    } finally {
        await server.close();
    }
});

test('a plan inlined in the page cannot close its script tag', () => {
    const page = withView('<body><script>run()</script></body>', JSON.stringify({ name: '</script><script>alert(1)</script>' }));
    assert.equal(page.match(/<\/script>/g)!.length, 2);
    assert.match(page, /\\u003c\/script>/);
});
