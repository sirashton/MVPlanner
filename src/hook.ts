import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkMarkers, findMarkers, walk } from './core/index.ts';
import type { Plan } from './core/index.ts';
import { briefing, claimedBy } from './format.ts';
import { shouldScan } from './scan.ts';
import { configFromEnv, openStore } from './storage/stores.ts';
import type { PlanStore } from './storage/stores.ts';

// Claude Code hook handler: `hook.js <EventName>` with the hook input as JSON on stdin.
// Hooks must never break a session, so anything unexpected ends in a silent exit 0.

export interface HookInput {
    session_id?: string;
    cwd?: string;
    hook_event_name?: string;
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    stop_hook_active?: boolean;
    agent_id?: string;
    source?: string;
}

export type Strictness = 'off' | 'warn' | 'enforce';

export interface HookContext {
    input: HookInput;
    strictness: Strictness;
    store: PlanStore;
    stateDir: string;
    // This session's agent id, from agentId and the session's owner record.
    agent: string;
}

type HookOutput = Record<string, unknown> | undefined;

export function agentId(input: HookInput): string {
    const session = (input.session_id ?? 'unknown').slice(0, 8);
    return input.agent_id ? `claude-${session}-${input.agent_id.slice(0, 8)}` : `claude-${session}`;
}

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return (error as NodeJS.ErrnoException).code === 'EPERM';
    }
}

// A claude process started from inside another session inherits that session's id, so both would get the same agent
// id. The first live process to use a session id owns it; any other process using it at the same time gets its pid
// added to the id. A resumed session finds its old owner gone and takes the id back.
export async function resolveAgentId(input: HookInput, stateDir: string, pid: number | undefined): Promise<string> {
    const base = agentId(input);
    if (!pid || !input.session_id) {
        return base;
    }
    const dir = path.join(stateDir, 'owners');
    const file = path.join(dir, `${input.session_id.replace(/[^\w-]/g, '')}.json`);
    await fs.mkdir(dir, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            await fs.writeFile(file, JSON.stringify({ pid }), { flag: 'wx' });
            return base;
        } catch {
            const owner = await fs.readFile(file, 'utf-8').then(text => (JSON.parse(text) as { pid?: number }).pid).catch(() => undefined);
            if (owner === pid) {
                return base;
            }
            if (owner && isRunning(owner)) {
                return `${base}-p${pid}`;
            }
            await fs.rm(file, { force: true });
        }
    }
    return base;
}

function editedFile(input: HookInput): string | undefined {
    const value = input.tool_input?.file_path ?? input.tool_input?.notebook_path;
    return typeof value === 'string' ? value : undefined;
}

// The text the agent is about to write, or just wrote.
function writtenText(input: HookInput): string {
    const tool = input.tool_input ?? {};
    const parts: unknown[] = [tool.content, tool.new_string, tool.new_source];
    if (Array.isArray(tool.edits)) {
        parts.push(...tool.edits.map((e: { new_string?: unknown }) => e?.new_string));
    }
    return parts.filter((p): p is string => typeof p === 'string').join('\n');
}

interface SessionState {
    pendingEditsSince?: string;
    files?: string[];
}

async function loadState(ctx: HookContext, agent: string): Promise<SessionState> {
    try {
        return JSON.parse(await fs.readFile(path.join(ctx.stateDir, `${agent}.json`), 'utf-8'));
    } catch {
        return {};
    }
}

async function saveState(ctx: HookContext, agent: string, state: SessionState) {
    await fs.mkdir(ctx.stateDir, { recursive: true });
    await fs.writeFile(path.join(ctx.stateDir, `${agent}.json`), JSON.stringify(state));
}

async function readPlan(ctx: HookContext, fresh = false): Promise<Plan | undefined> {
    try {
        return await ctx.store.read(fresh ? { fresh } : { localOnly: true });
    } catch {
        return undefined;
    }
}

async function sessionStart(ctx: HookContext): Promise<HookOutput> {
    const plan = await readPlan(ctx, true);
    if (!plan) {
        return undefined;
    }
    return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: briefing(plan, ctx.agent, ctx.store.describe()) } };
}

async function subagentStart(ctx: HookContext): Promise<HookOutput> {
    const plan = await readPlan(ctx);
    if (!plan) {
        return undefined;
    }
    return { hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: briefing(plan, ctx.agent, ctx.store.describe()) } };
}

