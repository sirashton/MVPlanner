import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { newPlan } from '../src/core/index.ts';
import { doctor, githubRepo, renderSetup, setupRepo } from '../src/onboard.ts';
import { gitOk } from '../src/storage/git.ts';
import { GitBranchStore } from '../src/storage/stores.ts';

const env = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

// Stands in for the claude and gh CLIs, recording what was asked of them.
function fakeRunner(pluginOn = true, ghWorks = false) {
    const calls: string[] = [];
    const runner = async (command: string, args: string[]) => {
        calls.push(`${command} ${args.join(' ')}`);
        if (command === 'claude') {
            return { code: 0, stdout: `Installed plugins:\n\n  > other@x\n    Status: √ enabled\n\n  > mvplanner@mvplanner\n    Status: ${pluginOn ? '√ enabled' : '✘ disabled'}\n` };
        }
        return { code: ghWorks ? 0 : 1, stdout: '' };
    };
    return { calls, runner };
}

// A bare "GitHub" remote whose HEAD names main, like a new GitHub repo, logging the order branches arrive in.
async function emptyRemote() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-onboard-'));
    const remote = path.join(dir, 'remote.git');
    await gitOk(dir, ['init', '--quiet', '--bare', '--initial-branch=main', remote]);
    const log = path.join(dir, 'pushes.log');
    await fs.writeFile(path.join(remote, 'hooks', 'post-receive'), `#!/bin/sh\nwhile read old new ref; do echo "$ref" >> "${log}"; done\n`, { mode: 0o755 });
    const clone = path.join(dir, 'clone');
    await gitOk(dir, ['clone', '--quiet', remote, clone]);
    for (const [key, value] of [['user.name', 't'], ['user.email', 't@t']]) {
        await gitOk(clone, ['config', key, value]);
    }
    const pushes = async () => (await fs.readFile(log, 'utf-8').catch(() => '')).split('\n').filter(Boolean);
    return { dir, remote, clone, pushes };
}

test('setup in an empty repo pushes main before the plan branch and leaves the checkout ready', async () => {
    const { clone, pushes } = await emptyRemote();
    const { runner } = fakeRunner();
    const result = await setupRepo(clone, { plan: async () => newPlan('Fresh'), runner });

    assert.deepEqual(await pushes(), ['refs/heads/main', 'refs/heads/mvplanner/plan']);
    assert.equal((await gitOk(clone, ['ls-remote', '--symref', 'origin', 'HEAD'])).split('\t')[0], 'ref: refs/heads/main');
    assert.equal((await new GitBranchStore(clone).read({ fresh: true })).root.name, 'Fresh');
    assert.equal((await gitOk(clone, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'main');
    await fs.access(path.join(clone, '.github', 'workflows', 'mvplanner.yml'));
    assert.equal((await gitOk(clone, ['status', '--porcelain'])).trim(), '');
    assert.ok(result.ok, renderSetup(result));
    const text = renderSetup(result);
    assert.match(text, /claude plugin marketplace add sirashton\/MVPlanner && claude plugin install mvplanner@mvplanner/);
    assert.match(text, /mvplan serve/);
    assert.match(text, /\/mvplanner:scope/);

    // Running it again changes nothing.
    const again = await setupRepo(clone, { plan: async () => newPlan('Other'), runner });
    assert.deepEqual(await pushes(), ['refs/heads/main', 'refs/heads/mvplanner/plan']);
    assert.match(again.lines.join('\n'), /already switches MVPlanner on[\s\S]*already on mvplanner\/plan/);
    assert.ok(again.ok);
});

test('setup in an existing repo adds to main without touching the checkout or other files', async () => {
    const { dir, clone, pushes } = await emptyRemote();
    await fs.writeFile(path.join(clone, 'CLAUDE.md'), '# Notes\n');
    await gitOk(clone, ['add', '.']);
    await gitOk(clone, ['commit', '--quiet', '-m', 'start'], undefined, env);
    await gitOk(clone, ['push', '--quiet', 'origin', 'HEAD:main']);
    await gitOk(clone, ['checkout', '--quiet', '-b', 'feature']);
    await fs.writeFile(path.join(clone, 'wip.txt'), 'unsaved work');

    const result = await setupRepo(clone, { plan: async () => newPlan('Existing'), runner: fakeRunner().runner });
    assert.ok(result.ok, renderSetup(result));
    assert.deepEqual((await pushes()).slice(1), ['refs/heads/main', 'refs/heads/mvplanner/plan']);
    const other = path.join(dir, 'other');
    await gitOk(dir, ['clone', '--quiet', '--branch', 'main', path.join(dir, 'remote.git'), other]);
    assert.match(await fs.readFile(path.join(other, 'CLAUDE.md'), 'utf-8'), /^# Notes\n\n<!-- mvplanner -->/);
    assert.equal((await gitOk(clone, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim(), 'feature');
    assert.equal((await gitOk(clone, ['status', '--porcelain'])).trim(), '?? wip.txt');
    assert.match(result.lines.join('\n'), /merge main into it/);
});

test('setup and doctor catch a plan branch left as the default branch', async () => {
    const { remote, clone } = await emptyRemote();
    await gitOk(clone, ['remote', 'set-url', 'origin', remote]);
    await new GitBranchStore(clone).init(newPlan('Old setup'));
    await gitOk(remote, ['symbolic-ref', 'HEAD', 'refs/heads/mvplanner/plan']);

    const { calls, runner } = fakeRunner(false);
    const result = await setupRepo(clone, { plan: async () => newPlan('x'), runner });
    // Main is created and given the files, but with no gh the default can only be fixed by hand.
    assert.match(result.lines[0], /to main/);
    assert.equal(result.ok, false);
    const failed = result.checks.filter(c => !c.ok).map(c => c.name);
    assert.deepEqual(failed, [
        'The MVPlanner plugin is on for Claude Code here',
        "GitHub's default branch is not the plan branch (it is mvplanner/plan)",
    ]);
    assert.ok(result.checks.every(c => c.ok || c.fix));
    assert.deepEqual(calls.filter(c => c.startsWith('gh')), []); // not a GitHub remote

    // On a GitHub remote, setup switches the default back with gh when it can.
    await gitOk(clone, ['config', 'remote.origin.url', 'https://github.com/someone/repo']);
    await gitOk(clone, ['config', `url.${remote}.insteadOf`, 'https://github.com/someone/repo']);
    const gh = fakeRunner(true, true);
    await setupRepo(clone, { plan: async () => newPlan('x'), runner: gh.runner });
    assert.deepEqual(gh.calls.filter(c => c.startsWith('gh')), ['gh repo edit someone/repo --default-branch main']);
    const fix = (await doctor(clone, { runner: gh.runner })).find(c => !c.ok)!.fix!;
    assert.match(fix, /gh repo edit someone\/repo --default-branch main.*https:\/\/github.com\/someone\/repo\/settings/);

    const cloud = await doctor(clone, { runner, env: { CLAUDE_CODE_REMOTE: 'true' } });
    assert.match(cloud[0].fix!, /setup script.*claude plugin install mvplanner@mvplanner/);
});

test('github repo names come from https and ssh remotes', () => {
    assert.equal(githubRepo('https://github.com/sirashton/no-sweat.git'), 'sirashton/no-sweat');
    assert.equal(githubRepo('git@github.com:sirashton/MVPlanner'), 'sirashton/MVPlanner');
    assert.equal(githubRepo('/tmp/remote.git'), undefined);
});
