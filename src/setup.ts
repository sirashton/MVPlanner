import fs from 'node:fs/promises';
import path from 'node:path';

// Files that make every Claude Code session in a repo load MVPlanner, and tell agents what to do when it hasn't.

export const MARKETPLACE = { source: { source: 'github', repo: 'sirashton/MVPlanner' } };
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

export async function writeRepoSetup(root: string): Promise<string[]> {
    const changed: string[] = [];

    const settingsFile = path.join(root, '.claude', 'settings.json');
    const settings = JSON.parse(await fs.readFile(settingsFile, 'utf-8').catch(() => '{}')) as {
        extraKnownMarketplaces?: Record<string, unknown>;
        enabledPlugins?: Record<string, boolean>;
    };
    if (!settings.extraKnownMarketplaces?.mvplanner || settings.enabledPlugins?.[PLUGIN] !== true) {
        settings.extraKnownMarketplaces = { ...settings.extraKnownMarketplaces, mvplanner: MARKETPLACE };
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
    return changed;
}
