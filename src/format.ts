import { computeDoMore, criticalPath, nextTasks, overallLevel } from './core/domore.ts';
import type { NextTask } from './core/domore.ts';
import { isClaimStale } from './core/ops.ts';
import type { Plan, Task } from './core/types.ts';

const STATUS_MARK: Record<string, string> = { 'Not Started': ' ', 'In Progress': '~', Complete: 'x', Blocked: '!' };

function badges(task: Task): string {
    const parts: string[] = [];
    if (task.claimedBy) {
        parts.push(`claimed by ${task.claimedBy.agent}`);
    }
    if (task.proposed) {
        parts.push('proposed');
    }
    if (task.deferred) {
        parts.push('deferred');
    }
    if (task.dependsOn?.length) {
        parts.push(`needs ${task.dependsOn.join(', ')}`);
    }
    return parts.length ? `  (${parts.join('; ')})` : '';
}

// A tree view. By default it shows the critical path and anything claimed; all = every task.
export function renderTree(plan: Plan, options: { all?: boolean } = {}): string {
    const doMore = computeDoMore(plan.root);
    const onPath = criticalPath(plan, doMore);
    const lines: string[] = [];
    let hidden = 0;
    const visit = (task: Task, depth: number) => {
        const marker = onPath.has(task.id) ? '*' : ' ';
        lines.push(`${'  '.repeat(depth)}[${STATUS_MARK[task.status] ?? '?'}]${marker}${task.id} ${task.name} — ${task.mscw}, do more: ${doMore.get(task.id)}${badges(task)}`);
        for (const sub of task.subtasks ?? []) {
            const interesting = options.all || onPath.has(sub.id) || sub.claimedBy || sub.status === 'In Progress';
            if (interesting) {
                visit(sub, depth + 1);
            } else {
                hidden += 1;
            }
        }
    };
    visit(plan.root, 0);
    const header = `${plan.root.name}: ${describeLevel(overallLevel(plan))} (revision ${plan.revision})`;
    const footer = hidden && !options.all ? `\n(${hidden} branches off the critical path hidden; use --all to see them)` : '';
    return `${header}\n[ ] not started  [~] in progress  [x] complete  [!] blocked  * critical path\n\n${lines.join('\n')}${footer}`;
}

export function describeLevel(level: string): string {
    switch (level) {
        case 'Must': return 'Must work remains';
        case 'Should': return 'done all we Must; Should work remains';
        case 'Could': return 'done all we Must and Should; Could work remains';
        case "Won't": return "done all we Must, Should and Could; only Won't items are left";
        default: return 'everything is done';
    }
}

export function renderTask(plan: Plan, task: Task, path?: string): string {
    const doMore = computeDoMore(plan.root);
    const lines = [`${task.id} ${task.name}`];
    if (path) {
        lines.push(`Path: ${path}`);
    }
    lines.push(`Status: ${task.status}. Priority: ${task.mscw} (relative to its parent). Do more: ${doMore.get(task.id)}.`);
    if (task.need) {
        lines.push(`Need it meets: ${task.need}`);
    }
    if (task.serves) {
        lines.push(`Serves: ${task.serves}`);
    }
    if (task.description) {
        lines.push(`Description: ${task.description}`);
    }
    if (task.claimedBy) {
        lines.push(`Claimed by ${task.claimedBy.agent}${task.claimedBy.branch ? ` on ${task.claimedBy.branch}` : ''} at ${task.claimedBy.at}.${task.claimedBy.session ? ` Session: ${task.claimedBy.session}` : ''}`);
    }
    if (task.acceptance?.length) {
        lines.push('Acceptance criteria:');
        task.acceptance.forEach((c, i) => lines.push(`  ${i}. [${c.done ? 'x' : ' '}] ${c.text}`));
    }
    if (task.dependsOn?.length) {
        lines.push(`Depends on: ${task.dependsOn.join(', ')}`);
    }
    if (task.deferred) {
        lines.push(`Deferred work${task.deferred.trigger ? `; expand when: ${task.deferred.trigger}` : ''}${task.deferred.files?.length ? `. Markers in: ${task.deferred.files.join(', ')}` : ''}.`);
    }
    if (task.scope?.length) {
        lines.push(`Scope: ${task.scope.join(', ')}`);
    }
    if (task.subtasks?.length) {
        lines.push('Subtasks:');
        for (const sub of task.subtasks) {
            lines.push(`  ${sub.id} [${sub.status}] ${sub.name} — ${sub.mscw}${badges(sub)}`);
        }
    }
    if (task.links?.length) {
        lines.push(`Links: ${task.links.join(', ')}`);
    }
    if (task.log?.length) {
        lines.push('Recent log:');
        for (const entry of task.log.slice(-5)) {
            lines.push(`  ${entry.at}${entry.agent ? ` ${entry.agent}` : ''}: ${entry.text}`);
        }
    }
    return lines.join('\n');
}

