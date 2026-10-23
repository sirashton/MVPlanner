import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
    MSCW, PlanError, STATUSES, addTask, applyEdits, checkMarkers, claimTask, criticalPath, deferTask, findMarkers, getTask, nextTasks,
    crowdingHint, needHint, parentsWithoutNeed, proposeTask, releaseTask, taskPath, updateTask,
} from './core/index.ts';
import { renderNeedless, renderNext, renderTask, renderTree } from './format.ts';
import { scanRepo } from './scan.ts';
import { currentSession } from './session.ts';
import { currentBranch, repoTopLevel } from './storage/git.ts';
import { openStore } from './storage/stores.ts';
import type { PlanStore } from './storage/stores.ts';

const VERSION = '0.2.0';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const text = (value: string): ToolResult => ({ content: [{ type: 'text', text: value }] });

async function guarded(fn: () => Promise<string>): Promise<ToolResult> {
    try {
        return text(await fn());
    } catch (error) {
        const message = error instanceof PlanError ? error.message : `Unexpected error: ${(error as Error).message}`;
        return { ...text(message), isError: true };
    }
}

const PARENT_HINT = 'The most specific task this belongs under: a themed group such as "Page looks polished" when one fits, rather than the top-level feature';
const agentArg = z.string().min(1).describe('Your agent id, as given in your MVPlanner briefing');
const idArg = z.string().regex(/^T-\d+$/).describe('Task id, such as T-12');
const needArg = z.string().describe('The need or outcome this task meets, like a user story: "People can reshape the plan quickly, so a scoping session keeps pace". Its subtasks are what that need takes');
const mscwArg = z.enum(MSCW).describe("Priority relative to the parent task: Must, Should, Could or Won't");

