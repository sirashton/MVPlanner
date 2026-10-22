import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import {
    PlanError, checkMarkers, claimTask, decideProposal, deferTask, getTask, migrateV1, nextTasks, newPlan,
    applyEdits, moveTask, parsePlan, proposeTask, releaseTask, removeTask, serializePlan, taskPath, updateTask, validatePlan, MSCW, STATUSES,
} from './core/index.ts';
import type { Mscw, Plan, Status } from './core/index.ts';
import { renderNext, renderTask, renderTree } from './format.ts';
import { scanRepo } from './scan.ts';
import { openInBrowser, startServer } from './serve.ts';
import { buildView } from './view.ts';
import { currentBranch, repoTopLevel } from './storage/git.ts';
import { FileStore, GitBranchStore, openStore } from './storage/stores.ts';

const HELP = `mvplan: work with the live MVPlanner plan

Reading
  mvplan where                      Where the live plan is held
  mvplan show [--all] [--json]      The plan as a tree (critical path by default)
  mvplan next [--agent A]           Next tasks on the critical path
  mvplan get <id>                   One task in full
  mvplan check                      Validate the plan and the MVP()/TODO() markers in this repo
  mvplan view [--no-markers]        The review view as JSON, for the panel and the web UI
  mvplan serve [--port N] [--no-open]   The interactive plan page on localhost

Changing
  mvplan claim <id> --agent A       Claim a task before working on it
  mvplan release <id> --agent A [--note N]
  mvplan update <id> [--agent A] [--status S] [--mscw P] [--note N] [--done 0,1]
                     [--criterion TEXT]... [--link URL]... [--name N] [--description D]
  mvplan propose <parent-id> <name> [--mscw P] [--description D] [--criterion TEXT]...
  mvplan defer <parent-id> <name> [--mscw P] [--trigger T] [--file F]...
  mvplan accept <id> [--mscw P]     Accept a proposed task
  mvplan decline <id>               Decline a proposed task (sets it to Won't)
  mvplan move <id> <parent-id> [--position N]
  mvplan remove <id>                Delete a task and its subtasks (prefer --mscw Won't to keep a record)
  mvplan apply <file|->             Apply a JSON array of edits in one save (see plan_edit)

Setting up
  mvplan init [--from FILE] [--name NAME]   Create the live plan (migrates a version 1 plan.json)
  mvplan migrate <in> [out]                 Convert a version 1 plan.json to version 2

Storage: the plan branch on the remote by default. Set MVPLANNER_BACKEND=file to use one plan.json in the main
checkout instead, and MVPLANNER_BRANCH / MVPLANNER_REMOTE / MVPLANNER_PLAN_FILE to change locations.
Agent id: --agent, or MVPLANNER_AGENT, or your user name.`;

function fail(message: string): never {
    throw new PlanError(message);
}

function asStatus(value: string | undefined): Status | undefined {
    if (value === undefined) {
        return undefined;
    }
    const match = STATUSES.find(s => s.toLowerCase() === value.toLowerCase());
    return match ?? fail(`Status must be one of: ${STATUSES.join(', ')}`);
}

function asMscw(value: string | undefined): Mscw | undefined {
    if (value === undefined) {
        return undefined;
    }
    const match = MSCW.find(m => m.toLowerCase() === value.toLowerCase() || m.toLowerCase().replace("'", '') === value.toLowerCase());
    return match ?? fail(`Priority must be one of: ${MSCW.join(', ')}`);
}

async function readPlanFile(file: string): Promise<Plan> {
    const value = JSON.parse(await fs.readFile(file, 'utf-8'));
    return value.version === 2 ? parsePlan(JSON.stringify(value)) : migrateV1(value);
}

