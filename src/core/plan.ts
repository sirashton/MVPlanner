import { MSCW, STATUSES } from './types.ts';
import type { Mscw, Plan, Status, Task } from './types.ts';

export class PlanError extends Error {}

export const SCHEMA_URL = 'https://raw.githubusercontent.com/sirashton/mvplanner/main/plan.schema.json';

export function* walk(task: Task, parents: Task[] = []): Generator<{ task: Task; parents: Task[] }> {
    yield { task, parents };
    for (const sub of task.subtasks ?? []) {
        yield* walk(sub, [...parents, task]);
    }
}

export function findTask(plan: Plan, id: string): { task: Task; parents: Task[] } | undefined {
    for (const entry of walk(plan.root)) {
        if (entry.task.id === id) {
            return entry;
        }
    }
    return undefined;
}

export function getTask(plan: Plan, id: string): Task {
    const found = findTask(plan, id);
    if (!found) {
        throw new PlanError(`No task with id ${id}`);
    }
    return found.task;
}

export function taskPath(plan: Plan, id: string): string {
    const found = findTask(plan, id);
    if (!found) {
        return id;
    }
    return [...found.parents, found.task].map(t => t.name).join(' > ');
}

// Returns a list of problems; an empty list means the plan is usable.
export function validatePlan(value: unknown): string[] {
    const errors: string[] = [];
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return ['The plan must be a JSON object.'];
    }
    const plan = value as Partial<Plan>;
    if (plan.version !== 2) {
        errors.push(`Unsupported plan version ${String(plan.version)}; run "mvplan migrate" on a version 1 plan.`);
        return errors;
    }
    if (typeof plan.revision !== 'number') {
        errors.push('"revision" must be a number.');
    }
    if (typeof plan.nextId !== 'number') {
        errors.push('"nextId" must be a number.');
    }
    if (typeof plan.root !== 'object' || plan.root === null) {
        errors.push('"root" must be a task object.');
        return errors;
    }
    const seen = new Set<string>();
    for (const { task, parents } of walk(plan.root as Task)) {
        const where = [...parents, task].map(t => t.name ?? '?').join(' > ');
        if (typeof task.id !== 'string' || !/^T-\d+$/.test(task.id)) {
            errors.push(`${where}: id must look like "T-12".`);
        } else if (seen.has(task.id)) {
            errors.push(`${where}: duplicate id ${task.id}.`);
        } else {
            seen.add(task.id);
        }
        if (typeof task.name !== 'string' || task.name.length === 0) {
            errors.push(`${where}: name is required.`);
        }
        if (!STATUSES.includes(task.status)) {
            errors.push(`${where}: status must be one of ${STATUSES.join(', ')}.`);
        }
        if (!MSCW.includes(task.mscw)) {
            errors.push(`${where}: mscw must be one of ${MSCW.join(', ')}.`);
        }
        if (task.subtasks !== undefined && !Array.isArray(task.subtasks)) {
            errors.push(`${where}: subtasks must be an array.`);
        }
    }
    return errors;
}

export function parsePlan(text: string): Plan {
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch (error) {
        throw new PlanError(`The plan is not valid JSON: ${(error as Error).message}`);
    }
    const errors = validatePlan(value);
    if (errors.length > 0) {
        throw new PlanError(`The plan is invalid:\n- ${errors.join('\n- ')}`);
    }
    return value as Plan;
}

export function serializePlan(plan: Plan): string {
    return JSON.stringify(plan, null, 2) + '\n';
}

interface V1Task {
    name: string;
    description?: string;
    status?: string;
    mscw?: string;
    subtasks?: V1Task[];
}

// Converts the original name-addressed plan.json into version 2, giving every task an id in tree order.
export function migrateV1(v1: V1Task): Plan {
    let next = 1;
    const convert = (old: V1Task): Task => {
        const task: Task = {
            id: `T-${next++}`,
            name: old.name,
            status: (STATUSES as readonly string[]).includes(old.status ?? '') ? (old.status as Status) : 'Not Started',
            mscw: (MSCW as readonly string[]).includes(old.mscw ?? '') ? (old.mscw as Mscw) : 'Must',
        };
        if (old.description) {
            task.description = old.description;
        }
        if (old.subtasks && old.subtasks.length > 0) {
            task.subtasks = old.subtasks.map(convert);
        }
        return task;
    };
    const root = convert(v1);
    return { $schema: SCHEMA_URL, version: 2, revision: 1, nextId: next, root };
}

export function newPlan(name: string, description?: string): Plan {
    const root: Task = { id: 'T-1', name, status: 'Not Started', mscw: 'Must' };
    if (description) {
        root.description = description;
    }
    return { $schema: SCHEMA_URL, version: 2, revision: 1, nextId: 2, root };
}
