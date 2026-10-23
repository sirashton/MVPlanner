// Test fixtures below contain deliberate markers. mvplan:ignore-file
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    checkMarkers, checkPullRequest, claimTask, getTask, decideProposal, computeDoMore, criticalPath, deferTask, findMarkers, migrateV1, nextTasks, overallLevel,
    parsePlan, proposeTask, serializePlan, updateTask, validatePlan,
} from '../src/core/index.ts';
import type { Plan } from '../src/core/index.ts';
import { renderTask } from '../src/format.ts';
import { currentSession } from '../src/session.ts';

// The worked example from the README: a Could feature with Must subtasks must not block "done all we Must".
function todoApp(): Plan {
    return migrateV1({
        name: 'To-do app', mscw: 'Must', subtasks: [
            { name: 'Basic list', mscw: 'Must', subtasks: [
                { name: 'Add tasks', mscw: 'Must', status: 'Complete' },
                { name: 'Mark complete', mscw: 'Must' },
                { name: 'Delete tasks', mscw: 'Should' },
            ] },
            { name: 'Auth', mscw: 'Should', subtasks: [
                { name: 'Register', mscw: 'Must' },
            ] },
            { name: 'Quantum sorting', mscw: 'Could', subtasks: [
                { name: 'Quantum API', mscw: 'Must' },
            ] },
        ],
    });
}

test('migration gives every task a unique id in tree order', () => {
    const plan = todoApp();
    assert.equal(plan.root.id, 'T-1');
    assert.equal(plan.root.subtasks![0].subtasks![1].id, 'T-4');
    assert.equal(plan.nextId, 10);
    assert.deepEqual(validatePlan(plan), []);
    assert.deepEqual(parsePlan(serializePlan(plan)), plan);
});

test('validation catches duplicate ids and bad values', () => {
    const plan = todoApp();
    plan.root.subtasks![1].id = 'T-2';
    (plan.root.subtasks![2] as { mscw: string }).mscw = 'Maybe';
    const errors = validatePlan(plan);
    assert.ok(errors.some(e => e.includes('duplicate id T-2')));
    assert.ok(errors.some(e => e.includes('mscw must be one of')));
});

test('do-more rolls priority up relative to the parent', () => {
    const plan = todoApp();
    const levels = computeDoMore(plan.root);
    assert.equal(levels.get('T-2'), 'Must');
    assert.equal(levels.get('T-8'), 'Must'); // its own Must subtask
    assert.equal(overallLevel(plan), 'Must');

    // Finish the Must work in the basic list: the project is now at Should, despite quantum sorting's Must subtask.
    updateTask(plan, 'T-4', 'a', { status: 'Complete' });
    assert.equal(overallLevel(plan), 'Should');

    for (const id of ['T-5', 'T-7']) {
        updateTask(plan, id, 'a', { status: 'Complete' });
    }
    assert.equal(overallLevel(plan), 'Could');
    updateTask(plan, 'T-9', 'a', { status: 'Complete' });
    assert.equal(overallLevel(plan), "Can't");
});

test('critical path and next tasks follow the current level', () => {
    const plan = todoApp();
    const path = criticalPath(plan);
    assert.ok(path.has('T-2') && path.has('T-4'));
    assert.ok(!path.has('T-8'), 'a Could branch is off the Must path');
    assert.deepEqual(nextTasks(plan).map(n => n.task.id), ['T-4']);
});

test('claims are exclusive and hide tasks from other agents', () => {
    const plan = todoApp();
    claimTask(plan, 'T-4', 'agent-a', 'feature/x');
    assert.equal(plan.root.subtasks![0].subtasks![1].status, 'In Progress');
    assert.throws(() => claimTask(plan, 'T-4', 'agent-b'), /already claimed by agent-a/);
    assert.deepEqual(nextTasks(plan, { agent: 'agent-b' }).map(n => n.task.id), []);
    assert.deepEqual(nextTasks(plan, { agent: 'agent-a' }).map(n => n.task.id), ['T-4']);
    assert.throws(() => updateTask(plan, 'T-4', 'agent-b', { status: 'Complete' }), /claimed by agent-a/);
});

test('a claim that has been quiet past the limit can be taken over, and the log says so', () => {
    const plan = todoApp();
    claimTask(plan, 'T-4', 'agent-a');
    const later = Date.now() + 3 * 60 * 60 * 1000;
    assert.deepEqual(nextTasks(plan, { agent: 'agent-b', now: later }).map(n => n.task.id), ['T-4']);
    const task = claimTask(plan, 'T-4', 'agent-b', 'feature/y', undefined, later);
    assert.equal(task.claimedBy!.agent, 'agent-b');
    assert.match(task.log!.at(-1)!.text, /^Took over from agent-a, whose claim had been quiet since .+\. Claimed on feature\/y$/);
    assert.equal(task.log!.at(-1)!.agent, 'agent-b');
    assert.throws(() => claimTask(plan, 'T-4', 'agent-a'), /already claimed by agent-b/);
});

