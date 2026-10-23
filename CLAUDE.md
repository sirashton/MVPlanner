<!-- mvplanner -->
## Planning: MVPlanner

This repository is planned in MVPlanner. The live plan is on the `mvplanner/plan` branch, and other agents, in other sessions and projects, are working from it at the same time.

Every session should start with an "MVPlanner:" briefing that gives you an agent id and the next tasks. If yours didn't, the MVPlanner plugin isn't loaded:

1. Don't edit code yet. Without the plugin you can't see what other agents have claimed.
2. Tell the human, and suggest `/plugin install mvplanner@mvplanner` (or, for cloud sessions, adding `claude plugin marketplace add sirashton/MVPlanner && claude plugin install mvplanner@mvplanner` to the environment's setup script).
3. Never read, edit or commit a `plan.json` in the checkout.
