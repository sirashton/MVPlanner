import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claimTask, newPlan, proposeTask } from '../src/core/index.ts';
import { gitOk } from '../src/storage/git.ts';
import { FileStore, GitBranchStore, openStore } from '../src/storage/stores.ts';

const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

// A bare "remote" and two independent clones, standing in for two cloud sessions or projects.
async function setup() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-'));
    const remote = path.join(dir, 'remote.git');
    await gitOk(dir, ['init', '--quiet', '--bare', remote]);
    const clones: string[] = [];
    for (const name of ['a', 'b']) {
        const clone = path.join(dir, name);
        await gitOk(dir, ['clone', '--quiet', remote, clone]);
        await gitOk(clone, ['commit', '--quiet', '--allow-empty', '-m', 'init'], undefined, env);
        clones.push(clone);
    }
    await gitOk(clones[0], ['push', '--quiet', 'origin', 'HEAD:refs/heads/main']);
    return { dir, clones };
}

test('git branch store shares one plan between independent clones', async () => {
    const { clones } = await setup();
    const a = new GitBranchStore(clones[0]);
    const b = new GitBranchStore(clones[1]);
    await assert.rejects(a.read(), /no plan branch/i);
    await a.init(newPlan('Shared project'));
    await assert.rejects(b.init(newPlan('Again')), /already exists/);

    await a.mutate('propose', plan => proposeTask(plan, 'T-1', 'agent-a', { name: 'From A' }));
    const seenByB = await b.read({ fresh: true });
    assert.equal(seenByB.root.subtasks![0].name, 'From A');

    await b.mutate('claim', plan => claimTask(plan, 'T-2', 'agent-b'));
    // A's local copy is stale, but a write always starts from the latest plan, so B's claim is respected.
    await assert.rejects(a.mutate('claim', plan => claimTask(plan, 'T-2', 'agent-a')), /already claimed by agent-b/);

    // The working tree and current branch are never touched.
    assert.equal((await gitOk(clones[0], ['status', '--porcelain'])).trim(), '');
    assert.equal((await gitOk(clones[0], ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'master');
});

test('concurrent writers from different clones all land', async () => {
    const { clones } = await setup();
    const stores = [new GitBranchStore(clones[0]), new GitBranchStore(clones[1])];
    await stores[0].init(newPlan('Busy project'));
    await Promise.all(Array.from({ length: 6 }, (_, i) =>
        stores[i % 2].mutate(`add ${i}`, plan => proposeTask(plan, 'T-1', `agent-${i}`, { name: `Task ${i}` }))));
    const plan = await stores[0].read({ fresh: true });
    assert.equal(plan.root.subtasks!.length, 6);
    assert.equal(new Set(plan.root.subtasks!.map(t => t.id)).size, 6);
    assert.equal(plan.revision, 7);
});

test('file store is shared by worktrees through the main checkout', async () => {
    const { dir, clones } = await setup();
    const worktree = path.join(dir, 'wt');
    await gitOk(clones[0], ['worktree', 'add', '--quiet', '-b', 'feature', worktree]);
    const store = new FileStore(path.join(clones[0], 'plan.json'));
    await store.write(newPlan('Local project'));
    const fromWorktree = await openStore(worktree, { backend: 'file', remote: 'origin', branch: 'x' });
    assert.equal(fromWorktree.describe(), `file ${path.join(await fs.realpath(clones[0]), 'plan.json')}`);
    await Promise.all(Array.from({ length: 5 }, (_, i) =>
        fromWorktree.mutate('add', plan => proposeTask(plan, 'T-1', 'a', { name: `Task ${i}` }))));
    assert.equal((await store.read()).root.subtasks!.length, 5);
});

test('setup switches the plugin on for a repo once, keeping what is there', async () => {
    const { writeRepoSetup } = await import('../src/setup.ts');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-setup-'));
    await fs.mkdir(path.join(dir, '.claude'));
    await fs.writeFile(path.join(dir, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] } }));
    await fs.writeFile(path.join(dir, 'CLAUDE.md'), '# Project notes\n');
    assert.deepEqual(await writeRepoSetup(dir), ['.claude/settings.json', 'CLAUDE.md', '.github/workflows/mvplanner.yml']);
    assert.match(await fs.readFile(path.join(dir, '.github', 'workflows', 'mvplanner.yml'), 'utf-8'), /check-pr/);
    const settings = JSON.parse(await fs.readFile(path.join(dir, '.claude', 'settings.json'), 'utf-8'));
    assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] });
    assert.equal(settings.enabledPlugins['mvplanner@mvplanner'], true);
    assert.match(await fs.readFile(path.join(dir, 'CLAUDE.md'), 'utf-8'), /^# Project notes\n\n<!-- mvplanner -->/);
    assert.deepEqual(await writeRepoSetup(dir), []);
});
