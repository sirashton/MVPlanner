// Shapes of an MVPlanner plan file (schema version 2). plan.schema.json mirrors these.

export const STATUSES = ['Not Started', 'In Progress', 'Complete', 'Blocked'] as const;
export type Status = (typeof STATUSES)[number];

export const MSCW = ['Must', 'Should', 'Could', "Won't"] as const;
export type Mscw = (typeof MSCW)[number];

// "Can't" means there is nothing left to do at any level.
export const DO_MORE_ORDER = ['Must', 'Should', 'Could', "Won't", "Can't"] as const;
export type DoMore = (typeof DO_MORE_ORDER)[number];

export interface Claim {
    agent: string;
    branch?: string;
    at: string;
}

export interface AcceptanceCriterion {
    text: string;
    done: boolean;
}

export interface LogEntry {
    at: string;
    agent?: string;
    text: string;
}

export interface Deferral {
    // What would justify doing more than the minimal version.
    trigger?: string;
    // Files that carry a MVP(id) or TODO(id) marker for this task.
    files?: string[];
}

export interface Task {
    id: string;
    name: string;
    description?: string;
    status: Status;
    mscw: Mscw;
    acceptance?: AcceptanceCriterion[];
    claimedBy?: Claim;
    scope?: string[];
    // Task ids in this plan ("T-12") or another repo's plan ("owner/repo#T-12").
    dependsOn?: string[];
    deferred?: Deferral;
    proposed?: boolean;
    links?: string[];
    log?: LogEntry[];
    subtasks?: Task[];
}

export interface Plan {
    $schema?: string;
    version: 2;
    // Bumped on every write so concurrent writers can detect each other.
    revision: number;
    nextId: number;
    root: Task;
}
