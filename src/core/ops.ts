import { MSCW, STATUSES } from './types.ts';
import type { Mscw, Plan, Status, Task } from './types.ts';
import { PlanError, findTask, getTask, walk } from './plan.ts';

// Every operation mutates the plan in place. Storage backends re-run an operation on a fresh copy when
// another writer got there first, so operations must be safe to replay.

const now = () => new Date().toISOString();

function addLog(task: Task, text: string, agent?: string) {
    task.log = [...(task.log ?? []), { at: now(), agent, text }];
}

function newId(plan: Plan): string {
    return `T-${plan.nextId++}`;
}

// A claim with no activity on its task for this long can be taken over by another agent.
// MVP(T-55): a fixed limit rather than one a human can set.
export const STALE_CLAIM_MS = 2 * 60 * 60 * 1000;

export function lastClaimActivity(task: Task): string {
    return task.log?.at(-1)?.at ?? task.claimedBy?.at ?? '';
}

export function isClaimStale(task: Task, at = Date.now()): boolean {
    return !!task.claimedBy && at - Date.parse(lastClaimActivity(task)) > STALE_CLAIM_MS;
}

export function claimTask(plan: Plan, id: string, agent: string, branch?: string, session?: string, at = Date.now()): Task {
    const task = getTask(plan, id);
    const previous = task.claimedBy && task.claimedBy.agent !== agent ? task.claimedBy : undefined;
    if (previous && !isClaimStale(task, at)) {
        throw new PlanError(`${id} is already claimed by ${previous.agent}. Pick another task, or ask a human to reassign it. It can be taken over once the claim has been quiet for 2 hours.`);
    }
    if (task.status === 'Complete') {
        throw new PlanError(`${id} is already complete.`);
    }
    const quietSince = previous && lastClaimActivity(task);
    task.claimedBy = { agent, at: now(), ...(branch ? { branch } : {}), ...(session ? { session } : {}) };
    if (task.status === 'Not Started') {
        task.status = 'In Progress';
    }
    addLog(task, `${previous ? `Took over from ${previous.agent}, whose claim had been quiet since ${quietSince}. Claimed` : 'Claimed'}${branch ? ` on ${branch}` : ''}`, agent);
    return task;
}

export function releaseTask(plan: Plan, id: string, agent: string, note?: string): Task {
    const task = getTask(plan, id);
    if (task.claimedBy && task.claimedBy.agent !== agent) {
        throw new PlanError(`${id} is claimed by ${task.claimedBy.agent}, not ${agent}.`);
    }
    delete task.claimedBy;
    addLog(task, note ? `Released: ${note}` : 'Released', agent);
    return task;
}

export interface TaskUpdate {
    status?: Status;
    mscw?: Mscw;
    note?: string;
    acceptanceDone?: number[];
    addAcceptance?: string[];
    links?: string[];
    name?: string;
    description?: string;
}

export function updateTask(plan: Plan, id: string, agent: string | undefined, update: TaskUpdate): Task {
    const task = getTask(plan, id);
    if (task.claimedBy && agent && task.claimedBy.agent !== agent) {
        throw new PlanError(`${id} is claimed by ${task.claimedBy.agent}; only that agent can update it.`);
    }
    const changes: string[] = [];
    if (update.status !== undefined) {
        if (!STATUSES.includes(update.status)) {
            throw new PlanError(`Unknown status ${update.status}.`);
        }
        if (update.status === 'Complete') {
            const open = (task.acceptance ?? []).filter((c, i) => !c.done && !(update.acceptanceDone ?? []).includes(i));
            if (open.length > 0) {
                throw new PlanError(`${id} has unchecked acceptance criteria: ${open.map(c => `"${c.text}"`).join(', ')}. Check them off or ask a human to change them.`);
            }
        }
        if (task.status !== update.status) {
            changes.push(`status ${task.status} -> ${update.status}`);
            task.status = update.status;
        }
        if (update.status === 'Complete') {
            delete task.claimedBy;
        }
    }
    if (update.mscw !== undefined) {
        if (!MSCW.includes(update.mscw)) {
            throw new PlanError(`Unknown priority ${update.mscw}.`);
        }
        if (task.mscw !== update.mscw) {
            changes.push(`priority ${task.mscw} -> ${update.mscw}`);
            task.mscw = update.mscw;
        }
    }
    for (const text of update.addAcceptance ?? []) {
        task.acceptance = [...(task.acceptance ?? []), { text, done: false }];
        changes.push(`added criterion "${text}"`);
    }
    for (const index of update.acceptanceDone ?? []) {
        const criterion = task.acceptance?.[index];
        if (!criterion) {
            throw new PlanError(`${id} has no acceptance criterion at index ${index}.`);
        }
        if (!criterion.done) {
            criterion.done = true;
            changes.push(`checked "${criterion.text}"`);
        }
    }
    for (const link of update.links ?? []) {
        if (!(task.links ?? []).includes(link)) {
            task.links = [...(task.links ?? []), link];
            changes.push(`linked ${link}`);
        }
    }
    if (update.name !== undefined && update.name !== task.name) {
        changes.push(`renamed from "${task.name}"`);
        task.name = update.name;
    }
    if (update.description !== undefined) {
        task.description = update.description;
        changes.push('description updated');
    }
    if (update.note) {
        changes.push(update.note);
    }
    if (changes.length > 0) {
        addLog(task, changes.join('; '), agent);
    }
    return task;
}

export interface NewTask {
    name: string;
    description?: string;
    mscw?: Mscw;
    acceptance?: string[];
    dependsOn?: string[];
}

