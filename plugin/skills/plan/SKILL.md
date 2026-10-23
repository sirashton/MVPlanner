---
name: plan
description: Break a feature or project into an MVPlanner plan with the human, using MoSCoW priorities relative to each parent and clear acceptance criteria. Use when asked to plan, scope or break down work in a repo that uses MVPlanner.
---

# Plan work with MVPlanner

The plan is the contract between the human and every agent. A good plan keeps the Musts small and makes it obvious what can wait.

1. Read the current plan with `plan_overview` (pass `all: true` if you need the whole tree) so new work lands under the right parent.
2. Draft the breakdown in the conversation first. For each task give:
   - a short name that says what will be true when it's done,
   - a MoSCoW priority **relative to its parent**: Must means the parent isn't done without it. A Could feature can have Must subtasks; they never block the project's Musts. Be harsh about Musts (see p3g10 below),
   - one to three acceptance criteria a reviewer could check,
   - dependencies on other tasks, if any (`T-12`, or `owner/repo#T-12` for another repo's plan).
3. Shape it before showing it:
   - **p3g10: pi is 3, gravity is 10.** Before calling anything a Must, ask whether a basic assumption or a stripped-back version would get it up and working. If it would, the Must is that version, and the refinement is a Should or Could under it. This is a habit of challenge, not a rule: some things really do need to be exact.
   - **Group as you go.** A parent reads best with about three to seven subtasks. Before adding one, look at its siblings: if two or more share a theme (visual polish, error handling, setup), put them under a parent named for the outcome, such as "Page looks polished", and create it if needed. When a parent already has around eight, suggest a regrouping to the human rather than adding another. These are rough numbers, not limits. A themed parent's own priority is relative to its parent too, so polish grouped under a Should no longer counts toward the project's Musts.
4. Ask the human to approve or change it. Keep Musts to the minimum that delivers value; push the rest to Should or Could.
5. Once they approve, add it with `task_add`, naming who approved it in `approved_by`. Without explicit approval, use `task_propose` instead, which leaves the decision to them.
6. Finish with `plan_next` so the human sees what agents will pick up first.

Never edit plan.json directly. The live plan is held wherever your MVPlanner briefing says.