export async function main(argv: string[], cwd = process.cwd()): Promise<number> {
    const { values, positionals } = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
            agent: { type: 'string' },
            all: { type: 'boolean' },
            json: { type: 'boolean' },
            'no-markers': { type: 'boolean' },
            status: { type: 'string' },
            mscw: { type: 'string' },
            note: { type: 'string' },
            done: { type: 'string' },
            criterion: { type: 'string', multiple: true },
            link: { type: 'string', multiple: true },
            name: { type: 'string' },
            description: { type: 'string' },
            trigger: { type: 'string' },
            file: { type: 'string', multiple: true },
            from: { type: 'string' },
            position: { type: 'string' },
            'approved-by': { type: 'string' },
            port: { type: 'string' },
            'no-open': { type: 'boolean' },
            help: { type: 'boolean', short: 'h' },
        },
    });
    const [command, ...args] = positionals;
    if (!command || values.help || command === 'help') {
        console.log(HELP);
        return 0;
    }
    const agent = values.agent ?? process.env.MVPLANNER_AGENT ?? os.userInfo().username;
    const out = (text: string) => console.log(text);

    if (command === 'migrate') {
        const [input, output] = args;
        if (!input) {
            fail('Usage: mvplan migrate <in> [out]');
        }
        const plan = await readPlanFile(input);
        if (output) {
            await fs.writeFile(output, serializePlan(plan));
            out(`Wrote ${output}`);
        } else {
            process.stdout.write(serializePlan(plan));
        }
        return 0;
    }

    const store = await openStore(cwd);

    switch (command) {
        case 'where':
            out(`The live plan is held in ${store.describe()}.`);
            return 0;
        case 'init': {
            const plan = values.from ? await readPlanFile(values.from) : newPlan(values.name ?? path.basename((await repoTopLevel(cwd)) ?? cwd));
            if (store instanceof GitBranchStore) {
                await store.init(plan);
            } else if (store instanceof FileStore) {
                const exists = await fs.stat(store.file).then(() => true, () => false);
                if (exists) {
                    fail(`${store.file} already exists.`);
                }
                await store.write(plan);
            }
            out(`Created the live plan in ${store.describe()}.`);
            return 0;
        }
        case 'show': {
            const plan = await store.read({ fresh: true });
            out(values.json ? serializePlan(plan) : renderTree(plan, { all: values.all }));
            return 0;
        }
        case 'next': {
            const plan = await store.read({ fresh: true });
            out(renderNext(nextTasks(plan, { agent: values.agent })));
            return 0;
        }
        case 'get': {
            const plan = await store.read({ fresh: true });
            const task = getTask(plan, args[0] ?? fail('Usage: mvplan get <id>'));
            out(renderTask(plan, task, taskPath(plan, task.id)));
            return 0;
        }
        case 'view': {
            const plan = await store.read({ fresh: true });
            const markers = values['no-markers'] ? [] : await scanRepo((await repoTopLevel(cwd)) ?? cwd).catch(() => []);
            out(JSON.stringify(buildView(plan, markers)));
            return 0;
        }
        case 'serve': {
            await store.read({ fresh: true });
            const server = await startServer({ store, cwd, port: values.port ? Number.parseInt(values.port, 10) : 4747 })
                .catch(() => startServer({ store, cwd }));
            out(`The plan is at ${server.url}\nChanges you make there are saved to ${store.describe()}. Press Ctrl+C to stop.`);
            if (!values['no-open']) {
                openInBrowser(server.url);
            }
            await new Promise<void>(resolve => process.once('SIGINT', resolve).once('SIGTERM', resolve));
            await server.close();
            return 0;
        }
        case 'check': {
            const plan = await store.read({ fresh: true });
            const problems = [...validatePlan(plan)];
            const root = (await repoTopLevel(cwd)) ?? cwd;
            const markers = await scanRepo(root);
            const markerProblems = checkMarkers(plan, markers);
            problems.push(...markerProblems.map(p => p.message));
            const linked = markers.filter(m => m.id).length;
            if (problems.length) {
                out(problems.join('\n'));
                out(`\n${problems.length} problem(s); ${linked} linked marker(s) checked.`);
                return 1;
            }
            out(`Plan is valid; ${linked} linked marker(s) all point at open tasks.`);
            return 0;
        }
        case 'claim': {
            const id = args[0] ?? fail('Usage: mvplan claim <id> --agent A');
            const branch = await currentBranch(cwd);
            const { plan, result } = await store.mutate(`${agent} claims ${id}`, p => claimTask(p, id, agent, branch));
            out(`Claimed.\n\n${renderTask(plan, result, taskPath(plan, id))}`);
            return 0;
        }
        case 'release': {
            const id = args[0] ?? fail('Usage: mvplan release <id>');
            await store.mutate(`${agent} releases ${id}`, p => releaseTask(p, id, agent, values.note));
            out(`Released ${id}.`);
            return 0;
        }
        case 'update': {
            const id = args[0] ?? fail('Usage: mvplan update <id> ...');
            const { plan, result } = await store.mutate(`${agent} updates ${id}`, p => updateTask(p, id, values.agent ?? agent, {
                status: asStatus(values.status),
                mscw: asMscw(values.mscw),
                note: values.note,
                acceptanceDone: values.done?.split(',').map(n => Number.parseInt(n, 10)),
                addAcceptance: values.criterion,
                links: values.link,
                name: values.name,
                description: values.description,
            }));
            out(renderTask(plan, result, taskPath(plan, id)));
            return 0;
        }
        case 'propose':
        case 'defer': {
            const [parent, name] = args;
            if (!parent || !name) {
                fail(`Usage: mvplan ${command} <parent-id> <name>`);
            }
            const spec = { name, description: values.description, mscw: asMscw(values.mscw), acceptance: values.criterion, trigger: values.trigger, files: values.file };
            const { result } = await store.mutate(`${agent} ${command === 'defer' ? 'defers' : 'proposes'} "${name}"`, p =>
                command === 'defer' ? deferTask(p, parent, agent, spec) : proposeTask(p, parent, agent, spec));
            out(command === 'defer'
                ? `Deferred as ${result.id}. Mark the code with MVP(${result.id}) or TODO(${result.id}).`
                : `Proposed as ${result.id}, waiting for a human to accept it.`);
            return 0;
        }
        case 'accept':
        case 'decline': {
            const id = args[0] ?? fail(`Usage: mvplan ${command} <id>`);
            await store.mutate(`${command} proposal ${id}`, p => decideProposal(p, id, command === 'accept', asMscw(values.mscw)));
            out(`${command === 'accept' ? 'Accepted' : 'Declined'} ${id}.`);
            return 0;
        }
        case 'move': {
            const [id, parent] = args;
            if (!id || !parent) {
                fail('Usage: mvplan move <id> <parent-id> [--position N]');
            }
            const position = values.position === undefined ? undefined : Number.parseInt(values.position, 10);
            await store.mutate(`${agent} moves ${id} under ${parent}`, p => moveTask(p, id, parent, agent, position));
            out(`Moved ${id} under ${parent}.`);
            return 0;
        }
        case 'remove': {
            const id = args[0] ?? fail('Usage: mvplan remove <id>');
            const { result } = await store.mutate(`${agent} removes ${id}`, p => removeTask(p, id, agent));
            out(`Removed ${id} "${result.name}".`);
            return 0;
        }
        case 'apply': {
            const source = args[0] ?? fail('Usage: mvplan apply <file|->');
            const json = source === '-' ? await new Promise<string>(resolve => {
                let data = '';
                process.stdin.on('data', chunk => (data += chunk)).on('end', () => resolve(data));
            }) : await fs.readFile(source, 'utf-8');
            const edits = JSON.parse(json);
            if (!Array.isArray(edits)) {
                fail('apply expects a JSON array of edits.');
            }
            const { result } = await store.mutate(`${agent} applies ${edits.length} edit(s)`, p =>
                applyEdits(p, agent, edits, values['approved-by'] ?? agent));
            out(result.join('\n'));
            return 0;
        }
        default:
            fail(`Unknown command "${command}". Run "mvplan help".`);
    }
}

if (process.argv[1] && /cli\.(ts|js)$/.test(process.argv[1])) {
    main(process.argv.slice(2)).then(code => process.exit(code), error => {
        console.error(error instanceof PlanError ? error.message : error);
        process.exit(error instanceof PlanError ? 2 : 1);
    });
}
