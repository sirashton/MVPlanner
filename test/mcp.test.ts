import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { claimTask, newPlan, proposeTask } from '../src/core/index.ts';
import { createServer } from '../src/mcp.ts';
import { FileStore } from '../src/storage/stores.ts';

test('task_update to Complete fails without a handoff note', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-mcp-'));
    const store = new FileStore(path.join(dir, 'plan.json'));
    const plan = newPlan('Tools');
    proposeTask(plan, 'T-1', undefined, { name: 'Work', mscw: 'Must' });
    delete plan.root.subtasks![0].proposed;
    claimTask(plan, 'T-2', 'agent-a');
    await store.write(plan);

    const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
    await createServer(dir, Promise.resolve(store)).connect(serverSide);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientSide);
    const complete = (note?: string) => client.callTool({ name: 'task_update', arguments: { id: 'T-2', agent: 'agent-a', status: 'Complete', ...(note === undefined ? {} : { note }) } }) as Promise<{ isError?: boolean; content: { text: string }[] }>;

    for (const note of [undefined, '  ']) {
        const refused = await complete(note);
        assert.equal(refused.isError, true);
        assert.match(refused.content[0].text, /needs a handoff note/);
    }
    assert.equal((await store.read()).root.subtasks![0].status, 'In Progress');

    const done = await complete('Added the work. Left out retries (T-9). See src/work.ts.');
    assert.equal(done.isError, undefined);
    const task = (await store.read()).root.subtasks![0];
    assert.equal(task.status, 'Complete');
    assert.match(task.log!.at(-1)!.text, /Left out retries \(T-9\)/);
    await client.close();
});
