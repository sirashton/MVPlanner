import fs from 'node:fs/promises';
import path from 'node:path';

// Files that make every Claude Code session in a repo load MVPlanner, and tell agents what to do when it hasn't.

// autoUpdate: third-party marketplaces don't update by themselves unless asked to.
export const MARKETPLACE = { source: { source: 'github', repo: 'sirashton/MVPlanner' }, autoUpdate: true };
const PLUGIN = 'mvplanner@mvplanner';
const CLAUDE_MD_MARKER = '<!-- mvplanner -->';

export const CLAUDE_MD_SECTION = `${CLAUDE_MD_MARKER}
## Planning: MVPlanner

This repository is planned in MVPlanner. The live plan is on the \`mvplanner/plan\` branch, and other agents, in other sessions and projects, are working from it at the same time.

Every session should start with an "MVPlanner:" briefing that gives you an agent id and the next tasks. If yours didn't, the MVPlanner plugin isn't loaded:

1. Don't edit code yet. Without the plugin you can't see what other agents have claimed.
2. Tell the human, and suggest \`/plugin install mvplanner@mvplanner\` (or, for cloud sessions, adding \`claude plugin marketplace add sirashton/MVPlanner && claude plugin install mvplanner@mvplanner\` to the environment's setup script).
3. Never read, edit or commit a \`plan.json\` in the checkout.
`;

// Catches pull requests from agents working without the plugin: each must name a claimed or complete task.
export const PR_WORKFLOW = `name: MVPlanner

on:
  pull_request:
    types: [opened, edited, synchronize, reopened]

jobs:
  task:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: git clone --depth 1 https://github.com/sirashton/MVPlanner "$RUNNER_TEMP/mvplanner"
      - name: The PR names a claimed or complete MVPlanner task and leaves plan.json alone
        run: node "$RUNNER_TEMP/mvplanner/plugin/dist/cli.js" check-pr
      - name: Every MVP() and TODO() marker names an open task
        run: node "$RUNNER_TEMP/mvplanner/plugin/dist/cli.js" check
`;

export async function writeRepoSetup(root: string): Promise<string[]> {
    const changed: string[] = [];

    const settingsFile = path.join(root, '.claude', 'settings.json');
    const settings = JSON.parse(await fs.readFile(settingsFile, 'utf-8').catch(() => '{}')) as {
        extraKnownMarketplaces?: Record<string, unknown>;
        enabledPlugins?: Record<string, boolean>;
    };
    const known = settings.extraKnownMarketplaces?.mvplanner as { autoUpdate?: boolean } | undefined;
    if (!known || known.autoUpdate === undefined || settings.enabledPlugins?.[PLUGIN] !== true) {
        settings.extraKnownMarketplaces = { ...settings.extraKnownMarketplaces, mvplanner: { ...MARKETPLACE, ...known } };
        settings.enabledPlugins = { ...settings.enabledPlugins, [PLUGIN]: true };
        await fs.mkdir(path.dirname(settingsFile), { recursive: true });
        await fs.writeFile(settingsFile, `${JSON.stringify(settings, null, 2)}\n`);
        changed.push('.claude/settings.json');
    }

    const claudeMd = path.join(root, 'CLAUDE.md');
    const existing = await fs.readFile(claudeMd, 'utf-8').catch(() => '');
    if (!existing.includes(CLAUDE_MD_MARKER)) {
        await fs.writeFile(claudeMd, existing ? `${existing.trimEnd()}\n\n${CLAUDE_MD_SECTION}` : CLAUDE_MD_SECTION);
        changed.push('CLAUDE.md');
    }
    const workflow = path.join(root, '.github', 'workflows', 'mvplanner.yml');
    if (!(await fs.stat(workflow).catch(() => undefined))) {
        await fs.mkdir(path.dirname(workflow), { recursive: true });
        await fs.writeFile(workflow, PR_WORKFLOW);
        changed.push('.github/workflows/mvplanner.yml');
    }
    return changed;
}