async function preToolUse(ctx: HookContext): Promise<HookOutput> {
    const file = editedFile(ctx.input);
    const plan = await readPlan(ctx);
    if (!plan || !file) {
        return undefined;
    }
    const deny = (reason: string) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } });
    if (path.basename(file).toLowerCase() === 'plan.json') {
        return deny(`This repository's live plan is held in ${ctx.store.describe()}, and any plan.json here may be stale. Change the plan through the MVPlanner tools (task_update, task_propose, task_defer) instead of editing the file.`);
    }
    const agent = ctx.agent;
    if (claimedBy(plan, agent).length > 0) {
        return undefined;
    }
    const message = `You have no MVPlanner task claimed (your agent id is "${agent}"). Claim the task this edit belongs to with task_claim, or propose it with task_propose if it isn't in the plan.`;
    if (ctx.strictness === 'enforce') {
        return deny(message);
    }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message } };
}

async function postToolUse(ctx: HookContext): Promise<HookOutput> {
    const agent = ctx.agent;
    const plan = await readPlan(ctx);
    if (!plan) {
        return undefined;
    }
    const file = editedFile(ctx.input);
    const state = await loadState(ctx, agent);
    state.pendingEditsSince ??= new Date().toISOString();
    if (file && !(state.files ?? []).includes(file)) {
        state.files = [...(state.files ?? []), file];
    }
    await saveState(ctx, agent, state);

    if (file && !shouldScan(file)) {
        return undefined;
    }
    const problems = checkMarkers(plan, findMarkers(writtenText(ctx.input), file ? path.basename(file) : undefined));
    if (problems.length === 0) {
        return undefined;
    }
    return {
        decision: 'block',
        reason: `MVPlanner markers need fixing:\n${problems.map(p => `- ${p.message}`).join('\n')}\nEvery MVP()/TODO() marker must name an open task. Use task_defer to get an id for deferred work.`,
    };
}

async function stop(ctx: HookContext): Promise<HookOutput> {
    if (ctx.input.stop_hook_active) {
        return undefined;
    }
    const agent = ctx.agent;
    const state = await loadState(ctx, agent);
    if (!state.pendingEditsSince) {
        return undefined;
    }
    // One nudge per batch of edits: clear the state now so a session is never stuck in a loop.
    await saveState(ctx, agent, {});
    const plan = await readPlan(ctx, true);
    if (!plan) {
        return undefined;
    }
    const since = state.pendingEditsSince;
    const updated = [...walk(plan.root)].some(({ task }) => (task.log ?? []).some(entry => entry.agent === agent && entry.at >= since));
    if (updated) {
        return undefined;
    }
    const mine = claimedBy(plan, agent);
    const files = (state.files ?? []).slice(0, 5).join(', ');
    const target = mine.length
        ? `your task ${mine.map(t => t.id).join(', ')}`
        : 'the task this work belongs to (claim it first with task_claim, or propose it with task_propose)';
    return {
        decision: 'block',
        reason: `You edited ${files || 'files'} but haven't recorded progress in MVPlanner. Before finishing, call task_update for ${target} with its status, any acceptance criteria now met, and a one-line note.`,
    };
}

const HANDLERS: Record<string, (ctx: HookContext) => Promise<HookOutput>> = {
    SessionStart: sessionStart,
    SubagentStart: subagentStart,
    PreToolUse: preToolUse,
    PostToolUse: postToolUse,
    Stop: stop,
    SubagentStop: stop,
};

export async function runHook(event: string, input: HookInput, env: NodeJS.ProcessEnv = process.env): Promise<HookOutput> {
    const raw = (env.CLAUDE_PLUGIN_OPTION_STRICTNESS ?? env.MVPLANNER_STRICTNESS ?? 'warn').toLowerCase();
    const strictness: Strictness = raw === 'off' || raw === 'enforce' ? raw : 'warn';
    const handler = HANDLERS[event];
    if (!handler || strictness === 'off') {
        return undefined;
    }
    const cwd = input.cwd ?? process.cwd();
    const stateDir = path.join(env.CLAUDE_PLUGIN_DATA ?? path.join(os.tmpdir(), 'mvplanner'), 'sessions');
    const pid = Number(env.CLAUDE_PID) || undefined;
    const agent = await resolveAgentId(input, stateDir, pid).catch(() => agentId(input));
    return handler({ input, strictness, store: await openStore(cwd, configFromEnv(env)), stateDir, agent });
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf-8');
}

if (process.argv[1] && /hook\.(ts|js)$/.test(process.argv[1])) {
    try {
        const input = JSON.parse((await readStdin()) || '{}') as HookInput;
        const output = await runHook(process.argv[2] ?? input.hook_event_name ?? '', input);
        if (output) {
            process.stdout.write(JSON.stringify(output));
        }
    } catch (error) {
        if (process.env.MVPLANNER_DEBUG) {
            console.error(error);
        }
    }
    process.exit(0);
}
