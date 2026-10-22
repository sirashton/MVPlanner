import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { PanelView } from '../types'

// The MVPlanner panel: the live plan beside the chat, for the human reviewing it.
// It reads the plan through the plugin's own CLI, so it sees exactly what agents see.

const PANE = 'mvplanner'
const REFRESH_MS = 30_000
const view = atom({ plugin: 'mvplanner', key: 'view' } as const, null)
const error = atom({ plugin: 'mvplanner', key: 'error' } as const, null)
const notice = atom({ plugin: 'mvplanner', key: 'notice' } as const, null)
const updatedAt = atom({ plugin: 'mvplanner', key: 'updatedAt' } as const, 0)
const showAll = atom({ plugin: 'mvplanner', key: 'showAll' } as const, false)

type TreeRow = PanelView['tree'][number]

// Focused, the tree keeps the top two levels, the critical path and every branch with claimed work;
// finished and off-path branches fold into a count on their parent.
function visibleRows(tree: TreeRow[], all: boolean): { row: TreeRow; hidden: number }[] {
  const shown = (row: TreeRow) => all || row.depth <= 1 || row.hasActiveWork || (row.isOnPath && row.status !== 'Complete')
  const byParent = new Map<string, TreeRow[]>()
  for (const row of tree) {
    if (row.parent) byParent.set(row.parent, [...(byParent.get(row.parent) ?? []), row])
  }
  const out: { row: TreeRow; hidden: number }[] = []
  const visit = (row: TreeRow) => {
    const children = byParent.get(row.id) ?? []
    const kept = children.filter(shown)
    out.push({ row, hidden: children.length - kept.length })
    kept.forEach(visit)
  }
  const root = tree[0]
  if (root) visit(root)
  return out
}

function markFor(row: TreeRow): string {
  if (row.agent) return '▶'
  if (row.status === 'Complete') return '✓'
  if (row.status === 'Blocked') return '!'
  if (row.status === 'In Progress') return '~'
  return '·'
}