test('acceptance criteria gate completion', () => {
    const plan = todoApp();
    updateTask(plan, 'T-4', 'a', { addAcceptance: ['Click toggles state', 'State persists'] });
    assert.throws(() => updateTask(plan, 'T-4', 'a', { status: 'Complete', acceptanceDone: [0] }), /State persists/);
    updateTask(plan, 'T-4', 'a', { status: 'Complete', acceptanceDone: [0, 1] });
    assert.equal(plan.root.subtasks![0].subtasks![1].status, 'Complete');
});

test('dependencies block next tasks until met', () => {
    const plan = todoApp();
    const task = plan.root.subtasks![0].subtasks![1];
    task.dependsOn = ['T-5', 'other/repo#T-1'];
    assert.deepEqual(nextTasks(plan)[0].blockedBy, ['T-5', 'other/repo#T-1']);
});

test('proposals and deferrals become subtasks with fresh ids', () => {
    const plan = todoApp();
    const proposed = proposeTask(plan, 'T-2', 'a', { name: 'Undo' });
    assert.equal(proposed.id, 'T-10');
    assert.equal(proposed.proposed, true);
    assert.equal(proposed.mscw, 'Could');
    const deferred = deferTask(plan, 'T-4', 'a', { name: 'Animate toggle', trigger: 'users ask', files: ['src/a.ts'] });
    assert.equal(deferred.id, 'T-11');
    assert.deepEqual(deferred.deferred, { trigger: 'users ask', files: ['src/a.ts'] });
    assert.equal(overallLevel(plan), 'Must');
});

test('markers are found and checked against the plan', () => {
    const plan = todoApp();
    updateTask(plan, 'T-3', 'a', { status: 'Complete' });
    const source = [
        'function list() {',
        '  // MVP(T-4): fixed list for now',
        '  // TODO(T-3): already done',
        '  // TODO(T-99): unknown',
        '  // TODO tidy this',
        '  // TODO(T-77) example mvplan:ignore',
        '}',
    ].join('\n');
    const markers = findMarkers(source, 'a.ts');
    assert.deepEqual(markers.map(m => [m.kind, m.id, m.line]), [
        ['MVP', 'T-4', 2], ['TODO', 'T-3', 3], ['TODO', 'T-99', 4], ['TODO', undefined, 5],
    ]);
    assert.deepEqual(checkMarkers(plan, markers).map(p => p.kind), ['stale', 'orphan', 'unlinked']);
});

test('proposals stay out of the level and next tasks until accepted', () => {
    const plan = todoApp();
    for (const id of ['T-4', 'T-5', 'T-7', 'T-9']) {
        updateTask(plan, id, 'a', { status: 'Complete' });
    }
    assert.equal(overallLevel(plan), "Can't");
    const proposal = proposeTask(plan, 'T-2', 'a', { name: 'Undo', mscw: 'Must' });
    assert.equal(overallLevel(plan), "Can't");
    assert.deepEqual(nextTasks(plan), []);
    decideProposal(plan, proposal.id, true);
    assert.equal(overallLevel(plan), 'Must');
    assert.deepEqual(nextTasks(plan).map(n => n.task.id), [proposal.id]);
});

test('lines and files can opt out of marker checks', () => {
    assert.deepEqual(findMarkers('// TODO(T-1) example mvplan:ignore\n// TODO(T-2)').map(m => m.id), ['T-2']);
    assert.deepEqual(findMarkers('// mvplan:ignore-file\n// TODO tidy'), []);
});

test('the review view summarises progress, proposals, claims and deferrals', async () => {
    const { buildView } = await import('../src/view.ts');
    const plan = todoApp();
    updateTask(plan, 'T-3', 'a', { status: 'Complete' });
    claimTask(plan, 'T-4', 'agent-a');
    const proposal = proposeTask(plan, 'T-2', 'agent-b', { name: 'Undo' });
    const deferred = deferTask(plan, 'T-4', 'agent-a', { name: 'Animate', trigger: 'users ask' });
    const view = buildView(plan, [{ kind: 'MVP', id: deferred.id, line: 3, text: '', file: 'a.ts' }]);
    assert.equal(view.level, 'Must');
    assert.deepEqual(view.ladder[0], { label: 'Must', done: 1, total: 2, isCurrent: true });
    assert.deepEqual(view.proposals.map(p => [p.id, p.by]), [[proposal.id, 'agent-b']]);
    assert.deepEqual(view.claims.map(c => [c.id, c.agent, c.isStale]), [['T-4', 'agent-a', false]]);
    assert.deepEqual(view.deferred.map(d => [d.id, d.markers.length]), [[deferred.id, 1]]);
    assert.equal(view.tree.length, 11);
});

