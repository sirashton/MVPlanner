import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PlanError } from './core/plan.ts';
import type { Plan } from './core/types.ts';
import { CLAUDE_MD_MARKER, SETUP_FILES, setupFileChanges } from './setup.ts';
import { git, gitOk } from './storage/git.ts';
import { GitBranchStore } from './storage/stores.ts';

// One-step setup of a repo for MVPlanner, and the checks that say whether it worked.
// Order matters in an empty repo: GitHub makes the first branch pushed the default, so the setup files go to main
// before the plan branch is created.

export const SETUP_SCRIPT_LINE = 'claude plugin marketplace add sirashton/MVPlanner && claude plugin install mvplanner@mvplanner';
const PAGE_URL = 'http://127.0.0.1:4747';

export interface Check {
    name: string;
    ok: boolean;
    detail?: string;
    fix?: string;
}

interface Runner {
    (command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string }>;
}

const run: Runner = (command, args, cwd) => new Promise(resolve => {
    execFile(command, args, { cwd, timeout: 30_000 }, (error, stdout) => {
        resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: stdout?.toString() ?? '' });
    });
});

export function githubRepo(url: string): string | undefined {
    return /github\.com[:/]+([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url.trim())?.[1];
}

// The branch the remote's HEAD points at, or undefined when the remote has no branches yet (or doesn't say).
export async function remoteDefaultBranch(cwd: string, remote: string): Promise<string | undefined> {
    const result = await git(cwd, ['ls-remote', '--symref', remote, 'HEAD']);
    if (result.code !== 0) {
        throw new PlanError(`Could not reach ${remote}: ${result.stderr.trim()}`);
    }
    return /^ref: refs\/heads\/(\S+)\s+HEAD/m.exec(result.stdout)?.[1];
}

async function remoteBranches(cwd: string, remote: string): Promise<string[]> {
    const out = await gitOk(cwd, ['ls-remote', '--heads', remote]);
    return out.split('\n').filter(Boolean).map(line => line.split('\t')[1].replace(/^refs\/heads\//, ''));
}

async function identity(cwd: string): Promise<NodeJS.ProcessEnv> {
    const name = await git(cwd, ['config', 'user.name']);
    const email = await git(cwd, ['config', 'user.email']);
    return {
        ...(name.code === 0 ? {} : { GIT_AUTHOR_NAME: 'MVPlanner', GIT_COMMITTER_NAME: 'MVPlanner' }),
        ...(email.code === 0 ? {} : { GIT_AUTHOR_EMAIL: 'mvplanner@users.noreply.github.com', GIT_COMMITTER_EMAIL: 'mvplanner@users.noreply.github.com' }),
    };
}

async function readAt(cwd: string, commit: string | undefined, file: string): Promise<string | undefined> {
    if (!commit) {
        return undefined;
    }
    const result = await git(cwd, ['show', `${commit}:${file}`]);
    return result.code === 0 ? result.stdout : undefined;
}

// A commit on top of parent (or a first commit) with the given files changed, built without touching the checkout.
async function commitFiles(cwd: string, parent: string | undefined, files: Record<string, string>, message: string): Promise<string> {
    const index = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'mvplanner-index-')), 'index');
    const env = { GIT_INDEX_FILE: index };
    try {
        await gitOk(cwd, parent ? ['read-tree', parent] : ['read-tree', '--empty'], undefined, env);
        for (const [file, content] of Object.entries(files)) {
            const blob = (await gitOk(cwd, ['hash-object', '-w', '--stdin'], content)).trim();
            await gitOk(cwd, ['update-index', '--add', '--cacheinfo', `100644,${blob},${file}`], undefined, env);
        }
        const tree = (await gitOk(cwd, ['write-tree'], undefined, env)).trim();
        return (await gitOk(cwd, ['commit-tree', tree, '-m', message, ...(parent ? ['-p', parent] : [])], undefined, await identity(cwd))).trim();
    } finally {
        await fs.rm(path.dirname(index), { recursive: true, force: true });
    }
}

export interface SetupOptions {
    plan: () => Promise<Plan>;
    remote?: string;
    planBranch?: string;
    runner?: Runner;
}

export interface SetupResult {
    lines: string[];
    checks: Check[];
    ok: boolean;
}

