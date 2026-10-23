# Changelog

## 0.2.0

- Agents build only what a task's criteria name and propose anything else a person would notice before building it, at whatever priority they suggest. Completing a task with `task_update` asks what was built beyond the criteria (`beyond_criteria`).
- Proposals say which part of the parent's need they serve: `task_propose` and `mvplan propose` refuse one without a `serves` line, and the page shows it on each proposal.
- Tasks state the need they meet (`need`), like a user story, so subtasks can be judged against it. Adding under a parent with no need asks for one, on the page and in tool replies, and `plan_check` / `mvplan check` list parents without one.
- Soft nudges in the skills, planner agent and tool hints: group related subtasks under a themed parent, and challenge Musts with p3g10 (pi is 3, gravity is 10) by saying what would happen without each one. Tool replies mention when a parent passes eight subtasks.
- Rebuilt as a Claude Code plugin: MCP server, hooks, skills and agents, installable from this repo's marketplace.
- Plan format version 2: stable task ids, acceptance criteria, claims, dependencies, deferrals, proposals and a log. `mvplan migrate` converts version 1.
- The live plan is held on a `mvplanner/plan` branch, shared by every worktree, session and project; a single-file backend is available for one machine.
- `MVP(id)` and `TODO(id)` deferral markers, checked by hooks and `mvplan check`.
- `mvplan` CLI.
- Retired the VS Code extension.

## 0.0.1

- VS Code extension with an interactive plan viewer.
