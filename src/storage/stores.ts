import fs from 'node:fs/promises';
import path from 'node:path';
import { PlanError, parsePlan, serializePlan } from '../core/plan.ts';
import type { Plan } from '../core/types.ts';
import { git, gitOk, mainCheckout } from './git.ts';

export interface ReadOptions {
    fresh?: boolean;
    localOnly?: boolean;
}

export interface MutateResult<T> {
    plan: Plan;
    result: T;
}

// Everything that reads or writes the live plan goes through a store, so the tools and hooks behave the same
// whichever backend holds the plan.
export interface PlanStore {
    describe(): string;
    // fresh: fetch the latest copy from wherever the plan lives, instead of the last copy seen locally.
    // localOnly: never touch the network, for hooks that run on every edit.
    read(options?: ReadOptions): Promise<Plan>;
    // Applies fn to the latest plan and saves it, re-applying on a fresh copy if another writer got there first.
    mutate<T>(message: string, fn: (plan: Plan) => T): Promise<MutateResult<T>>;
}

const MAX_ATTEMPTS = 6;
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const PLAN_FILE = 'plan.json';

// The live plan on a dedicated branch of the repo's remote. Works from any checkout, worktree, cloud session or
// project that can reach the remote, and never touches the working tree.
export class GitBranchStore implements PlanStore {
    readonly cwd: string;
    readonly remote: string;
    readonly branch: string;

    constructor(cwd: string, remote = 'origin', branch = 'mvplanner/plan') {
        this.cwd = cwd;
        this.remote = remote;
        this.branch = branch;
    }

    private get trackingRef() {
        return `refs/remotes/${this.remote}/${this.branch}`;
    }

    describe() {
        return `branch ${this.branch} on ${this.remote}`;
    }

    private async fetch(): Promise<boolean> {
        let result = await git(this.cwd, ['fetch', '--quiet', '--no-tags', this.remote, `+refs/heads/${this.branch}:${this.trackingRef}`]);
        // Another process in the same clone may be updating the ref at the same moment.
        for (let attempt = 1; result.code !== 0 && /cannot lock ref|unable to lock/i.test(result.stderr) && attempt < MAX_ATTEMPTS; attempt++) {
            await sleep(50 * attempt + Math.random() * 100);
            result = await git(this.cwd, ['fetch', '--quiet', '--no-tags', this.remote, `+refs/heads/${this.branch}:${this.trackingRef}`]);
        }
        if (result.code === 0) {
            return true;
        }
        if (/couldn't find remote ref|not found/i.test(result.stderr)) {
            return false;
        }
        throw new PlanError(`Could not fetch the plan branch ${this.branch} from ${this.remote}: ${result.stderr.trim()}`);
    }

    private async head(): Promise<string | undefined> {
        const result = await git(this.cwd, ['rev-parse', '--verify', '--quiet', this.trackingRef]);
        return result.code === 0 ? result.stdout.trim() : undefined;
    }

    private async readAt(commit: string): Promise<Plan> {
        return parsePlan(await gitOk(this.cwd, ['show', `${commit}:${PLAN_FILE}`]));
    }

    private missing(): PlanError {
        return new PlanError(`There is no plan branch ${this.branch} on ${this.remote} yet. Ask a human to run "mvplan init". Don't create a plan file yourself.`);
    }

    async read(options: ReadOptions = {}): Promise<Plan> {
        if (!options.localOnly && (options.fresh || !(await this.head()))) {
            await this.fetch();
        }
        const head = await this.head();
        if (!head) {
            throw this.missing();
        }
        return this.readAt(head);
    }

    private async identity(): Promise<NodeJS.ProcessEnv> {
        const name = await git(this.cwd, ['config', 'user.name']);
        const email = await git(this.cwd, ['config', 'user.email']);
        return {
            ...(name.code === 0 ? {} : { GIT_AUTHOR_NAME: 'MVPlanner', GIT_COMMITTER_NAME: 'MVPlanner' }),
            ...(email.code === 0 ? {} : { GIT_AUTHOR_EMAIL: 'mvplanner@users.noreply.github.com', GIT_COMMITTER_EMAIL: 'mvplanner@users.noreply.github.com' }),
        };
    }

    // Builds a commit holding the given plan on top of parent (or as the first commit) without a checkout.
    private async commit(plan: Plan, message: string, parent?: string, extraFiles: Record<string, string> = {}): Promise<string> {
        const entries = new Map<string, string>();
        if (parent) {
            for (const line of (await gitOk(this.cwd, ['ls-tree', parent])).split('\n').filter(Boolean)) {
                const [meta, name] = line.split('\t');
                entries.set(name, meta);
            }
        }
        const files = { ...extraFiles, [PLAN_FILE]: serializePlan(plan) };
        for (const [name, content] of Object.entries(files)) {
            const blob = (await gitOk(this.cwd, ['hash-object', '-w', '--stdin'], content)).trim();
            entries.set(name, `100644 blob ${blob}`);
        }
        const treeInput = [...entries].map(([name, meta]) => `${meta}\t${name}`).join('\n') + '\n';
        const tree = (await gitOk(this.cwd, ['mktree'], treeInput)).trim();
        const args = ['commit-tree', tree, '-m', message, ...(parent ? ['-p', parent] : [])];
        return (await gitOk(this.cwd, args, undefined, await this.identity())).trim();
    }