export function createServer(cwd: string, storePromise: Promise<PlanStore> = openStore(cwd)): McpServer {
    const server = new McpServer({ name: 'mvplanner', version: VERSION });

    server.registerTool('plan_overview', {
        description: 'Show the live plan as a tree with each task\'s status, priority and do-more level. By default only the critical path and claimed work are shown.',
        inputSchema: { all: z.boolean().optional().describe('Show every task, not just the critical path') },
    }, ({ all }) => guarded(async () => renderTree(await (await storePromise).read({ fresh: true }), { all })));

    server.registerTool('plan_next', {
        description: 'List the most important unfinished tasks: leaves on the critical path, unclaimed first. Use this to pick what to work on.',
        inputSchema: { agent: agentArg.optional(), limit: z.number().int().min(1).max(20).optional() },
    }, ({ agent, limit }) => guarded(async () => renderNext(nextTasks(await (await storePromise).read({ fresh: true }), { agent }), limit ?? 5)));

    server.registerTool('task_get', {
        description: 'Show one task in full: description, acceptance criteria, claim, dependencies, subtasks and recent log.',
        inputSchema: { id: idArg },
    }, ({ id }) => guarded(async () => {
        const plan = await (await storePromise).read({ fresh: true });
        return renderTask(plan, getTask(plan, id), taskPath(plan, id));
    }));

    server.registerTool('task_claim', {
        description: 'Claim a task before editing any code for it. Fails if another agent holds it, unless their claim has been quiet for 2 hours, in which case you take it over. One task at a time.',
        inputSchema: { id: idArg, agent: agentArg },
    }, ({ id, agent }) => guarded(async () => {
        const branch = await currentBranch(cwd);
        const { plan, result } = await (await storePromise).mutate(`${agent} claims ${id}`, p => claimTask(p, id, agent, branch, currentSession()));
        const offPath = !criticalPath(plan).has(id)
            ? '\n\nNote: this task is not on the critical path, so more important work is still open. Check plan_next unless a human asked for this one.'
            : '';
        return `Claimed ${id}.${offPath}\n\n${renderTask(plan, result, taskPath(plan, id))}`;
    }));

    server.registerTool('task_release', {
        description: 'Give up a claimed task without finishing it, with a note on where it stands.',
        inputSchema: { id: idArg, agent: agentArg, note: z.string().optional() },
    }, ({ id, agent, note }) => guarded(async () => {
        await (await storePromise).mutate(`${agent} releases ${id}`, p => releaseTask(p, id, agent, note));
        return `Released ${id}.`;
    }));

    server.registerTool('task_update', {
        description: 'Update your task: status, checked acceptance criteria, links to PRs or commits, and a short progress note. Completing a task requires every acceptance criterion to be checked, and a handoff note.',
        inputSchema: {
            id: idArg,
            agent: agentArg,
            status: z.enum(STATUSES).optional(),
            note: z.string().optional().describe('What changed, in a sentence. When completing, a handoff note for the next agent: what changed, decisions and why, gotchas, what you left out (with T-ids) and where to look'),
            acceptance_done: z.array(z.number().int().min(0)).optional().describe('Indexes of acceptance criteria now met'),
            links: z.array(z.string()).optional().describe('PR or commit URLs'),
        },
    }, ({ id, agent, status, note, acceptance_done, links }) => guarded(async () => {
        if (status === 'Complete' && !note?.trim()) {
            throw new PlanError(`Completing ${id} needs a handoff note: what changed, decisions and why, gotchas, what you left out (with T-ids) and where to look.`);
        }
        const { plan, result } = await (await storePromise).mutate(`${agent} updates ${id}`, p =>
            updateTask(p, id, agent, { status, note, acceptanceDone: acceptance_done, links }));
        return renderTask(plan, result, taskPath(plan, id));
    }));

    server.registerTool('task_propose', {
        description: 'Propose new work as a subtask instead of building it. Proposals do not count towards the plan until a human accepts them.',
        inputSchema: {
            parent: idArg.describe(PARENT_HINT),
            agent: agentArg,
            name: z.string().min(1),
            description: z.string().optional(),
            mscw: mscwArg.optional(),
            acceptance: z.array(z.string()).optional().describe('How we will know it is done'),
        },
    }, ({ parent, agent, name, description, mscw, acceptance }) => guarded(async () => {
        const { plan, result } = await (await storePromise).mutate(`${agent} proposes "${name}"`, p =>
            proposeTask(p, parent, agent, { name, description, mscw, acceptance }));
        return `Proposed as ${result.id} under ${parent}. Carry on with your claimed task; a human will accept or decline it.${crowdingHint(plan, [parent])}${needHint(plan, [parent])}`;
    }));

    server.registerTool('task_add', {
        description: 'Add agreed tasks to the plan directly. Only use this when a human has approved this exact breakdown in the current conversation; otherwise use task_propose.',
        inputSchema: {
            parent: idArg.describe(PARENT_HINT),
            agent: agentArg,
            approved_by: z.string().min(1).describe('Who approved this breakdown, and where, such as "Alex, in this conversation"'),
            tasks: z.array(z.object({
                name: z.string().min(1),
                description: z.string().optional(),
                need: needArg.optional(),
                mscw: mscwArg.optional().describe('Defaults to Must'),
                acceptance: z.array(z.string()).optional(),
                dependsOn: z.array(z.string()).optional(),
            })).min(1),
        },
    }, ({ parent, agent, approved_by, tasks }) => guarded(async () => {
        const { plan, result } = await (await storePromise).mutate(`${agent} adds ${tasks.length} task(s) approved by ${approved_by}`, p =>
            tasks.map(spec => addTask(p, parent, agent, spec, approved_by)));
        return `Added ${result.map(t => `${t.id} ${t.name}`).join(', ')} under ${parent}.${crowdingHint(plan, [parent])}${needHint(plan, [parent])}`;
    }));

    server.registerTool('task_defer', {
        description: 'Record work you are deliberately leaving minimal or postponing. Returns an id; leave MVP(<id>) on a deliberately simple implementation or TODO(<id>) on postponed work, in a code comment.',
        inputSchema: {
            parent: idArg.describe('Usually your claimed task, or the themed group under it that this fits'),
            agent: agentArg,
            name: z.string().min(1).describe('What the fuller version would do'),
            trigger: z.string().optional().describe('What would justify doing more, such as "users ask for filtering"'),
            files: z.array(z.string()).optional().describe('Files that will carry the marker'),
            mscw: mscwArg.optional().describe('Defaults to Could'),
        },
    }, ({ parent, agent, name, trigger, files, mscw }) => guarded(async () => {
        const { plan, result } = await (await storePromise).mutate(`${agent} defers "${name}"`, p =>
            deferTask(p, parent, agent, { name, trigger, files, mscw }));
        return `Deferred as ${result.id} (${result.mscw}). Write MVP(${result.id}) or TODO(${result.id}) in the comment at the spot in the code.${crowdingHint(plan, [parent])}`;
    }));

    const ref = z.string().min(1).describe('A task id such as T-12, or "$ref" for a task added earlier in this batch');
    server.registerTool('plan_edit', {
        description: 'Change the shape of the plan in one quick save: add, update, move or remove tasks, and accept or decline proposals. '
            + 'Only use this while a human is directing the plan in this conversation, such as a scoping session; otherwise use task_propose. '
            + 'Batch every change from one exchange into a single call. Prefer setting a task to Won\'t over removing it, so the decision is kept. '
            + 'Keep parents to a handful of subtasks: put related work under a themed parent named for the outcome, adding it with a ref in the same call.',
        inputSchema: {
            agent: agentArg,
            approved_by: z.string().min(1).describe('Who is directing these changes, and where, such as "Alex, in this conversation"'),
            edits: z.array(z.discriminatedUnion('op', [
                z.object({
                    op: z.literal('add'), parent: ref.describe(`${PARENT_HINT}. A task id, or "$ref" for a task added earlier in this batch`), ref: z.string().optional().describe('Name this task so later edits can use "$name"'),
                    name: z.string().min(1), description: z.string().optional(), need: needArg.optional(), mscw: mscwArg.optional().describe('Defaults to Must'),
                    acceptance: z.array(z.string()).optional(), dependsOn: z.array(z.string()).optional(),
                }),
                z.object({
                    op: z.literal('update'), id: ref, status: z.enum(STATUSES).optional(), mscw: mscwArg.optional(),
                    name: z.string().min(1).optional(), description: z.string().optional(), need: needArg.optional(), note: z.string().optional(),
                }),
                z.object({ op: z.literal('move'), id: ref, parent: ref, position: z.number().int().min(0).optional().describe('Index among the new siblings; defaults to last') }),
                z.object({ op: z.literal('remove'), id: ref }),
                z.object({ op: z.literal('accept'), id: ref, mscw: mscwArg.optional() }),
                z.object({ op: z.literal('decline'), id: ref }),
            ])).min(1),
        },
    }, ({ agent, approved_by, edits }) => guarded(async () => {
        const { plan, result } = await (await storePromise).mutate(`${agent} applies ${edits.length} edit(s) directed by ${approved_by}`, p =>
            applyEdits(p, agent, edits, approved_by));
        // Parents named by "$ref" are new in this batch, so only existing parents can have grown crowded.
        const parents = edits.flatMap(edit => (edit.op === 'add' || edit.op === 'move') && !edit.parent.startsWith('$') ? [edit.parent] : []);
        return `${result.join('\n')}\n\nPlan is now at revision ${plan.revision}.${crowdingHint(plan, parents)}${needHint(plan, parents)}`;
    }));

    server.registerTool('plan_check', {
        description: 'Check MVP()/TODO() markers against the plan: in one snippet of code if given, otherwise across the whole repository, along with parent tasks that don\'t state the need they meet.',
        inputSchema: { source: z.string().optional(), file: z.string().optional() },
    }, ({ source, file }) => guarded(async () => {
        const plan = await (await storePromise).read({ fresh: true });
        const markers = source !== undefined ? findMarkers(source, file) : await scanRepo((await repoTopLevel(cwd)) ?? cwd);
        const problems = checkMarkers(plan, markers);
        const report = problems.length
            ? problems.map(p => p.message).join('\n')
            : `No problems; ${markers.filter(m => m.id).length} linked marker(s) point at open tasks.`;
        return source !== undefined ? report : `${report}${renderNeedless(parentsWithoutNeed(plan))}`;
    }));

    return server;
}

if (process.argv[1] && /mcp\.(ts|js)$/.test(process.argv[1])) {
    const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
    await createServer(cwd).connect(new StdioServerTransport());
}
