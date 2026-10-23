---
name: next
description: Pick up the next most important MVPlanner task, claim it, do it and record progress. Use when asked to work on the plan, continue, or "do the next thing" in a repo that uses MVPlanner.
---

# Work the next task

1. Call `plan_next` with your agent id (from your MVPlanner briefing). Take the first unclaimed task that isn't waiting on anything, unless the human named one.
2. `task_get` it and read the acceptance criteria. They define done and the whole of what you build.
3. `task_claim` it before editing any file.
4. Do the work. Stay inside the task:
   - Build only what the criteria name. Anything else a person would notice, however small (a keyboard shortcut, a setting, a button, a mode), goes to `task_propose` first, not into this change. Say which part of the parent's need it serves and suggest whatever priority it deserves, Must included; the human decides, and you build it only once they accept it.
   - Proposing several related things? Put them under one themed parent (propose the parent first) rather than as a row of siblings.
   - Think p3g10 (pi is 3, gravity is 10): if a basic assumption or the simplest version is enough for now, use `task_defer` and leave `MVP(<id>)` or `TODO(<id>)` in a comment at that spot (see the defer skill).
5. When the criteria are met, `task_update` with `status: "Complete"`, the indexes in `acceptance_done`, any PR link, a handoff note for the next agent (what changed, decisions and why, gotchas, what you left out with T-ids, and where to look), and `beyond_criteria`: anything you built that no criterion names, with the accepted proposal id for each, or "nothing". Completing fails without both. If you have to stop early, `task_update` with a note on where it stands, then `task_release`.
6. Run `plan_check` before you hand back, so no marker points at a missing or finished task.
