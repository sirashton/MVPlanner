# Changelog

## 0.2.0

- Rebuilt as a Claude Code plugin: MCP server, hooks, skills and agents, installable from this repo's marketplace.
- Plan format version 2: stable task ids, acceptance criteria, claims, dependencies, deferrals, proposals and a log. `mvplan migrate` converts version 1.
- The live plan is held on a `mvplanner/plan` branch, shared by every worktree, session and project; a single-file backend is available for one machine.
- `MVP(id)` and `TODO(id)` deferral markers, checked by hooks and `mvplan check`.
- `mvplan` CLI.
- Retired the VS Code extension.

## 0.0.1

- VS Code extension with an interactive plan viewer.
