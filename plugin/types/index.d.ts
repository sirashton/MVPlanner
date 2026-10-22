// The values the MVPlanner panel keeps in $.state. PanelView is the JSON that `mvplan view` prints.

export type Priority = 'Must' | 'Should' | 'Could' | "Won't"

export type PanelTask = { id: string; name: string; mscw: Priority; status: string; path: string }

export type PanelView = {
  name: string
  revision: number
  level: string
  status: string
  ladder: { label: string; done: number; total: number; isCurrent: boolean }[]
  proposals: (PanelTask & { description?: string; by?: string })[]
  claims: (PanelTask & { agent: string; branch?: string; since: string; lastActivity: string; isStale: boolean })[]
  next: (PanelTask & { blockedBy: string[]; acceptance: string[] })[]
  deferred: (PanelTask & { trigger?: string; markers: { file: string; line: number; kind: string }[] })[]
  activity: { at: string; agent?: string; id: string; name: string; text: string }[]
}

declare module 'claude-code' {
  interface PluginState {
    mvplanner: {
      view: PanelView | null
      error: string | null
      notice: string | null
      updatedAt: number
    }
  }
}