const bar = (done: number, total: number, width: number) => {
  const filled = total === 0 ? width : Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const clip = (text: string, width: number) => (text.length > width ? `${text.slice(0, Math.max(1, width - 1))}…` : text)

const age = (iso: string, now: number) => {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`
}

let env: Record<string, string> = {}

async function cli($: EngineInterface, args: string[]) {
  return $.process.run(['node', `${$.plugin.root}/dist/cli.js`, ...args], {
    env: { ...env, MVPLANNER_AGENT: 'human' },
    timeoutMs: 60_000,
  })
}

async function refresh($: EngineInterface): Promise<boolean> {
  const ran = await cli($, ['view']).catch((reason: unknown) => ({ exitCode: 1, stdout: '', stderr: String(reason) }))
  if (ran.exitCode !== 0) {
    await update($, error, () => ran.stderr.trim().split('\n')[0] || 'Could not read the plan.')
    return false
  }
  await update($, view, () => JSON.parse(ran.stdout) as PanelView)
  await update($, error, () => null)
  await update($, updatedAt, () => Date.now())
  return true
}

// A press in the panel is the human's own decision, so it may accept or decline a proposal.
async function decide($: EngineInterface, id: string, accept: boolean) {
  const ran = await cli($, [accept ? 'accept' : 'decline', id])
  await update($, notice, () => (ran.exitCode === 0 ? `${accept ? 'Accepted' : 'Declined'} ${id}.` : ran.stderr.trim() || `Could not update ${id}.`))
  await refresh($)
}

export const register: Register = (on, options) => {
  env = {}
  if (typeof options.backend === 'string' && options.backend) env.MVPLANNER_BACKEND = options.backend
  if (typeof options.branch === 'string' && options.branch) env.MVPLANNER_BRANCH = options.branch

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await $.command.register({ name: 'plan-panel', description: 'Show the MVPlanner plan in a panel beside the chat' })
    // Open the panel only in repos that have a plan, so the plugin stays quiet elsewhere.
    if (await refresh($)) {
      void $.ui.open({ id: PANE, title: 'Plan' })
    }
    $.clock.every(REFRESH_MS, () => refresh($))
    return started
  })

  on('command.run', { command: 'plan-panel' }, async $ => {
    await refresh($)
    const opened = await $.ui.open({ id: PANE, title: 'Plan' })
    return { text: opened.isPlaced ? 'MVPlanner panel opened.' : 'This view has no room for a panel; try a wider window.' }
  })

  // Redraw as soon as an agent here changes the plan; other agents' changes arrive on the timer.
  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (/mvplanner/i.test(e.tool) && /task_|plan_/.test(e.tool)) {
      await refresh($).catch(() => false)
    }
    return ran
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const plan = await read($, view)
    const problem = await read($, error)
    const message = await read($, notice)
    const all = await read($, showAll)
    const width = Math.max(24, e.props.bodyColumns)
    const now = Date.now()

    if (!plan) {
      return (
        <Box flexDirection="column" gap={1}>
          {problem && /no plan/i.test(problem) ? (
            <Box flexDirection="column">
              <Text weight="bold">No MVPlanner plan here</Text>
              <Text dimColor>To start one, run: mvplan init --name "My project"</Text>
            </Box>
          ) : (
            <Box flexDirection="column">
              <Text weight="bold">{problem ? 'Could not read the plan' : 'Loading the plan…'}</Text>
              {problem ? <Text dimColor>{clip(problem, width * 3)}</Text> : null}
            </Box>
          )}
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
        </Box>
      )
    }

    const section = (title: string, count?: number) => (
      <Text weight="bold">
        {title}
        {count !== undefined ? <Text dimColor> {count}</Text> : null}
      </Text>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text weight="bold" size="heading">{clip(plan.name, width)}</Text>
          <Text color={plan.level === 'Must' ? 'red' : plan.level === 'Should' ? 'yellow' : 'green'}>{plan.status}</Text>
          {problem ? <Text color="red">{clip(problem, width)}</Text> : null}
          {message ? <Text dimColor>{clip(message, width)}</Text> : null}
        </Box>

        <Box flexDirection="column">
          {plan.ladder.map(rung => (
            <Text mono>
              {rung.isCurrent ? '▸ ' : '  '}
              {rung.label.padEnd(13)}
              {bar(rung.done, rung.total, Math.max(6, Math.min(16, width - 24)))} {rung.done}/{rung.total}
            </Text>
          ))}
        </Box>

        <Box flexDirection="column">
          {section('Needs your decision', plan.proposals.length)}
          {plan.proposals.length === 0 ? <Text dimColor>No proposals waiting.</Text> : null}
          {plan.proposals.map(task => (
            <Box flexDirection="column">
              <Text>
                <Text mono dimColor>{task.id} </Text>
                {clip(task.name, width - 8)} <Text dimColor>({task.mscw}{task.by ? `, from ${task.by}` : ''})</Text>
              </Text>
              <Box gap={1}>
                <Button key={`accept-${task.id}`} label="Accept" variant="primary" onPress={() => decide($, task.id, true)} />
                <Button key={`decline-${task.id}`} label="Decline" onPress={() => decide($, task.id, false)} />
              </Box>
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          <Box gap={1}>
            {section('Plan')}
            <Button key="tree-mode" label={all ? 'Focus' : 'Show all'} onPress={() => update($, showAll, value => !value)} />
          </Box>
          <Text dimColor>▶ being worked on  ~ in progress  · not started  ✓ done  next = up for grabs</Text>
          {visibleRows(plan.tree, all).map(({ row, hidden }) => {
            const isNext = !row.agent && plan.next.some(task => task.id === row.id)
            const indent = '  '.repeat(row.depth)
            const room = width - indent.length - 2
            const isDone = row.status === 'Complete'
            const label = clip(row.name, Math.max(8, room - (row.agent ? row.agent.length + 3 : 0) - (isNext ? 5 : 0) - (hidden ? 9 : 0)))
            return (
              <Text dimColor={isDone || (!row.isOnPath && !row.agent && row.status === 'Not Started')}>
                {indent}
                <Text color={row.agent ? 'cyan' : isDone ? 'green' : undefined}>{markFor(row)} </Text>
                {row.agent ? <Text weight="bold">{label}</Text> : label}
                {row.agent ? <Text color="cyan"> ← {row.agent}</Text> : null}
                {isNext ? <Text color="yellow"> next</Text> : null}
                {row.depth > 0 && row.mscw !== 'Must' && !isDone ? <Text dimColor> {row.mscw}</Text> : null}
                {hidden ? <Text dimColor> +{hidden} more</Text> : null}
              </Text>
            )
          })}
        </Box>

        <Box flexDirection="column">
          {section('Working now', plan.claims.length)}
          {plan.claims.length === 0 ? <Text dimColor>No agent has a task claimed.</Text> : null}
          {plan.claims.map(task => (
            <Text>
              <Text mono dimColor>{task.id} </Text>
              {clip(task.name, width - 20)}{' '}
              <Text color={task.isStale ? 'yellow' : undefined} dimColor={!task.isStale}>
                {task.agent} · {task.isStale ? `quiet for ${age(task.lastActivity, now)}` : age(task.lastActivity, now)}
              </Text>
            </Text>
          ))}
        </Box>

        <Box flexDirection="column">
          {section('Next up', plan.next.length)}
          {plan.next.length === 0 ? <Text dimColor>Nothing unclaimed on the critical path.</Text> : null}
          {plan.next.slice(0, 4).map(task => (
            <Text>
              <Text mono dimColor>{task.id} </Text>
              {clip(task.name, width - 8)}
              {task.blockedBy.length ? <Text color="yellow"> waits on {task.blockedBy.join(', ')}</Text> : null}
            </Text>
          ))}
        </Box>

        <Box flexDirection="column">
          {section('Deferred', plan.deferred.length)}
          {plan.deferred.length === 0 ? <Text dimColor>No deferred work.</Text> : null}
          {plan.deferred.slice(0, 4).map(task => (
            <Box flexDirection="column">
              <Text>
                <Text mono dimColor>{task.id} </Text>
                {clip(task.name, width - 8)} <Text dimColor>({task.mscw})</Text>
              </Text>
              {task.trigger ? <Text dimColor>  when: {clip(task.trigger, width - 8)}</Text> : null}
              {task.markers.slice(0, 2).map(m => <Text mono dimColor>  {clip(`${m.kind} ${m.file}:${m.line}`, width - 2)}</Text>)}
            </Box>
          ))}
        </Box>

        <Box flexDirection="column">
          {section('Recent')}
          {plan.activity.slice(0, 5).map(item => (
            <Text dimColor>{clip(`${age(item.at, now)} ${item.id} ${item.agent ? `${item.agent}: ` : ''}${item.text}`, width)}</Text>
          ))}
        </Box>

        <Box gap={1}>
          <Button key="refresh" label="Refresh" onPress={() => refresh($)} />
          <Text dimColor>rev {plan.revision}</Text>
        </Box>
      </Box>
    )
  })
}
