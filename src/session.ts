// Where to find the Claude Code session behind a claim: a claude.ai link for cloud sessions, otherwise the
// local session id, which `claude --resume` accepts.
export function currentSession(env: NodeJS.ProcessEnv = process.env): string | undefined {
    const remote = env.CLAUDE_CODE_REMOTE_SESSION_ID?.match(/^cse_(.+)$/);
    if (remote) {
        return `https://claude.ai/code/session_${remote[1]}`;
    }
    return env.CLAUDE_CODE_SESSION_ID || undefined;
}