export async function setupRepo(cwd: string, options: SetupOptions): Promise<SetupResult> {
    const remote = options.remote ?? 'origin';
    const planBranch = options.planBranch ?? 'mvplanner/plan';
    const runner = options.runner ?? run;
    const lines: string[] = [];
    if ((await git(cwd, ['remote', 'get-url', remote])).code !== 0) {
        throw new PlanError(`This repo has no "${remote}" remote. Create the repo on GitHub, run "git remote add ${remote} <url>", then run this again.`);
    }

    // 1. Work out the default branch. An empty remote gets the current branch if it has commits, otherwise main.
    const branches = await remoteBranches(cwd, remote);
    const local = (await git(cwd, ['symbolic-ref', '--short', 'HEAD'])).stdout.trim() || undefined;
    const localHead = (await git(cwd, ['rev-parse', '--verify', '--quiet', 'HEAD'])).stdout.trim() || undefined;
    let defaultBranch = branches.length ? await remoteDefaultBranch(cwd, remote) : undefined;
    if (!defaultBranch || defaultBranch === planBranch) {
        const others = branches.filter(b => b !== planBranch);
        defaultBranch = ['main', 'master'].find(b => others.includes(b)) ?? others[0] ?? (localHead && local ? local : 'main');
    }

    // 2. Push the setup files to the default branch first, so in an empty repo it becomes GitHub's default.
    let parent: string | undefined;
    if (branches.includes(defaultBranch)) {
        await gitOk(cwd, ['fetch', '--quiet', '--no-tags', remote, `+refs/heads/${defaultBranch}:refs/remotes/${remote}/${defaultBranch}`]);
        parent = (await gitOk(cwd, ['rev-parse', `refs/remotes/${remote}/${defaultBranch}`])).trim();
    } else {
        parent = localHead;
    }
    const current: Record<string, string | undefined> = {};
    for (const file of SETUP_FILES) {
        current[file] = await readAt(cwd, parent, file);
    }
    const changes = setupFileChanges(current);
    const changed = Object.keys(changes);
    if (changed.length) {
        const commit = await commitFiles(cwd, parent, changes, 'Set up MVPlanner\n\nSwitches the MVPlanner plugin on for every Claude Code session in this repo.');
        const pushed = await git(cwd, ['push', '--quiet', '--no-verify', remote, `${commit}:refs/heads/${defaultBranch}`]);
        if (pushed.code !== 0) {
            throw new PlanError(`Could not push the setup files to ${defaultBranch}: ${pushed.stderr.trim()}\n`
                + `Fix: give this checkout push access to ${defaultBranch}, or run "mvplan setup --files-only", commit the files in a pull request, merge it, then run "mvplan setup" again.`);
        }
        await git(cwd, ['update-ref', `refs/remotes/${remote}/${defaultBranch}`, commit]);
        lines.push(`Pushed ${listOf(changed)} to ${defaultBranch}, so every Claude Code session here loads MVPlanner.`);
    } else {
        lines.push(`${defaultBranch} already switches MVPlanner on.`);
    }

    // 3. Bring the checkout up to date when it is on the default branch (or has no commits yet).
    if (changed.length) {
        lines.push(await syncCheckout(cwd, remote, defaultBranch, local, localHead));
    }

    // 4. Create the plan branch, now that the default branch exists.
    const store = new GitBranchStore(cwd, remote, planBranch);
    if (branches.includes(planBranch)) {
        lines.push(`The live plan is already on ${planBranch}.`);
    } else {
        await store.init(await options.plan());
        lines.push(`Created the live plan on ${planBranch}.`);
    }

    // 5. Older setups left the plan branch as GitHub's default. Switch it back if the gh CLI can.
    const repo = githubRepo((await git(cwd, ['config', `remote.${remote}.url`])).stdout);
    if (repo && (await remoteDefaultBranch(cwd, remote)) === planBranch) {
        const fixed = await runner('gh', ['repo', 'edit', repo, '--default-branch', defaultBranch], cwd).catch(() => ({ code: 1, stdout: '' }));
        if (fixed.code === 0) {
            lines.push(`Switched GitHub's default branch from ${planBranch} to ${defaultBranch}.`);
        }
    }

    const checks = await doctor(cwd, { remote, planBranch, runner, defaultBranch });
    return { lines, checks, ok: checks.every(c => c.ok) };
}

async function syncCheckout(cwd: string, remote: string, branch: string, local: string | undefined, localHead: string | undefined): Promise<string> {
    const target = `refs/remotes/${remote}/${branch}`;
    if (!localHead) {
        const result = await git(cwd, ['checkout', '--quiet', '-B', branch, '--track', target]);
        return result.code === 0
            ? `This checkout is now on ${branch} with the setup files.`
            : `Run "git checkout ${branch}" to get the setup files in this checkout.`;
    }
    if (local === branch) {
        const result = await git(cwd, ['merge', '--quiet', '--ff-only', target]);
        return result.code === 0 ? `Updated this checkout's ${branch}.` : `Run "git pull" on ${branch} to get the setup files in this checkout.`;
    }
    return `This checkout is on ${local ?? 'a detached HEAD'}; merge ${branch} into it to get the setup files here.`;
}

function listOf(items: string[]): string {
    return items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0];
}

export interface DoctorOptions {
    remote?: string;
    planBranch?: string;
    runner?: Runner;
    defaultBranch?: string;
    env?: NodeJS.ProcessEnv;
}

