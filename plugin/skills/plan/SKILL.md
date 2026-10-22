---
name: plan
description: Break a feature or project into an MVPlanner plan with the human, using MoSCoW priorities relative to each parent and clear acceptance criteria. Use when asked to plan, scope or break down work in a repo that uses MVPlanner.
---

# Plan work with MVPlanner

The plan is the contract between the human and every agent. A good plan keeps the Musts small and makes it obvious what can wait.

1. Read the current plan with `plan_overview` (pass `all: true` if you need the whole tree) so new work lands under the right parent.
2. Draft the breakdown in the conversation first. For each task give:
   - a short name that says what will be true when it's done,
   - a MoSCoW priority **relative to its parent**: Must means the parent isn't done without it. A Could feature can have Must subtasks; they never block the project's Musts,
   - one to three acceptance criteria a reviewer could check,
   - dependencies on other tasks, if any (`T-12`, or `owner/repo#T-12` for another repo's plan).
3. Ask the human to approve or change it. Keep Musts to the minimum that delivers value; push the rest to Should or Could.
4. Once they approve, add it with `task_add`, naming who approved it in `approved_by`. Without explicit approval, use `task_propose` instead, which leaves the decision to them.
5. Finish with `plan_next` so the human sees what agents will pick up first.

Never edit plan.json directly. The live plan is held wherever your MVPlanner briefing says.
