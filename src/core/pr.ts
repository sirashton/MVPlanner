import { findTask } from './plan.ts';
import type { Plan } from './types.ts';

// A pull request must name a task that an agent has claimed, or that is complete, so work done without the plugin
// (and so without a claim) is caught before it merges. It must not change a plan.json at the top of the repo either:
// the live plan is changed only through the tools, and a committed copy goes stale.

export interface PullRequestInfo {
    title?: string;
    branch?: string;
    body?: string;
    /** Paths the pull request changes, when known */
    files?: string[];
}

export function checkPullRequest(plan: Plan, pr: PullRequestInfo): { ok: boolean; message: string } {
    const tasks = checkTasks(plan, pr);
    if (!pr.files?.includes('plan.json')) {
        return tasks;
    }
    return {
        ok: false,
        message: `${tasks.message}\n\nThis PR changes plan.json. Change the plan only through the MVPlanner tools, and take plan.json out of this PR (git checkout origin/<base> -- plan.json, or git rm --cached plan.json if it is new).`,
    };
}

function checkTasks(plan: Plan, pr: PullRequestInfo): { ok: boolean; message: string } {
    const ids = [...new Set([pr.title, pr.branch, pr.body].join('\n').match(/\bT-\d+\b/g) ?? [])];
    if (ids.length === 0) {
        return {
            ok: false,
            message: 'This PR names no MVPlanner task. Claim the task it belongs to (task_claim) and put its id, such as T-12, in the title, branch or description.',
        };
    }
    const lines = ids.map(id => {
        const task = findTask(plan, id)?.task;
        if (!task) {
            return { id, ok: false, text: `${id} is not in the plan` };
        }
        if (task.proposed) {
            return { id, ok: false, text: `${id} ${task.name} is still a proposal` };
        }
        if (task.status === 'Complete') {
            return { id, ok: true, text: `${id} ${task.name} is complete` };
        }
        if (task.claimedBy) {
            return { id, ok: true, text: `${id} ${task.name} is claimed by ${task.claimedBy.agent}` };
        }
        return { id, ok: false, text: `${id} ${task.name} is not claimed` };
    });
    const ok = lines.some(line => line.ok);
    const summary = lines.map(line => `${line.ok ? 'ok' : 'no'}  ${line.text}`).join('\n');
    return {
        ok,
        message: ok
            ? `${summary}\n\nThis PR is tied to a claimed or complete task.`
            : `${summary}\n\nNone of the tasks this PR names is claimed or complete. Claim the task before the work merges, or mark it complete.`,
    };
}
