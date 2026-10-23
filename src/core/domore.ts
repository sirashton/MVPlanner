import { DO_MORE_ORDER } from './types.ts';
import type { DoMore, Plan, Task } from './types.ts';
import { walk } from './plan.ts';
import { isClaimStale } from './ops.ts';

// MoSCoW is relative to the parent: a Could feature with Must subtasks never blocks "done all we Must".
// A task's do-more level is the most important level at which work remains beneath it.

const rank = (level: string): number => {
    const index = (DO_MORE_ORDER as readonly string[]).indexOf(level);
    return index === -1 ? DO_MORE_ORDER.length : index;
};

// A task whose only subtasks are deferrals or proposals is still a piece of work in its own right.
export function isLeafWork(task: Task): boolean {
    return (task.subtasks ?? []).every(sub => sub.deferred || sub.proposed);
}

export function computeDoMore(root: Task): Map<string, DoMore> {
    const result = new Map<string, DoMore>();
    const visit = (task: Task): DoMore => {
        let level: DoMore;
        if (!task.subtasks || task.subtasks.length === 0) {
            level = task.status === 'Complete' ? "Can't" : task.mscw;
        } else {
            // Proposals don't count until a human accepts them, so agents can't widen the scope on their own.
            const children: { sub: { mscw: string }; level: DoMore }[] = task.subtasks
                .map(sub => ({ sub, level: visit(sub) }))
                .filter(c => !c.sub.proposed);
            if (isLeafWork(task) && task.status !== 'Complete') {
                children.push({ sub: { mscw: 'Must' }, level: 'Must' });
            }
            level = "Can't";
            for (const checking of DO_MORE_ORDER) {
                const atOrAbove = children.filter(c => rank(c.sub.mscw) <= rank(checking));
                if (atOrAbove.some(c => rank(c.level) <= rank(checking))) {
                    level = checking;
                    break;
                }
            }
        }
        result.set(task.id, level);
        return level;
    };
    visit(root);
    return result;
}

// Subtasks that hold their parent at its current level: the branches that matter most right now.
export function criticalPath(plan: Plan, doMore = computeDoMore(plan.root)): Set<string> {
    const onPath = new Set<string>([plan.root.id]);
    const visit = (task: Task) => {
        const level = rank(doMore.get(task.id) ?? "Can't");
        for (const sub of task.subtasks ?? []) {
            if (level < rank("Can't") && !sub.proposed && rank(sub.mscw) <= level && rank(doMore.get(sub.id) ?? "Can't") <= level) {
                onPath.add(sub.id);
                visit(sub);
            }
        }
    };
    visit(plan.root);
    return onPath;
}

export interface NextTask {
    task: Task;
    level: DoMore;
    path: string;
    blockedBy: string[];
}

function isDone(task: Task): boolean {
    return task.status === 'Complete';
}

// Unfinished leaf tasks on the critical path, unclaimed ones first, with any unmet dependencies listed.
// A claim that has gone quiet counts as unclaimed, since another agent can take it over.
export function nextTasks(plan: Plan, options: { includeClaimed?: boolean; agent?: string; now?: number } = {}): NextTask[] {
    const doMore = computeDoMore(plan.root);
    const onPath = criticalPath(plan, doMore);
    const byId = new Map<string, Task>();
    for (const { task } of walk(plan.root)) {
        byId.set(task.id, task);
    }
    const results: NextTask[] = [];
    for (const { task, parents } of walk(plan.root)) {
        if (!onPath.has(task.id) || isDone(task) || !isLeafWork(task)) {
            continue;
        }
        const claimedByOther = task.claimedBy && task.claimedBy.agent !== options.agent && !isClaimStale(task, options.now);
        if (claimedByOther && !options.includeClaimed) {
            continue;
        }
        const blockedBy = (task.dependsOn ?? []).filter(dep => {
            // TODO(T-21): resolve dependencies on other repos' plans instead of treating them as unmet.
            const local = byId.get(dep);
            return !local || !isDone(local);
        });
        results.push({
            task,
            level: doMore.get(task.id) ?? 'Must',
            path: [...parents, task].map(t => t.name).join(' > '),
            blockedBy,
        });
    }
    const score = (n: NextTask) =>
        (n.blockedBy.length > 0 || n.task.status === 'Blocked' ? 4 : 0) + (n.task.claimedBy ? 2 : 0) + (n.task.status === 'In Progress' ? 0 : 1);
    return results.sort((a, b) => score(a) - score(b));
}

export function overallLevel(plan: Plan): DoMore {
    return computeDoMore(plan.root).get(plan.root.id) ?? 'Must';
}

// Unfinished tasks with accepted subtasks that don't say what need they meet, so nothing can be judged against them.
export function parentsWithoutNeed(plan: Plan): Task[] {
    const found: Task[] = [];
    for (const { task, parents } of walk(plan.root)) {
        const dropped = [task, ...parents].some(t => t.mscw === "Won't" || t.proposed);
        if (!task.need && !isLeafWork(task) && task.status !== 'Complete' && !dropped) {
            found.push(task);
        }
    }
    return found;
}
