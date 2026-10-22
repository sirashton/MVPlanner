import type { Plan } from './types.ts';
import { findTask } from './plan.ts';

// Deferral markers tie a deliberately minimal or postponed piece of code to a plan task:
//   // MVP(T-42): returns a fixed list; expand when real users need filtering   mvplan:ignore
//   // TODO(T-43): retry on network errors   mvplan:ignore
// A line containing "mvplan:ignore" is skipped, for examples like these, and a file containing
// "mvplan:ignore-file" is skipped entirely, as this one is.

export type MarkerKind = 'MVP' | 'TODO';

export interface Marker {
    kind: MarkerKind;
    // Undefined for a bare marker with no task id.
    id?: string;
    line: number;
    text: string;
    file?: string;
}

const LINKED = /\b(MVP|TODO)\((T-\d+)\)/g; // mvplan:ignore
const BARE = /\bTODO\b(?!\()/g;
const IGNORE = 'mvplan:' + 'ignore';
const IGNORE_FILE = `${IGNORE}-file`;

export function findMarkers(source: string, file?: string): Marker[] {
    const markers: Marker[] = [];
    if (source.includes(IGNORE_FILE)) {
        return markers;
    }
    source.split(/\r?\n/).forEach((lineText, index) => {
        if (lineText.includes(IGNORE)) {
            return;
        }
        const text = lineText.trim();
        for (const match of lineText.matchAll(LINKED)) {
            markers.push({ kind: match[1] as MarkerKind, id: match[2], line: index + 1, text, file });
        }
        for (const _ of lineText.matchAll(BARE)) {
            markers.push({ kind: 'TODO', line: index + 1, text, file });
        }
    });
    return markers;
}

export interface MarkerProblem {
    marker: Marker;
    kind: 'unlinked' | 'orphan' | 'stale';
    message: string;
}

export function checkMarkers(plan: Plan, markers: Marker[]): MarkerProblem[] {
    const problems: MarkerProblem[] = [];
    for (const marker of markers) {
        const where = `${marker.file ? `${marker.file}:` : 'line '}${marker.line}`;
        if (!marker.id) {
            problems.push({ marker, kind: 'unlinked', message: `${where}: TODO without a task id. Call task_defer and write TODO(<id>) instead.` }); // mvplan:ignore
            continue;
        }
        const found = findTask(plan, marker.id);
        if (!found) {
            problems.push({ marker, kind: 'orphan', message: `${where}: ${marker.kind}(${marker.id}) names a task that is not in the plan.` });
        } else if (found.task.status === 'Complete' || found.task.mscw === "Won't") {
            const state = found.task.status === 'Complete' ? 'complete' : "Won't";
            problems.push({ marker, kind: 'stale', message: `${where}: ${marker.kind}(${marker.id}) is ${state}; remove the marker or reopen the task.` });
        }
    }
    return problems;
}
