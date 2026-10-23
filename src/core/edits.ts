import { addTask, decideProposal, moveTask, removeTask, updateTask } from './ops.ts';
import type { NewTask, TaskUpdate } from './ops.ts';
import { PlanError, getTask } from './plan.ts';
import type { Plan } from './types.ts';

// A batch of plan changes applied in one save, so a burst of ideas in a scoping session lands in one round trip.
// An added task can be given a ref, and later edits in the same batch can name it as "$ref".
export type Edit =
    | ({ op: 'add'; parent: string; ref?: string } & NewTask)
    | ({ op: 'update'; id: string } & Pick<TaskUpdate, 'status' | 'mscw' | 'name' | 'description' | 'need' | 'note'>)
    | { op: 'move'; id: string; parent: string; position?: number }
    | { op: 'remove'; id: string }
    | { op: 'accept'; id: string; mscw?: NewTask['mscw'] }
    | { op: 'decline'; id: string };

// agent is undefined for a human's own edits, which may change tasks other agents have claimed.
export function applyEdits(plan: Plan, agent: string | undefined, edits: Edit[], approvedBy: string): string[] {
    const refs = new Map<string, string>();
    const resolve = (id: string) => {
        if (!id.startsWith('$')) {
            return id;
        }
        return refs.get(id.slice(1)) ?? fail(`Unknown ref ${id}: give the add that creates it a ref and put it earlier.`);
    };
    const fail = (message: string): never => {
        throw new PlanError(message);
    };
    return edits.map((edit, i) => {
        try {
            switch (edit.op) {
                case 'add': {
                    const { op: _op, parent, ref, ...spec } = edit;
                    const task = addTask(plan, resolve(parent), agent, spec, approvedBy);
                    if (ref) {
                        refs.set(ref, task.id);
                    }
                    return `Added ${task.id} ${task.name} (${task.mscw})`;
                }
                case 'update': {
                    const { op: _op, id, ...update } = edit;
                    const task = updateTask(plan, resolve(id), agent, update);
                    return `Updated ${task.id} ${task.name}`;
                }
                case 'move': {
                    const task = moveTask(plan, resolve(edit.id), resolve(edit.parent), agent, edit.position);
                    return `Moved ${task.id} under ${resolve(edit.parent)}`;
                }
                case 'remove': {
                    const task = removeTask(plan, resolve(edit.id), agent);
                    return `Removed ${task.id} ${task.name}`;
                }
                case 'accept':
                case 'decline': {
                    // A second click, or the same decision from another screen, is not an error.
                    const current = getTask(plan, resolve(edit.id));
                    if (!current.proposed && (current.mscw === "Won't") === (edit.op === 'decline')) {
                        return `${current.id} ${current.name} was already ${edit.op === 'accept' ? 'accepted' : 'declined'}`;
                    }
                    const task = decideProposal(plan, resolve(edit.id), edit.op === 'accept', edit.op === 'accept' ? edit.mscw : undefined);
                    return `${edit.op === 'accept' ? 'Accepted' : 'Declined'} ${task.id} ${task.name}`;
                }
                default:
                    return fail(`Unknown edit ${(edit as { op: string }).op}`);
            }
        } catch (error) {
            // Name the failing edit; the store discards the whole batch, so nothing is half applied.
            throw new PlanError(`Edit ${i + 1} (${edit.op}) failed: ${(error as Error).message}`);
        }
    });
}