export async function doctor(cwd: string, options: DoctorOptions = {}): Promise<Check[]> {
    const remote = options.remote ?? 'origin';
    const planBranch = options.planBranch ?? 'mvplanner/plan';
    const runner = options.runner ?? run;
    const env = options.env ?? process.env;
    const checks: Check[] = [];
    const repo = githubRepo((await git(cwd, ['config', `remote.${remote}.url`])).stdout);
    const cloud = env.CLAUDE_CODE_REMOTE === 'true';

    // This machine has the plugin.
    const list = await runner('claude', ['plugin', 'list'], cwd).catch(() => ({ code: 1, stdout: '' }));
    const enabled = list.code === 0 && list.stdout.split(/^\s*>\s*/m).some(block => block.startsWith('mvplanner@mvplanner') && /Status:.*\benabled/.test(block));
    checks.push({
        name: 'The MVPlanner plugin is on for Claude Code here',
        ok: enabled,
        detail: list.code === 0 ? undefined : 'Could not run "claude plugin list".',
        fix: cloud
            ? `Add this line to the cloud environment's setup script, then start a new session: ${SETUP_SCRIPT_LINE}`
            : 'In Claude Code, run /plugin install mvplanner@mvplanner, then /reload-plugins.',
    });

    // The default branch exists and isn't the plan branch.
    let defaultBranch: string | undefined;
    try {
        defaultBranch = await remoteDefaultBranch(cwd, remote);
    } catch (error) {
        checks.push({ name: `${remote} can be reached`, ok: false, detail: (error as Error).message, fix: 'Check the remote URL and your GitHub sign-in, then run "mvplan doctor" again.' });
        return checks;
    }
    const expected = options.defaultBranch ?? 'main';
    checks.push({
        name: `GitHub's default branch is not the plan branch${defaultBranch ? ` (it is ${defaultBranch})` : ''}`,
        ok: defaultBranch !== undefined && defaultBranch !== planBranch,
        fix: defaultBranch === undefined
            ? 'The repo has no branches yet: run "mvplan setup".'
            : repo
                ? `Run "gh repo edit ${repo} --default-branch ${expected}", or pick ${expected} under Default branch at https://github.com/${repo}/settings`
                : `Make ${expected} the remote's default branch.`,
    });

    // The default branch switches the plugin on for everyone.
    // When the default is wrong, look at the branch it should be, so the fix above is the only one asked for.
    const usable = defaultBranch && defaultBranch !== planBranch ? defaultBranch : expected;
    let filesOk = false;
    {
        const fetched = await git(cwd, ['fetch', '--quiet', '--no-tags', remote, `+refs/heads/${usable}:refs/remotes/${remote}/${usable}`]);
        if (fetched.code === 0) {
            const at = `refs/remotes/${remote}/${usable}`;
            const settings = await readAt(cwd, at, '.claude/settings.json');
            const claudeMd = await readAt(cwd, at, 'CLAUDE.md');
            filesOk = !!settings && /"mvplanner@mvplanner"\s*:\s*true/.test(settings) && !!claudeMd?.includes(CLAUDE_MD_MARKER);
        }
    }
    checks.push({
        name: `${usable} has the MVPlanner setup files`,
        ok: filesOk,
        fix: 'Run "mvplan setup".',
    });

    // The plan can be read, and pushed to.
    const store = new GitBranchStore(cwd, remote, planBranch);
    let readable = false;
    let readError = '';
    try {
        await store.read({ fresh: true });
        readable = true;
    } catch (error) {
        readError = (error as Error).message;
    }
    checks.push({
        name: `The plan on ${planBranch} can be read`,
        ok: readable,
        detail: readable ? undefined : readError,
        fix: /no plan branch/i.test(readError) ? 'Run "mvplan setup".' : 'Check you can fetch from the repo (git fetch), then run "mvplan doctor" again.',
    });
    if (readable) {
        const push = await git(cwd, ['push', '--dry-run', '--quiet', remote, `refs/remotes/${remote}/${planBranch}:refs/heads/${planBranch}`]);
        checks.push({
            name: `This checkout can push to ${planBranch}`,
            ok: push.code === 0,
            detail: push.code === 0 ? undefined : push.stderr.trim(),
            fix: cloud
                ? 'Give this cloud environment write access to the repo (Connect GitHub at https://claude.ai/connect-github), then start a new session.'
                : 'Sign in to GitHub with an account that can push to this repo.',
        });
    }
    return checks;
}

export function renderChecks(checks: Check[]): string {
    return checks.map(c => {
        const head = `  ${c.ok ? '✓' : '✗'} ${c.name}`;
        if (c.ok) {
            return head;
        }
        return [head, ...(c.detail ? [`      ${c.detail}`] : []), ...(c.fix ? [`      Fix: ${c.fix}`] : [])].join('\n');
    }).join('\n');
}

export function renderSetup(result: SetupResult): string {
    return [
        ...result.lines,
        '',
        'Checks',
        renderChecks(result.checks),
        '',
        result.ok ? 'MVPlanner is ready. Next:' : 'Fix the ✗ above, then run "mvplan doctor". After that:',
        `  Cloud sessions: add this line to the cloud environment's setup script, so they load the plugin:`,
        `      ${SETUP_SCRIPT_LINE}`,
        `  The plan page: run "mvplan serve" in this repo on your PC, and it opens ${PAGE_URL} (or another free port if that one is taken).`,
        '  Then shape the product with /mvplanner:scope.',
    ].join('\n');
}
