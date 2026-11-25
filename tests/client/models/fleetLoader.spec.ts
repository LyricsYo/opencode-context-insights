import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createRoot, createSignal } from "solid-js"
import type { PanelProps } from "@opencode/plugin/gui"
import type { HeaderSummary } from "../../../src/shared/header.ts"
import type { FleetForest, FleetNode } from "../../../src/shared/fleet.ts"
import type { PanelView } from "../../../src/client/panelSupport.ts"
import { createFleetLoader } from "../../../src/client/models/fleetLoader.ts"
import { fleetNode, fleetForest } from "../helpers/fleetUi.ts"
import { makeRpc, makeSessionProps, settle } from "../helpers/session.ts"

const T0 = Date.UTC(2026, 10, 16, 8, 0)

const header = (at: number): HeaderSummary => ({
  at,
  systemHash: "s",
  toolsHash: "t",
  system: [{ key: "core", tokens: 50 }],
  tools: [{ name: "read", tokens: 20 }],
})

const sessionRow = (id: string, parentID?: string): Record<string, unknown> => ({
  id,
  ...(parentID !== undefined ? { parentID } : {}),
  title: id,
  agent: "build",
  model: { id: "m", providerID: "p" },
  tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 0,
  time: { created: T0, updated: T0 + 1000 },
  location: { directory: "D:/repo" },
  projectID: "p",
})

interface StoreOptions {
  readonly sessions: Array<Record<string, unknown>>
  readonly more?: (id: string) => boolean
  readonly loading?: (id: string) => boolean
  readonly loadMore?: (id: string, options: { all: boolean }) => Promise<void>
  readonly syncMessage?: (id: string) => Promise<void>
  readonly syncSession?: (id: string, options: { children: boolean }) => Promise<void>
}

function makeStore(options: StoreOptions) {
  return {
    listen: () => () => {},
    location: { model: { list: () => [] } },
    session: {
      missing: () => false,
      get: () => options.sessions[0],
      list: () => options.sessions,
      status: () => "idle",
      sync: options.syncSession ?? (async () => {}),
      message: {
        list: () => [],
        sync: options.syncMessage ?? (async () => {}),
        more: options.more ?? (() => false),
        loading: options.loading ?? (() => false),
        loadMore: options.loadMore ?? (async () => {}),
      },
    },
  }
}

const current = fleetNode({ id: "ses_test", isCurrent: true })
const childB = fleetNode({ id: "ses_b", parentID: "ses_test", directory: "", title: "B" })
const childC = fleetNode({ id: "ses_c", parentID: "ses_test", directory: "D:/other", title: "C" })
const childD = fleetNode({ id: "ses_d", parentID: "ses_test", directory: "", title: "D" })

const defaultForest = fleetForest([current, childB, childC, childD])

interface RunOptions {
  readonly forest?: FleetForest
  readonly view?: PanelView
  readonly methods?: readonly string[]
  readonly sessions?: Array<Record<string, unknown>>
  readonly more?: (id: string) => boolean
  readonly loading?: (id: string) => boolean
  readonly loadMore?: (id: string, options: { all: boolean }) => Promise<void>
  readonly syncMessage?: (id: string) => Promise<void>
  readonly syncSession?: (id: string, options: { children: boolean }) => Promise<void>
  readonly rpc?: Record<string, unknown>
}

interface Probe {
  readonly updates: Array<ReadonlyMap<string, readonly HeaderSummary[]>>
  readonly bumps: { stream: number; loaded: number }
  readonly headersCalls: Array<{ sessionID: string; directory: string }>
  readonly batchedCalls: Array<{ sessionIDs: string[]; directory: string }>
  readonly sessionSyncs: Array<{ id: string; children: boolean }>
  readonly messageSyncs: string[]
  readonly loadMores: Array<{ id: string; all: boolean }>
  readonly model: ReturnType<typeof createFleetLoader>
  setRevision(next: number): void
  setView(next: PanelView): void
  dispose(): void
}

