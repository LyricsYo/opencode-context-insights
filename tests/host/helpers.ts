import plugin from "../../src/host/index.ts"

export interface StorageLike {
  readonly map: Map<string, unknown>
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  scan(options: { prefix: string; after?: string; limit?: number }): Promise<{
    entries: ReadonlyArray<{ key: string; value: unknown }>
    next?: string
  }>
}

export function makeStorage(): StorageLike {
  const map = new Map<string, unknown>()
  return {
    map,
    async get(key) {
      return map.get(key)
    },
    async set(key, value) {
      map.set(key, value)
    },
    async scan({ prefix, after, limit = 100 }) {
      const keys = [...map.keys()].filter((key) => key.startsWith(prefix)).sort()
      const start = after === undefined ? 0 : keys.findIndex((key) => key > after)
      const index = start < 0 ? keys.length : start
      const entries = keys.slice(index, index + limit).map((key) => ({ key, value: map.get(key) }))
      const next = index + limit < keys.length ? entries.at(-1)?.key : undefined
      return { entries, next }
    },
  }
}

export type Handlers = Record<string, (input: unknown) => Promise<unknown>>

/** The host contract surface the plugin setup reads: storage, session hooks and RPC registration. */
export function makePluginContext(storage: StorageLike) {
  let handlers: Handlers = {}
  let hook: ((event: unknown) => Promise<void>) | undefined
  const ctx = {
    app: { name: "opencode", version: "2.2.6", channel: "stable" },
    storage,
    session: {
      hook: async (_name: string, fn: (event: unknown) => Promise<void>) => {
        hook = fn
      },
    },
    rpc: {
      register: async (_definition: unknown, registered: Handlers) => {
        handlers = registered
      },
    },
  }
  return { ctx, handlers: () => handlers, hook: () => hook }
}

export function makePlugin() {
  return plugin
}
