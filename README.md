# MVPlanner

One prioritised plan that you and every agent work from.

Agents are good at doing the next thing and bad at remembering what was agreed. Give a swarm a big feature and you get drift: work nobody asked for, quiet gaps where a Must should be, and agents treading on each other. MVPlanner keeps the plan in one place every agent can reach, and a Claude Code plugin makes agents use it:

- **Claim before editing.** Each agent claims a task before it changes code, so two agents never take the same work.
- **Propose, don't drift.** New ideas become proposed tasks for a human to accept, rather than code.
- **Defer on purpose.** Keeping something minimal is fine, as long as it's recorded: `task_defer` creates a task and the code gets an `MVP(T-42)` or `TODO(T-43)` marker.
- **Know when you're done.** Priorities are MoSCoW, relative to each parent, and roll up into "done all we Must / Should / Could".

## Install the Claude Code plugin

```
/plugin install mvplanner --marketplace sirashton/MVPlanner
```

On Claude Code versions before 2.1.275, add the marketplace first with `/plugin marketplace add sirashton/MVPlanner`, then `/plugin install mvplanner@mvplanner`.

The plugin needs Node.js 22.18 or later on the machine that runs Claude Code. It ships pre-built, so there is nothing to `npm install`.

Then create the live plan for a repository, once, from a checkout that can push to it:

```
mvplan init --name "My project"        # or: mvplan init --from plan.json
```

`init` also writes `.claude/settings.json` and a short section of `CLAUDE.md`, so Claude Code offers the plugin to everyone who opens the repo, and an agent that starts without it stops and says so instead of working blind. Commit both. For an existing plan, `mvplan setup` writes them.

The repo settings also turn on auto-update for the MVPlanner marketplace, which Claude Code leaves off for third-party marketplaces. Running sessions pick up an update with `/reload-plugins`; new sessions load it by themselves. To update by hand: `claude plugin marketplace update mvplanner && claude plugin update mvplanner@mvplanner`.

Cloud sessions on claude.ai/code don't install plugins from a repo's settings. Add this to the cloud environment's setup script instead:

```
claude plugin marketplace add sirashton/MVPlanner && claude plugin install mvplanner@mvplanner
```

`mvplan` is on Claude's PATH while the plugin is enabled. Outside Claude Code, run `npm link` in a clone of this repo to get `mvplan` on your PATH.

## Where the plan lives

The live plan is `plan.json` on a dedicated `mvplanner/plan` branch of the repository's remote. Every tool call fetches it, applies its change and pushes, retrying if another agent got there first. That makes one plan visible to every worktree, every cloud session and every Claude Code project with access to the repo, even though agents in different projects can't message each other. The working tree is never touched, and the branch is never merged.

For a single machine you can set the backend to `file` instead. The plan is then `plan.json` in the main checkout, shared by all of its worktrees.

Rules agents are given at the start of every session and subagent:

1. The live plan is wherever the tools say. A `plan.json` in your checkout may be stale: never read, edit or commit it.
2. Read and change the plan only through the MVPlanner tools.
3. Claim one task before editing code, and work only on that task.
4. Propose new work with `task_propose`. Defer with `task_defer` and a marker.
5. Record progress with `task_update` before finishing.
6. If the tools can't find the plan, stop and report it.

## What the plugin contains

| Part | What it does |
| :- | :- |
| MCP server | `plan_overview`, `plan_next`, `task_get`, `task_claim`, `task_release`, `task_update`, `task_propose`, `task_add`, `task_defer`, `plan_edit` (batch add, move, rename, remove and decide, for human-directed sessions), `plan_check` |
| Hooks | **SessionStart** and **SubagentStart** brief the agent: its id, the rules, its task or the next ones. **PreToolUse** denies direct edits to `plan.json`, and blocks (or, in `warn` mode, warns about) edits with no claimed task. **PostToolUse** sends back markers that name no task. **Stop** and **SubagentStop** nudge once when files changed but no progress was recorded |
| Skills | `/mvplanner:scope` to shape a product with you as you talk, `/mvplanner:plan` to break work down with you, `/mvplanner:next` to pick up and finish a task, `/mvplanner:defer` for markers |
| Agents | `planner` maintains the plan; `scope-reviewer` checks a change against its task |
| Plan panel | A panel beside the chat for the human: progress by priority, the plan as a tree marking what's being worked on, proposals to accept or decline, next up, deferred work and recent activity. Opens by itself in repos with a plan; `/plan-panel` reopens it |
| Web page | `mvplan serve` opens the plan in your browser: add tasks as fast as you can type, set priorities with one click or a key, rename, drag to move, accept proposals, and watch agents' changes arrive live. It runs on your machine and saves through the same tools the agents use |
| `mvplan` CLI | The same operations from a terminal or CI, plus `init`, `accept`, `decline`, `move`, `remove` and `apply` (a batch of edits) for humans, `view` (the panel's data as JSON) and `serve` (the web page) |

Settings (asked for when you enable the plugin, and in `/config`):

- **Strictness:** `enforce` (the default) blocks edits without a claimed task, `warn` only nudges agents, `off` disables the hooks.
- **Backend:** `git` (the default) or `file`.
- **Plan branch:** `mvplanner/plan` by default.

## Scoping sessions

Run `/mvplanner:scope` and talk through what you want to build. The agent adds what you describe as you go, parks side ideas as Could and rejected ones as Won't, and reads back each change in a line. Each exchange lands in the plan as one save, so the page keeps up with the conversation. It never writes code during a scoping session. You can also paste a meeting transcript; it drafts the changes and asks before applying them.

## Priorities: MoSCoW, relative to the parent

A task's priority only says how much its parent needs it. A subtask's priority doesn't affect the project if its parent has a lower one.

1. Basic to-do list (Must)
   1. Add tasks (Must)
   2. Mark tasks complete (Must)
   3. Delete tasks (Should)
2. User accounts (Should)
   1. Registration (Must)
3. Hyper-optimised sorting (Could)
   1. Integrate a quantum computer API (Must)

Once 1.1 and 1.2 are complete, the project is at "done all we Must" even though 3.1 is a Must, because sorting is only a Could for the project. Agents are only offered work on the critical path: the branches that hold the project at its current level.

## Deferral markers

```ts
// MVP(T-42): returns a fixed list; expand when real users need filtering
export const filters = () => DEFAULT_FILTERS;

// TODO(T-43): retry on network errors
```

A marker must name a task in the plan. `mvplan check` (run it in CI) fails on markers that name no task, name a missing task, or name one that is already Complete or Won't. Markdown, JSON and `dist/` folders are not scanned. Add `mvplan:ignore` to a line, or `mvplan:ignore-file` anywhere in a file, to skip examples.

## The plan file

Version 2 of the format is described by [plan.schema.json](plan.schema.json). Each task has a stable id (`T-12`), a status, a MoSCoW priority, and optionally acceptance criteria, a claim, dependencies (`T-3`, or `owner/repo#T-3` for another repo's plan), deferral details and a log. `mvplan migrate old.json new.json` converts the original version 1 format.

This repository's own plan lives on its [`mvplanner/plan`](https://github.com/sirashton/MVPlanner/tree/mvplanner/plan) branch. Run `mvplan show` in a clone to see it.

## Developing

```
npm install
npm test               # node:test, no build needed
npm run typecheck
npm run build          # bundles plugin/dist; commit the result
claude plugin test ./plugin    # the panel's tests
claude --plugin-dir ./plugin
```

The VS Code extension from the first version has been retired.

## License

MIT