test('tasks move and are removed, but never into themselves or out from under a claim', async () => {
    const { moveTask, removeTask } = await import('../src/core/index.ts');
    const plan = todoApp();
    moveTask(plan, 'T-5', 'T-6', 'a', 0);
    assert.deepEqual(plan.root.subtasks![1].subtasks!.map(t => t.id), ['T-5', 'T-7']);
    assert.throws(() => moveTask(plan, 'T-2', 'T-4', 'a'), /inside it/);
    assert.throws(() => moveTask(plan, 'T-1', 'T-2', 'a'), /root/);
    claimTask(plan, 'T-9', 'agent-b');
    assert.throws(() => removeTask(plan, 'T-8', 'agent-a'), /claimed by agent-b/);
    removeTask(plan, 'T-8', 'agent-b');
    assert.deepEqual(plan.root.subtasks!.map(t => t.id), ['T-2', 'T-6']);
    assert.deepEqual(validatePlan(plan), []);
});

test('a batch of edits applies in order, links new tasks by ref, and fails as a whole', async () => {
    const { applyEdits } = await import('../src/core/index.ts');
    const plan = todoApp();
    const lines = applyEdits(plan, 'agent-a', [
        { op: 'add', parent: 'T-1', ref: 'share', name: 'Sharing', mscw: 'Could' },
        { op: 'add', parent: '$share', name: 'Share link' },
        { op: 'move', id: 'T-8', parent: '$share' },
        { op: 'update', id: 'T-6', mscw: "Won't" },
    ], 'Alex, in a scoping chat');
    assert.equal(lines.length, 4);
    const sharing = plan.root.subtasks!.at(-1)!;
    assert.equal(sharing.name, 'Sharing');
    assert.deepEqual(sharing.subtasks!.map(t => t.name), ['Share link', 'Quantum sorting']);
    assert.equal(sharing.subtasks![0].mscw, 'Must');
    assert.throws(() => applyEdits(plan, 'agent-a', [{ op: 'remove', id: '$nope' }], 'Alex'), /Edit 1 \(remove\) failed: Unknown ref/);
});

test('a claim records the session behind it', async () => {
    const { buildView } = await import('../src/view.ts');
    assert.equal(currentSession({ CLAUDE_CODE_REMOTE_SESSION_ID: 'cse_01AbC', CLAUDE_CODE_SESSION_ID: 'local-id' }), 'https://claude.ai/code/session_01AbC');
    assert.equal(currentSession({ CLAUDE_CODE_SESSION_ID: 'local-id' }), 'local-id');
    assert.equal(currentSession({}), undefined);

    const plan = todoApp();
    const task = claimTask(plan, 'T-4', 'agent-a', 'feature/x', 'https://claude.ai/code/session_01AbC');
    assert.equal(task.claimedBy!.session, 'https://claude.ai/code/session_01AbC');
    assert.match(renderTask(plan, task), /Session: https:\/\/claude\.ai\/code\/session_01AbC/);
    assert.equal(buildView(plan).claims[0].session, 'https://claude.ai/code/session_01AbC');
    assert.deepEqual(validatePlan(plan), []);
});

test('deciding a proposal twice in one batch is not an error', async () => {
    const { applyEdits } = await import('../src/core/index.ts');
    const plan = todoApp();
    const a = proposeTask(plan, 'T-2', 'agent-b', { name: 'Undo', mscw: 'Should' });
    const b = proposeTask(plan, 'T-2', 'agent-b', { name: 'Themes', mscw: 'Could' });
    const lines = applyEdits(plan, undefined, [
        { op: 'accept', id: a.id, mscw: 'Must' },
        { op: 'accept', id: a.id, mscw: 'Must' },
        { op: 'decline', id: b.id },
        { op: 'decline', id: b.id },
    ], 'Alex in the web UI');
    assert.match(lines[1], /already accepted/);
    assert.match(lines[3], /already declined/);
    assert.equal(getTask(plan, a.id).mscw, 'Must');
    assert.equal(getTask(plan, b.id).mscw, "Won't");
    assert.throws(() => applyEdits(plan, undefined, [{ op: 'decline', id: a.id }], 'Alex'), /not a proposal/);
});

test('a pull request must name a claimed or complete task', () => {
    const plan = todoApp();
    claimTask(plan, 'T-4', 'agent-a');
    updateTask(plan, 'T-3', 'a', { status: 'Complete' });
    const proposal = proposeTask(plan, 'T-2', 'agent-b', { name: 'Undo' });
    assert.equal(checkPullRequest(plan, { title: 'Tidy things', branch: 'fix', body: '' }).ok, false);
    assert.equal(checkPullRequest(plan, { title: 'Add sorting', branch: 'claude/T-4-sorting' }).ok, true);
    assert.equal(checkPullRequest(plan, { title: 'Done work (T-3)' }).ok, true);
    assert.equal(checkPullRequest(plan, { body: `Implements ${proposal.id}` }).ok, false);
    const unclaimed = checkPullRequest(plan, { title: 'T-5', body: 'Mentions T-999' });
    assert.equal(unclaimed.ok, false);
    assert.match(unclaimed.message, /T-5 .* is not claimed/);
    assert.match(unclaimed.message, /T-999 is not in the plan/);
});
