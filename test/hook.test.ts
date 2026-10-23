// Test fixtures below contain deliberate markers. mvplan:ignore-file
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { claimTask, newPlan, proposeTask, updateTask } from '../src/core/index.ts';
import { agentId, runHook } from '../src/hook.ts';
import type { HookInput } from '../src/hook.ts';
import { FileStore } from '../src/storage/stores.ts';

async function setup(strictness = 'warn') {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-hook-'));
    const store = new FileStore(path.join(dir, 'plan.json'));
    const plan = newPlan('Hooked');
    proposeTask(plan, 'T-1', undefined, { name: 'Work', mscw: 'Must' });
    delete plan.root.subtasks![0].proposed;
    await store.write(plan);
    const env = { MVPLANNER_BACKEND: 'file', MVPLANNER_STRICTNESS: strictness, CLAUDE_PLUGIN_DATA: path.join(dir, 'data') };
    const base: HookInput = { session_id: 'abcdef1234', cwd: dir };
    const run = (event: string, extra: HookInput = {}) => runHook(event, { ...base, ...extra }, env);
    return { dir, store, run, agent: agentId(base) };
}

const edit = (file: string, newString: string): HookInput => ({ tool_name: 'Edit', tool_input: { file_path: file, old_string: 'a', new_string: newString } });

test('session start briefs the agent with its id and the rules', async () => {
    const { run, agent } = await setup();
    const output = await run('SessionStart') as { hookSpecificOutput: { additionalContext: string } };
    const context = output.hookSpecificOutput.additionalContext;
    assert.match(context, new RegExp(`agent id is "${agent}"`));
    assert.match(context, /never read, edit or commit it/);
    assert.match(context, /T-2 Work/);
});

test('hooks stay silent in a repo without a plan', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-none-'));
    assert.equal(await runHook('SessionStart', { cwd: dir }, { MVPLANNER_BACKEND: 'file' }), undefined);
    assert.equal(await runHook('PreToolUse', { cwd: dir, ...edit(path.join(dir, 'a.ts'), 'x') }, { MVPLANNER_BACKEND: 'file' }), undefined);
});

test('direct edits to plan.json are always denied', async () => {
    const { run, dir } = await setup();
    const output = await run('PreToolUse', edit(path.join(dir, 'Plan.JSON'), '{}')) as { hookSpecificOutput: { permissionDecision: string } };
    assert.equal(output.hookSpecificOutput.permissionDecision, 'deny');
});

test('editing without a claim warns, or denies in enforce mode', async () => {
    const warn = await setup('warn');
    const warned = await warn.run('PreToolUse', edit(path.join(warn.dir, 'a.ts'), 'x')) as { hookSpecificOutput: Record<string, string> };
    assert.equal(warned.hookSpecificOutput.permissionDecision, undefined);
    assert.match(warned.hookSpecificOutput.additionalContext, /no MVPlanner task claimed/);

    const enforce = await setup('enforce');
    const denied = await enforce.run('PreToolUse', edit(path.join(enforce.dir, 'a.ts'), 'x')) as { hookSpecificOutput: Record<string, string> };
    assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');

    await enforce.store.mutate('claim', p => claimTask(p, 'T-2', enforce.agent));
    assert.equal(await enforce.run('PreToolUse', edit(path.join(enforce.dir, 'a.ts'), 'x')), undefined);
});

test('off disables every hook', async () => {
    const { run, dir } = await setup('off');
    assert.equal(await run('PreToolUse', edit(path.join(dir, 'plan.json'), '{}')), undefined);
});

test('markers written without a real task are sent back', async () => {
    const { run, dir } = await setup();
    const output = await run('PostToolUse', edit(path.join(dir, 'a.ts'), '// TODO tidy\n// MVP(T-2): fixed list\n// TODO(T-9): later')) as { decision: string; reason: string };
    assert.equal(output.decision, 'block');
    assert.match(output.reason, /TODO without a task id/);
    assert.match(output.reason, /T-9\) names a task that is not in the plan/);
    assert.doesNotMatch(output.reason, /T-2/);
});

test('stop nudges once when edits were made without recording progress', async () => {
    const { run, dir, store, agent } = await setup();
    await store.mutate('claim', p => claimTask(p, 'T-2', agent));
    assert.equal(await run('Stop'), undefined, 'no edits, no nudge');

    await new Promise(r => setTimeout(r, 5));
    await run('PostToolUse', edit(path.join(dir, 'a.ts'), 'code'));
    const nudge = await run('Stop') as { decision: string; reason: string };
    assert.equal(nudge.decision, 'block');
    assert.match(nudge.reason, /task_update for your task T-2/);
    assert.equal(await run('Stop'), undefined, 'only one nudge per batch of edits');

    await run('PostToolUse', edit(path.join(dir, 'a.ts'), 'more code'));
    await new Promise(r => setTimeout(r, 5));
    await store.mutate('update', p => updateTask(p, 'T-2', agent, { note: 'did the thing' }));
    assert.equal(await run('Stop'), undefined, 'progress recorded after the edits');
});

test('a session started inside another one gets its own agent id', async () => {
    const { resolveAgentId } = await import('../src/hook.ts');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-owner-'));
    const input: HookInput = { session_id: 'abcdef1234' };
    // The test runner is alive, so it stands in for the outer session; pid 2147483646 is a process that has ended.
    assert.equal(await resolveAgentId(input, dir, process.pid), 'claude-abcdef12');
    assert.equal(await resolveAgentId(input, dir, process.pid), 'claude-abcdef12');
    assert.equal(await resolveAgentId(input, dir, 4242), 'claude-abcdef12-p4242');
    assert.equal(await resolveAgentId({ ...input, agent_id: 'sub1234567' }, dir, 4242), 'claude-abcdef12-sub12345-p4242');
    // A resumed session runs in a new process after the old one has gone, and keeps its id.
    const resumed = await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-owner-'));
    assert.equal(await resolveAgentId(input, resumed, 2147483646), 'claude-abcdef12');
    assert.equal(await resolveAgentId(input, resumed, process.pid), 'claude-abcdef12');
});
