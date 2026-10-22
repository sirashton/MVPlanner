---
name: defer
description: Record deliberately minimal or postponed work as an MVPlanner task and mark the code with MVP(id) or TODO(id). Use when keeping an implementation simple on purpose, stubbing something, or leaving work for later.
---

# Defer work with a marker

Shipping the simplest thing that meets the acceptance criteria is the goal. Deferring makes that visible instead of silent.

1. Call `task_defer` with:
   - `parent`: usually the task you have claimed,
   - `name`: what the fuller version would do,
   - `trigger`: what would justify doing more ("when users ask for filtering", "if the list passes 1,000 items"),
   - `files`: where the marker goes,
   - `mscw`: defaults to Could. Use Should only if the plan is worse without it.
2. Put the returned id in a comment at the exact spot:
   - `MVP(T-42): returns a fixed list; expand when real users need filtering` for a deliberately simple implementation.
   - `TODO(T-43): retry on network errors` for work that has been put off entirely.
3. Never write a bare TODO. The hooks send it back, and `mvplan check` fails on it in CI.

Deferred tasks don't block "done all we Must". Agents only get offered them once the plan reaches their priority, or once another task depends on them. When you pick one up, remove its markers as part of finishing it.