/** Mounts the loader inside a root and records every call it makes. */
function probe(options: RunOptions = {}): Probe {
  const headersCalls: Probe["headersCalls"] = []
  const batchedCalls: Probe["batchedCalls"] = []
  const sessionSyncs: Probe["sessionSyncs"] = []
  const messageSyncs: Probe["messageSyncs"] = []
  const loadMores: Probe["loadMores"] = []
  const updates: Array<ReadonlyMap<string, readonly HeaderSummary[]>> = []
  const bumps = { stream: 0, loaded: 0 }
  const rpc = makeRpc({
    headers: async (input: { sessionID: string }, context: { location: { directory: string } }) => {
      headersCalls.push({ sessionID: input.sessionID, directory: context.location.directory })
      return { headers: [header(T0)] }
    },
    headersMany: async (input: { sessionIDs: string[] }, context: { location: { directory: string } }) => {
      batchedCalls.push({ sessionIDs: input.sessionIDs, directory: context.location.directory })
      return { headers: Object.fromEntries(input.sessionIDs.map((id) => [id, [header(T0)]])) }
    },
    ...options.rpc,
  })
  const props: PanelProps = makeSessionProps(undefined, rpc)
  const sessions = options.sessions ?? [sessionRow("ses_test")]
  ;(props.session.server as { data: unknown }).data = makeStore({
    sessions,
    more: options.more,
    loading: options.loading,
    loadMore: options.loadMore,
    syncMessage: async (id) => {
      messageSyncs.push(id)
      await options.syncMessage?.(id)
    },
    syncSession: async (id, syncOptions) => {
      sessionSyncs.push({ id, children: syncOptions.children })
      await options.syncSession?.(id, syncOptions)
    },
  })
  const view = createSignal<PanelView>(options.view ?? "fleet")
  const revision = createSignal(0)
  const methods = createSignal<readonly string[] | undefined>(options.methods)
  let store: ReadonlyMap<string, readonly HeaderSummary[]> = new Map()
  let stage: ReturnType<typeof createRoot> | undefined
  let disposeRoot: (() => void) | undefined
  const model = createRoot((dispose) => {
    disposeRoot = dispose
    stage = dispose
    return createFleetLoader({
      props,
      view: view[0],
      revision: revision[0],
      fleet: () => options.forest ?? defaultForest,
      setFleetHeaders: (next) => {
        store = typeof next === "function" ? next(store) : next
        updates.push(store)
      },
      bumpStream: () => {
        bumps.stream += 1
      },
      bumpFleetLoaded: () => {
        bumps.loaded += 1
      },
      hostMethods: methods[0],
    })
  })
  assert.ok(stage)
  return {
    updates,
    bumps,
    headersCalls,
    batchedCalls,
    sessionSyncs,
    messageSyncs,
    loadMores,
    model,
    setRevision: revision[1],
    setView: view[1],
    dispose: () => disposeRoot!(),
  }
}

const waitForHeaders = () => new Promise((resolve) => setTimeout(resolve, 130))