    private async push(commit: string, parent?: string): Promise<boolean> {
        const lease = `--force-with-lease=refs/heads/${this.branch}:${parent ?? ''}`;
        const result = await git(this.cwd, ['push', '--quiet', '--no-verify', lease, this.remote, `${commit}:refs/heads/${this.branch}`]);
        if (result.code === 0) {
            // Best effort: the next fetch corrects the tracking ref if another process moved it meanwhile.
            await git(this.cwd, ['update-ref', this.trackingRef, commit]);
            return true;
        }
        if (/rejected|stale info|fetch first|non-fast-forward/i.test(result.stderr)) {
            return false;
        }
        throw new PlanError(`Could not push the plan branch ${this.branch}: ${result.stderr.trim()}`);
    }

    // Writes from one process go one at a time; writes from other processes are handled by retrying.
    private queue: Promise<unknown> = Promise.resolve();

    mutate<T>(message: string, fn: (plan: Plan) => T): Promise<MutateResult<T>> {
        const run = this.queue.then(() => this.mutateNow(message, fn));
        this.queue = run.catch(() => undefined);
        return run;
    }

    private async mutateNow<T>(message: string, fn: (plan: Plan) => T): Promise<MutateResult<T>> {
        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            await this.fetch();
            const parent = await this.head();
            if (!parent) {
                throw this.missing();
            }
            const plan = await this.readAt(parent);
            const result = fn(plan);
            plan.revision += 1;
            const commit = await this.commit(plan, message, parent);
            if (await this.push(commit, parent)) {
                return { plan, result };
            }
            await sleep(150 * attempt + Math.random() * 200);
        }
        throw new PlanError(`Gave up saving the plan after ${MAX_ATTEMPTS} attempts; other agents are writing it heavily. Try again shortly.`);
    }

    // Creates the plan branch from a plan. Refuses if it already exists.
    async init(plan: Plan): Promise<void> {
        if (await this.fetch()) {
            throw new PlanError(`The plan branch ${this.branch} already exists on ${this.remote}.`);
        }
        const readme = [
            '# MVPlanner live plan',
            '',
            `This branch holds the live plan for this repository. Agents read and change it through the MVPlanner tools`,
            '(the Claude Code plugin or the `mvplan` CLI), which commit here directly. Never merge this branch into',
            'a feature branch, and never edit `plan.json` by hand while agents are working.',
            '',
        ].join('\n');
        const commit = await this.commit(plan, 'Start the MVPlanner plan', undefined, { 'README.md': readme });
        if (!(await this.push(commit))) {
            throw new PlanError(`Someone else created ${this.branch} at the same moment; run "mvplan where" and check it.`);
        }
    }
}

// A single plan file, for one machine. The file lives in the main checkout so every worktree shares it.
export class FileStore implements PlanStore {
    readonly file: string;

    constructor(file: string) {
        this.file = file;
    }

    describe() {
        return `file ${this.file}`;
    }

    async read(): Promise<Plan> {
        let text: string;
        try {
            text = await fs.readFile(this.file, 'utf-8');
        } catch {
            throw new PlanError(`No plan at ${this.file}. Ask a human to run "mvplan init". Don't create a plan file yourself.`);
        }
        return parsePlan(text);
    }

    private async lock(): Promise<() => Promise<void>> {
        const lockFile = `${this.file}.lock`;
        for (let attempt = 0; attempt < 100; attempt++) {
            try {
                const handle = await fs.open(lockFile, 'wx');
                await handle.close();
                return () => fs.rm(lockFile, { force: true });
            } catch {
                const stat = await fs.stat(lockFile).catch(() => undefined);
                if (stat && Date.now() - stat.mtimeMs > 10_000) {
                    await fs.rm(lockFile, { force: true });
                    continue;
                }
                await sleep(50);
            }
        }
        throw new PlanError(`Timed out waiting for ${lockFile}. If no agent is writing the plan, delete that file.`);
    }

    async write(plan: Plan): Promise<void> {
        const temp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(temp, serializePlan(plan), 'utf-8');
        await fs.rename(temp, this.file);
    }

    async mutate<T>(_message: string, fn: (plan: Plan) => T): Promise<MutateResult<T>> {
        const unlock = await this.lock();
        try {
            const plan = await this.read();
            const result = fn(plan);
            plan.revision += 1;
            await this.write(plan);
            return { plan, result };
        } finally {
            await unlock();
        }
    }
}

export interface StoreConfig {
    backend: 'git' | 'file';
    remote: string;
    branch: string;
    file?: string;
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): StoreConfig {
    // The plugin passes its settings through as MVPLANNER_* (MCP server) or CLAUDE_PLUGIN_OPTION_* (hooks).
    const pick = (name: string) => env[`MVPLANNER_${name}`] || env[`CLAUDE_PLUGIN_OPTION_${name}`] || undefined;
    const backend = pick('BACKEND') === 'file' ? 'file' : 'git';
    return { backend, remote: pick('REMOTE') ?? 'origin', branch: pick('BRANCH') ?? 'mvplanner/plan', file: pick('PLAN_FILE') };
}

export async function openStore(cwd: string, config: StoreConfig = configFromEnv()): Promise<PlanStore> {
    if (config.backend === 'file') {
        const base = (await mainCheckout(cwd)) ?? cwd;
        return new FileStore(config.file ? path.resolve(base, config.file) : path.join(base, PLAN_FILE));
    }
    return new GitBranchStore(cwd, config.remote, config.branch);
}