// Adds a subtask. Agents use this to propose new scope instead of quietly building it.
export function proposeTask(plan: Plan, parentId: string, agent: string | undefined, spec: NewTask): Task {
    const parent = getTask(plan, parentId);
    const task: Task = {
        id: newId(plan),
        name: spec.name,
        status: 'Not Started',
        mscw: spec.mscw ?? 'Could',
        proposed: true,
    };
    if (spec.description) {
        task.description = spec.description;
    }
    if (spec.acceptance?.length) {
        task.acceptance = spec.acceptance.map(text => ({ text, done: false }));
    }
    if (spec.dependsOn?.length) {
        task.dependsOn = spec.dependsOn;
    }
    addLog(task, `Proposed under ${parentId}`, agent);
    parent.subtasks = [...(parent.subtasks ?? []), task];
    return task;
}

// Past this many subtasks a parent gets hard to follow, so tool replies suggest grouping. A nudge, never a limit.
export const CROWDED_SUBTASKS = 8;

// One reminder line per parent, among those just added to, that has grown past CROWDED_SUBTASKS.
export function crowdingHint(plan: Plan, parentIds: string[]): string {
    return [...new Set(parentIds)]
        .map(id => findTask(plan, id)?.task)
        .filter((task): task is Task => (task?.subtasks?.length ?? 0) > CROWDED_SUBTASKS)
        .map(task => `\n\n${task.name} (${task.id}) now has ${task.subtasks!.length} subtasks. If some share a theme, suggest to the human grouping them under a parent named for the outcome, such as "Page looks polished".`)
        .join('');
}

// Adds agreed work directly. Only for a breakdown a human has approved; agents otherwise propose.
export function addTask(plan: Plan, parentId: string, agent: string | undefined, spec: NewTask, approvedBy: string): Task {
    const task = proposeTask(plan, parentId, agent, spec);
    delete task.proposed;
    task.mscw = spec.mscw ?? 'Must';
    task.log = [{ at: now(), agent, text: `Added under ${parentId}, approved by ${approvedBy}` }];
    return task;
}

export interface DeferSpec extends NewTask {
    trigger?: string;
    files?: string[];
}

// Records deliberately deferred work: the agent leaves MVP(id) or TODO(id) in the code with the returned id.
export function deferTask(plan: Plan, parentId: string, agent: string | undefined, spec: DeferSpec): Task {
    const task = proposeTask(plan, parentId, agent, spec);
    delete task.proposed;
    task.deferred = {};
    if (spec.trigger) {
        task.deferred.trigger = spec.trigger;
    }
    if (spec.files?.length) {
        task.deferred.files = spec.files;
    }
    task.log = [{ at: now(), agent, text: `Deferred from ${parentId}` }];
    return task;
}

// A human accepting a proposal, or turning it down.
export function decideProposal(plan: Plan, id: string, accept: boolean, mscw?: Mscw): Task {
    const task = getTask(plan, id);
    if (!task.proposed) {
        throw new PlanError(`${id} is not a proposal.`);
    }
    delete task.proposed;
    if (accept) {
        if (mscw) {
            task.mscw = mscw;
        }
        addLog(task, 'Proposal accepted');
    } else {
        task.mscw = "Won't";
        addLog(task, "Proposal declined (set to Won't)");
    }
    return task;
}

function isWithin(task: Task, id: string): boolean {
    return task.id === id || (task.subtasks ?? []).some(sub => isWithin(sub, id));
}

// Moves a task, with everything under it, to another parent. Scoping sessions reshape the plan constantly.
export function moveTask(plan: Plan, id: string, parentId: string, agent: string | undefined, position?: number): Task {
    const found = findTask(plan, id);
    if (!found) {
        throw new PlanError(`No task with id ${id}`);
    }
    if (found.parents.length === 0) {
        throw new PlanError('The root task cannot be moved.');
    }
    const target = getTask(plan, parentId);
    if (isWithin(found.task, parentId)) {
        throw new PlanError(`${id} cannot move under ${parentId}, which is inside it.`);
    }
    const from = found.parents.at(-1)!;
    from.subtasks = from.subtasks!.filter(t => t.id !== id);
    const siblings = [...(target.subtasks ?? [])];
    siblings.splice(Math.max(0, Math.min(position ?? siblings.length, siblings.length)), 0, found.task);
    target.subtasks = siblings;
    if (from.id !== target.id) {
        addLog(found.task, `Moved from ${from.id} to ${target.id}`, agent);
    }
    return found.task;
}

// Deletes a task and everything under it. Setting a task to Won't keeps a record and is usually better; removal is
// for mistakes and duplicates.
export function removeTask(plan: Plan, id: string, agent: string | undefined): Task {
    const found = findTask(plan, id);
    if (!found) {
        throw new PlanError(`No task with id ${id}`);
    }
    if (found.parents.length === 0) {
        throw new PlanError('The root task cannot be removed.');
    }
    const claimed = [...walk(found.task)].find(e => e.task.claimedBy && e.task.claimedBy.agent !== agent);
    if (claimed) {
        throw new PlanError(`${claimed.task.id} is claimed by ${claimed.task.claimedBy!.agent}, so ${id} cannot be removed.`);
    }
    const parent = found.parents.at(-1)!;
    parent.subtasks = parent.subtasks!.filter(t => t.id !== id);
    if (parent.subtasks.length === 0) {
        delete parent.subtasks;
    }
    addLog(parent, `Removed ${id} "${found.task.name}"`, agent);
    return found.task;
}
