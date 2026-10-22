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
- **Keep names short and outcome-shaped**, such as "Sign up with email", not "Implement signup flow". Put detail in the description, and add acceptance criteria only when they state what done looks like.
- **Restructure freely.** When the shape changes, `move` tasks rather than re-adding them, and rename with `update`.
- **Read back briefly** after each call: one line per change, such as "Added Sharing (Should) with Share link (Must); parked Dark mode as Could." No essays.

## From a transcript

If they paste or attach a meeting transcript instead, go through it once, draft every change as a list grouped by parent, and ask them to confirm before one `plan_edit` call. A transcript is not them directing you in this conversation, so don't apply it unconfirmed.

## Never

- Write or edit code during a scoping session, even if asked "while you're at it". Offer to add it as a task instead.
- Claim tasks. Scoping changes the plan, not the code.
- Edit plan.json directly. The live plan is held wherever your MVPlanner briefing says.

## Finish

End with `plan_overview` so they see the result, and point out how many Musts there are. If the Musts have grown large, ask whether any can drop to Should.
