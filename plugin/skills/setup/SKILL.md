---
name: setup
description: Set a repository up for MVPlanner in one step, check it works, then start scoping. Use when the human says "set this repo up for MVPlanner", wants to start using MVPlanner in a new or existing repo, or the tools say there is no plan branch yet.
---

# Set a repo up for MVPlanner

The human should not have to touch GitHub. You do the whole setup, then hand over to scoping.

1. Make sure you are in the repo's checkout (`git rev-parse --show-toplevel`). If the session has several repos, `cd` into the one the human means. The repo needs an `origin` remote on GitHub; if it has none, ask the human to create the repo and tell you its URL, then `git remote add origin <url>`.
2. Ask for the product's name only if the repo name is clearly wrong for it. Otherwise don't ask.
3. Run `mvplan setup` (add `--name "Product name"` if you asked, or `--from plan.json` to bring in an old version 1 plan). It is safe to run again. It:
   - pushes `.claude/settings.json`, a `CLAUDE.md` section and `.github/workflows/mvplanner.yml` to the default branch, before anything else, so a brand-new repo gets `main` as GitHub's default and never the plan branch,
   - creates the live plan on the `mvplanner/plan` branch,
   - switches GitHub's default branch back off the plan branch if an older setup left it there (with `gh`, when it is signed in),
   - checks the result and prints a ✓ or ✗ for each check, with the one fix for each ✗.
4. Don't commit the setup files yourself: they are already on the default branch. If the output says to merge or pull the default branch into this checkout, do that.
5. If a check failed, do its fix when you can (it is usually one command), then run `mvplan doctor` until every check passes. If the fix needs the human (a GitHub setting, a cloud environment setting), tell them exactly that one thing, with the link the output gives.
6. Hand over in a few lines:
   - Done, with anything the human still has to do.
   - For cloud sessions on claude.ai/code: the line to add to the environment's setup script, exactly as printed.
   - The plan page: `mvplan serve` on their PC, and the link it prints.
7. Offer to start scoping now with `/mvplanner:scope`. If they say yes, follow the scope skill.
