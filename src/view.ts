import { computeDoMore, criticalPath, isLeafWork, nextTasks, overallLevel } from './core/domore.ts';
import { walk } from './core/plan.ts';
import type { Marker } from './core/markers.ts';
import type { DoMore, Mscw, Plan, Status, Task } from './core/types.ts';
import { MSCW } from './core/types.ts';
import { describeLevel } from './format.ts';

// What a human needs to review a plan at a glance. The Claude Code panel and the web UI both draw this.

export interface TaskSummary {
    id: string;
    name: string;
    mscw: Mscw;
    status: Status;
    path: string;
}

export interface PlanView {
    name: string;
    revision: number;
    level: DoMore;
    status: string;
    ladder: { label: string; done: number; total: number; isCurrent: boolean }[];
    proposals: (TaskSummary & { description?: string; by?: string })[];
    claims: (TaskSummary & { agent: string; branch?: string; since: string; lastActivity: string; isStale: boolean })[];
    next: (TaskSummary & { blockedBy: string[]; acceptance: string[] })[];
    deferred: (TaskSummary & { trigger?: string; markers: { file: string; line: number; kind: string }[] })[];
    activity: { at: string; agent?: string; id: string; name: string; text: string }[];
    tree: (TaskSummary & {
        parent?: string; depth: number; level: DoMore; isOnPath: boolean; agent?: string; hasActiveWork: boolean; badges: string[];
        description?: string; acceptance: { text: string; done: boolean }[]; isProposed: boolean; isDeferred: boolean; dependsOn: string[];
        links: string[]; log: { at: string; agent?: string; text: string }[];
    })[];
}

const STALE_MS = 2 * 60 * 60 * 1000;

const rank = (m: Mscw) => MSCW.indexOf(m);

export function buildView(plan: Plan, markers: Marker[] = [], now = Date.now()): PlanView {
    const levels = computeDoMore(plan.root);
    const onPath = criticalPath(plan, levels);
    const entries = [...walk(plan.root)];
    const summary = (task: Task, parents: Task[]): TaskSummary => ({
        id: task.id, name: task.name, mscw: task.mscw, status: task.status, path: parents.map(p => p.name).join(' › '),
    });
    const byId = new Map(entries.map(e => [e.task.id, e]));

    // A task's effective priority is the least important on its way up, so a Must under a Could counts as Could.
    const effective = (task: Task, parents: Task[]) =>
        Math.max(rank(task.mscw), ...parents.slice(1).map(p => rank(p.mscw)));
    const leaves = entries.filter(e => e.parents.length > 0 && isLeafWork(e.task) && !e.task.proposed && !e.parents.some(p => p.proposed));
    const level = overallLevel(plan);
    const ladder = (['Must', 'Should', 'Could'] as const).map((name, i) => {
        const pool = leaves.filter(e => effective(e.task, e.parents) <= i);
        return { label: i === 0 ? 'Must' : `Up to ${name}`, done: pool.filter(e => e.task.status === 'Complete').length, total: pool.length, isCurrent: level === name };
    });
    ladder.push({ label: 'Everything', done: leaves.filter(e => e.task.status === 'Complete').length, total: leaves.length, isCurrent: false });

    const lastLog = (task: Task) => task.log?.at(-1)?.at ?? task.claimedBy?.at ?? '';
    const markersById = new Map<string, Marker[]>();
    for (const marker of markers) {
        if (marker.id) {
            markersById.set(marker.id, [...(markersById.get(marker.id) ?? []), marker]);
        }
    }

    return {
        name: plan.root.name,
        revision: plan.revision,
        level,
        status: describeLevel(level),
        ladder,
        proposals: entries.filter(e => e.task.proposed).map(e => ({
            ...summary(e.task, e.parents), description: e.task.description, by: e.task.log?.[0]?.agent,
        })),
        claims: entries.filter(e => e.task.claimedBy).map(e => {
            const last = lastLog(e.task);
            return {
                ...summary(e.task, e.parents),
                agent: e.task.claimedBy!.agent,
                branch: e.task.claimedBy!.branch,
                since: e.task.claimedBy!.at,
                lastActivity: last,
                isStale: now - Date.parse(last) > STALE_MS,
            };
        }),
        next: nextTasks(plan, { includeClaimed: false }).map(n => {
            const e = byId.get(n.task.id)!;
            return { ...summary(n.task, e.parents), blockedBy: n.blockedBy, acceptance: (n.task.acceptance ?? []).filter(c => !c.done).map(c => c.text) };
        }),
        deferred: entries
            .filter(e => e.task.status !== 'Complete' && (e.task.deferred || markersById.has(e.task.id)))
            .map(e => ({
                ...summary(e.task, e.parents),
                trigger: e.task.deferred?.trigger,
                markers: (markersById.get(e.task.id) ?? []).map(m => ({ file: m.file ?? '', line: m.line, kind: m.kind })),
            })),
        activity: entries
            .flatMap(e => (e.task.log ?? []).map(entry => ({ at: entry.at, agent: entry.agent, id: e.task.id, name: e.task.name, text: entry.text })))
            .sort((a, b) => b.at.localeCompare(a.at))
            .slice(0, 20),
        tree: entries.map(e => ({
            ...summary(e.task, e.parents),
            parent: e.parents.at(-1)?.id,
            depth: e.parents.length,
            agent: e.task.claimedBy?.agent,
            // True when this task or anything beneath it is claimed, so the tree can keep that branch open.
            hasActiveWork: [...walk(e.task)].some(({ task }) => task.claimedBy),
            level: levels.get(e.task.id) ?? 'Must',
            isOnPath: onPath.has(e.task.id),
            description: e.task.description,
            acceptance: e.task.acceptance ?? [],
            isProposed: Boolean(e.task.proposed),
            isDeferred: Boolean(e.task.deferred),
            dependsOn: e.task.dependsOn ?? [],
            links: e.task.links ?? [],
            log: (e.task.log ?? []).slice(-6).reverse(),
            badges: [
                ...(e.task.claimedBy ? [e.task.claimedBy.agent] : []),
                ...(e.task.proposed ? ['proposed'] : []),
                ...(e.task.deferred ? ['deferred'] : []),
                ...(e.task.dependsOn?.length ? [`needs ${e.task.dependsOn.join(', ')}`] : []),
            ],
        })),
    };
}
