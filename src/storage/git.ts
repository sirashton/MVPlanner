import { execFile } from 'node:child_process';
import path from 'node:path';

export interface GitResult {
    code: number;
    stdout: string;
    stderr: string;
}

export function git(cwd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): Promise<GitResult> {
    return new Promise(resolve => {
        const child = execFile('git', args, { cwd, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
            const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
            resolve({ code, stdout: stdout.toString(), stderr: stderr.toString() });
        });
        if (input !== undefined) {
            child.stdin?.end(input);
        }
    });
}

export async function gitOk(cwd: string, args: string[], input?: string, env?: NodeJS.ProcessEnv): Promise<string> {
    const result = await git(cwd, args, input, env);
    if (result.code !== 0) {
        throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return result.stdout;
}

export async function repoTopLevel(cwd: string): Promise<string | undefined> {
    const result = await git(cwd, ['rev-parse', '--show-toplevel']);
    return result.code === 0 ? result.stdout.trim() : undefined;
}

// The main checkout, even when called from a linked worktree.
export async function mainCheckout(cwd: string): Promise<string | undefined> {
    const result = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir']);
    if (result.code !== 0) {
        return undefined;
    }
    const commonDir = result.stdout.trim();
    return path.basename(commonDir) === '.git' ? path.dirname(commonDir) : commonDir;
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
    const result = await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = result.stdout.trim();
    return result.code === 0 && branch !== 'HEAD' ? branch : undefined;
}