describe("createFleetLoader", () => {
  test("syncs the current family once the fleet tab opens", async () => {
    const match = probe({ sessions: [sessionRow("ses_test"), sessionRow("ses_b", "ses_test")] })
    await settle()
    assert.deepEqual(match.sessionSyncs, [
      { id: "ses_test", children: true },
      { id: "ses_b", children: true },
    ])
    match.setView("overview")
    match.setView("fleet")
    await settle()
    // The requested set keeps the second open from syncing again.
    assert.deepEqual(match.sessionSyncs, [
      { id: "ses_test", children: true },
      { id: "ses_b", children: true },
    ])
    match.dispose()
  })

  test("walks four levels deep and stops at the fifth", async () => {
    const sessions = [
      sessionRow("ses_test"),
      sessionRow("ses_b", "ses_test"),
      sessionRow("ses_c", "ses_b"),
      sessionRow("ses_d", "ses_c"),
      sessionRow("ses_e", "ses_d"),
    ]
    const seen: string[] = []
    const match = probe({
      sessions,
      syncSession: async (id) => {
        seen.push(id)
      },
    })
    // Let each sync settle so the walk can reach the next level before the next run.
    for (let index = 0; index < 6; index++) await settle()
    assert.deepEqual(seen, ["ses_test", "ses_b", "ses_c", "ses_d"])
    assert.deepEqual(
      match.sessionSyncs.map((call) => call.id),
      ["ses_test", "ses_b", "ses_c", "ses_d"],
    )
    match.dispose()
  })

  test("ignores a family sync failure and keeps walking the children it knows", async () => {
    const sessions = [sessionRow("ses_test"), sessionRow("ses_b", "ses_test"), sessionRow("ses_c", "ses_b")]
    const seen: string[] = []
    const match = probe({
      sessions,
      syncSession: async (id) => {
        seen.push(id)
        if (id === "ses_b") throw new Error("offline")
      },
    })
    for (let index = 0; index < 5; index++) await settle()
    // The store already lists ses_c under ses_b, so the rejected sync does not stop the walk.
    assert.deepEqual(seen, ["ses_test", "ses_b", "ses_c"])
    match.dispose()
  })

  test("batches the headers of every agent by directory", async () => {
    const match = probe()
    await settle()
    assert.deepEqual(match.batchedCalls, [
      { sessionIDs: ["ses_b", "ses_d"], directory: "D:/repo" },
      { sessionIDs: ["ses_c"], directory: "D:/other" },
    ])
    assert.equal(match.headersCalls.length, 0)
    await waitForHeaders()
    assert.deepEqual(
      [...(match.updates.at(-1) ?? new Map()).keys()].sort(),
      ["ses_b", "ses_c", "ses_d"],
    )
    match.dispose()
  })

  test("requests one header per node on an older host", async () => {
    const match = probe({ methods: ["hello", "prices"] })
    await settle()
    assert.equal(match.batchedCalls.length, 0)
    assert.deepEqual(match.headersCalls, [
      { sessionID: "ses_b", directory: "D:/repo" },
      { sessionID: "ses_d", directory: "D:/repo" },
      { sessionID: "ses_c", directory: "D:/other" },
    ])
    await waitForHeaders()
    assert.equal(match.updates.at(-1)?.size, 3)
    match.dispose()
  })

  test("falls back to one request per node when headersMany rejects", async () => {
    const match = probe({
      rpc: {
        headersMany: async () => {
          throw new Error("unknown method")
        },
      },
    })
    await settle()
    assert.equal(match.batchedCalls.length, 0)
    assert.deepEqual(match.headersCalls, [
      { sessionID: "ses_b", directory: "D:/repo" },
      { sessionID: "ses_d", directory: "D:/repo" },
      { sessionID: "ses_c", directory: "D:/other" },
    ])
    match.dispose()
  })

  test("splits a directory's family at the 64-id request cap", async () => {
    const nodes: FleetNode[] = [current]
    for (let index = 0; index < 65; index++) nodes.push(fleetNode({ id: `ses_${index}`, parentID: "ses_test" }))
    const match = probe({ forest: fleetForest(nodes) })
    await settle()
    assert.deepEqual(
      match.batchedCalls.map((call) => call.sessionIDs.length),
      [64, 1],
    )
    match.dispose()
  })

  test("stores an empty header list for a failed single request", async () => {
    const match = probe({
      rpc: {
        headers: async () => {
          throw new Error("gone")
        },
      },
      methods: [],
    })
    await waitForHeaders()
    assert.deepEqual([...(match.updates.at(-1) ?? new Map()).values()], [[], [], []])
    match.dispose()
  })

  test("stores an empty header list when a single reply has no headers field", async () => {
    const match = probe({ rpc: { headers: async () => ({}) }, methods: [] })
    await waitForHeaders()
    assert.deepEqual([...(match.updates.at(-1) ?? new Map()).values()], [[], [], []])
    match.dispose()
  })

  test("falls back to an empty list when a batch replies without headers", async () => {
    const match = probe({ rpc: { headersMany: async () => ({}) } })
    await waitForHeaders()
    assert.equal(match.updates.at(-1)?.get("ses_b")?.length, 0)
    match.dispose()
  })

  test("keeps requesting while the host methods are still unknown", async () => {
    const match = probe({ methods: undefined })
    await settle()
    assert.equal(match.batchedCalls.length, 2)
    match.dispose()
  })

  test("refetches after Refresh clears the header cache", async () => {
    const match = probe()
    await settle()
    match.model.clearHeaderCache()
    match.setRevision(1)
    await settle()
    assert.equal(match.batchedCalls.length, 4)
    match.dispose()
  })

  test("ignores a node that already has a header request in flight", async () => {
    const match = probe()
    await settle()
    match.setRevision(1)
    await settle()
    // Revision re-runs the effect, but every node is in the requested set already.
    assert.equal(match.batchedCalls.length, 2)
    match.dispose()
  })

  test("flushes a single header patch for each node", async () => {
    const match = probe({ methods: [] })
    await settle()
    // The three one-off replies queued before the timer fired share one update.
    assert.equal(match.updates.length, 0)
    await waitForHeaders()
    assert.equal(match.updates.length, 1)
    assert.equal(match.updates[0].size, 3)
    match.dispose()
  })

  test("drops a pending header flush when the panel unmounts", async () => {
    const match = probe()
    await settle()
    match.dispose()
    await waitForHeaders()
    assert.equal(match.updates.length, 0)
  })

  test("ignores a stale flush timer whose batch already landed", async () => {
    // A timer that fires twice must find its pending batch empty and leave the map alone.
    const timers: Array<() => void> = []
    const original = globalThis.setTimeout
    globalThis.setTimeout = ((callback: () => void, delay?: number, ...rest: unknown[]) => {
      if (delay === 100) timers.push(callback)
      return original(callback, delay, ...rest)
    }) as typeof globalThis.setTimeout
    try {
      const match = probe({ methods: [] })
      await settle()
      await waitForHeaders()
      const updates = match.updates.length
      assert.equal(updates, 1)
      for (const timer of timers) timer()
      assert.equal(match.updates.length, updates)
      match.dispose()
    } finally {
      globalThis.setTimeout = original
    }
  })

  test("syncs each agent's messages, then bumps the panel timers", async () => {
    const match = probe()
    await settle()
    assert.deepEqual(match.messageSyncs, ["ses_b", "ses_c", "ses_d"])
    assert.equal(match.bumps.stream > 0, true)
    assert.equal(match.bumps.loaded > 0, true)
    match.setView("overview")
    match.setView("fleet")
    await settle()
    assert.deepEqual(match.messageSyncs, ["ses_b", "ses_c", "ses_d"])
    match.dispose()
  })

  test("loads the rest of a log that still holds more", async () => {
    const loaded: Array<{ id: string; all: boolean }> = []
    const match = probe({
      more: () => true,
      loading: () => false,
      loadMore: async (id, options) => {
        loaded.push({ id, all: options.all })
      },
    })
    await settle()
    assert.deepEqual(loaded, [
      { id: "ses_b", all: true },
      { id: "ses_c", all: true },
      { id: "ses_d", all: true },
    ])
    match.dispose()
  })

  test("skips loadMore while a log is already loading", async () => {
    const loaded: Array<{ id: string; all: boolean }> = []
    const match = probe({
      more: () => true,
      loading: () => true,
      loadMore: async (id, options) => {
        loaded.push({ id, all: options.all })
      },
    })
    await settle()
    assert.deepEqual(loaded, [])
    assert.equal(match.bumps.stream > 0, true)
    match.dispose()
  })

  test("stops at one agent's log when a message sync fails", async () => {
    const match = probe({
      syncMessage: async () => {
        throw new Error("offline")
      },
    })
    await settle()
    assert.equal(match.bumps.stream, 0)
    assert.equal(match.bumps.loaded, 0)
    match.dispose()
  })
})
