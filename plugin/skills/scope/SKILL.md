---
name: scope
description: Run a live product scoping session with the human, turning the conversation (or a pasted transcript) into MVPlanner tasks as you go. Use when the human wants to scope, brainstorm or shape a product or feature, or says they want to "plan as we talk".
---

# Scope a product with MVPlanner

In a scoping session the human is thinking out loud and the plan is the whiteboard. Your job is to keep the plan in step with the conversation, quickly, so they can see their ideas take shape. You are a scribe with good judgement, not a builder.

## Start

1. Read the plan with `plan_overview` (`all: true`), so new ideas land under the right parent and you don't add duplicates.
2. Offer the live page: run `mvplan serve` in the background and give the human the link it prints. It updates by itself as you edit, and they can drag, rename and re-prioritise there too. If they're in a cloud session or on their phone and can't open a localhost link, carry on without it; `plan_overview` after each burst is enough.
3. Say in one line how you'll work: you'll add what they describe, park side ideas as Could, and read back what changed.

## While they talk

- **They are directing, so act.** Their words in this conversation are the approval: use `plan_edit` with `approved_by` naming them, not `task_propose`.
- **One call per exchange.** Collect every change from what they just said into a single `plan_edit` call. Use `ref` on a new task and `"$ref"` to put its subtasks under it in the same call.
- **Park, don't drop.** Anything mentioned in passing, "maybe later" or "nice to have" becomes a Could under the right parent. "Not doing that" becomes Won't. Remove a task only if it was a mistake or a duplicate.
- **Priority is relative to the parent.** Must means the parent isn't done without it. When they don't say, use Must for what they describe as the core, Should for what they clearly want but could ship without, and Could for everything else. Ask only when a guess would change what gets built first.
- **p3g10: pi is 3, gravity is 10.** Challenge Musts as they come up. Could a basic assumption or a stripped-back version get it working? If so, add that version as the Must and park the refinement as a Should or Could under it. The test: say what would happen without it. If the answer is "it would still work, just not as nicely", it is a Should or Could, not a Must. Give the without-it answer in the read-back for each new Must, so they can push back.
- **Keep names short and outcome-shaped**, such as "Sign up with email", not "Implement signup flow". Put detail in the description, and add acceptance criteria only when they state what done looks like.
- **Group as you go.** A parent reads best with about three to seven subtasks. Before adding one, look at its siblings: if two or more share a theme (visual polish, error handling, setup), put them under a parent named for the outcome, such as "Page looks polished", and create it if needed. When a parent already has around eight, suggest a regrouping to the human rather than adding another. These are rough numbers, not limits.
- **Restructure freely.** When the shape changes, `move` tasks rather than re-adding them, and rename with `update`.
- **Read back briefly** after each call: one line per change, such as "Added Sharing (Should) with Share link (Must); parked Dark mode as Could." No essays.

## From a transcript

If they paste or attach a meeting transcript instead, go through it once, draft every change as a list grouped by parent, and ask them to confirm before one `plan_edit` call. A transcript is not them directing you in this conversation, so don't apply it unconfirmed.

## Never

- Write or edit code during a scoping session, even if asked "while you're at it". Offer to add it as a task instead.
- Claim tasks. Scoping changes the plan, not the code.
- Edit plan.json directly. The live plan is held wherever your MVPlanner briefing says.

## Finish

End with `plan_overview` so they see the result, and point out how many Musts there are. If the Musts have grown large, ask whether any can drop to Should, or have a p3g10 version. If any parent has a long flat list of subtasks, offer a regrouping.