export function renderNext(items: NextTask[], limit = 5): string {
    if (items.length === 0) {
        return 'Nothing is available on the critical path right now. Everything there is done or claimed.';
    }
    return items.slice(0, limit).map(n => {
        const notes = [
            n.task.claimedBy ? `claimed by ${n.task.claimedBy.agent}${isClaimStale(n.task) ? ' but quiet, so you can take it over' : ''}` : 'unclaimed',
            n.task.status,
            ...(n.blockedBy.length ? [`waiting on ${n.blockedBy.join(', ')}`] : []),
        ];
        return `${n.task.id} ${n.task.name} (${notes.join(', ')})\n    ${n.path}`;
    }).join('\n');
}

// Parents that don't say what they need, for plan_check and mvplan check. A prompt to ask the human, not a failure.
export function renderNeedless(tasks: Task[]): string {
    if (tasks.length === 0) {
        return '';
    }
    return `\n\n${tasks.length} parent task(s) don't state the need they meet, so their subtasks can't be judged against it. `
        + `Ask the human what each needs and set it with plan_edit (update, need):\n${tasks.map(t => `  ${t.id} ${t.name}`).join('\n')}`;
}

export function claimedBy(plan: Plan, agent: string): Task[] {
    const found: Task[] = [];
    const visit = (task: Task) => {
        if (task.claimedBy?.agent === agent) {
            found.push(task);
        }
        task.subtasks?.forEach(visit);
    };
    visit(plan.root);
    return found;
}

// The briefing an agent gets at session start, and each subagent gets when it spawns.
export function briefing(plan: Plan, agent: string, where: string): string {
    const mine = claimedBy(plan, agent);
    const next = nextTasks(plan, { agent });
    const lines = [
        `MVPlanner: this repository is planned in MVPlanner. Your agent id is "${agent}"; pass it as "agent" to every MVPlanner tool.`,
        `Project: ${plan.root.name}. Status: ${describeLevel(overallLevel(plan))}.`,
        '',
        'Rules:',
        `1. The live plan is held in ${where}. Any plan.json in this checkout or worktree may be stale: never read, edit or commit it.`,
        '2. Read and change the plan only through the MVPlanner tools (plan_overview, plan_next, task_get, task_claim, task_release, task_update, task_propose, task_defer, plan_check; task_add and plan_edit only when a human has approved the change in this conversation).',
        '3. Claim one task (task_claim) before editing code, and work only on that task.',
        '4. Found new work? Propose it with task_propose instead of building it. Calling something a Must? Say what would happen without it; if it would still work, just not as nicely, it is not a Must. Want to keep something minimal (p3g10: pi is 3, gravity is 10)? Use task_defer and leave MVP(<id>) or TODO(<id>) in the code.',
        '5. Before you finish, update your task with task_update: status, checked acceptance criteria, and a short note.',
        '6. If the tools cannot find the plan, stop and report it. Do not create a plan file.',
        '',
    ];
    if (mine.length) {
        lines.push('Your claimed tasks:');
        for (const task of mine) {
            lines.push(renderTask(plan, task));
        }
    } else {
        lines.push('You have no claimed task. Next available tasks on the critical path:');
        lines.push(renderNext(next, 3));
    }
    return lines.join('\n');
}
