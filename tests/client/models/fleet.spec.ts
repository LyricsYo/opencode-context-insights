import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createComputed, createRoot, createSignal } from "solid-js"
import type { PanelProps } from "@opencode/plugin/gui"
import type { HeaderSummary } from "../../../src/shared/header.ts"
import { buildPriceBook, type PriceBook } from "../../../src/shared/cost.ts"
import type { FleetDelegation, FleetNode } from "../../../src/shared/fleet.ts"
import type { PanelView } from "../../../src/client/panelSupport.ts"
import { createFleetModel } from "../../../src/client/models/fleet.ts"
import { fleetHue } from "../../../src/client/fleetModel.ts"
import { fleetNode } from "../helpers/fleetUi.ts"
import { makeSessionProps } from "../helpers/session.ts"

const T0 = Date.UTC(2026, 10, 16, 8, 0)

type Row = Record<string, unknown>
type MessageMap = Record<string, Array<Row>>

interface DataOptions {
  readonly sessions: Row[]
  readonly messages: MessageMap
  readonly models?: readonly unknown[]
  readonly running?: readonly string[]
}

/** A session row shaped like the app's data store: status and message lists per id. */
function makeData(options: DataOptions) {
  const running = new Set(options.running ?? [])
  return {
    listen: () => () => {},
    location: { model: { list: () => options.models ?? [] } },
    session: {
      missing: () => false,
      get: () => options.sessions[0],
      list: () => options.sessions,
      status: (id: string) => (running.has(id) ? "running" : "idle"),
      sync: async () => {},
      message: {
        list: (id: string) => options.messages[id] ?? [],
        sync: async () => {},
        more: () => false,
        loading: () => false,
        loadMore: async () => {},
      },
    },
  }
}

function sessionRow(id: string, patch: Row = {}): Row {
  return {
    id,
    title: `session ${id}`,
    agent: "build",
    model: { id: "m", providerID: "p" },
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.01,
    time: { created: T0, updated: T0 + 60_000 },
    location: { directory: "D:/repo" },
    projectID: "p",
    ...patch,
  }
}

const assistant = (id: string, patch: Row = {}): Row => ({
  id,
  type: "assistant",
  agent: "build",
  model: { id: "m", providerID: "p" },
  time: { created: T0 + 1000, completed: T0 + 2000 },
  content: [{ type: "text", text: "done" }],
  tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 0.01,
  ...patch,
})

const user = (id: string, text = "go"): Row => ({ id, type: "user", text, time: { created: T0 } })

const header = (at: number): HeaderSummary => ({
  at,
  systemHash: "s",
  toolsHash: "t",
  system: [{ key: "core", tokens: 50 }],
  tools: [{ name: "read", tokens: 20 }],
})

const priceBook: PriceBook = buildPriceBook({
  p: { models: { m: { cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 } } } },
}) as PriceBook

/** Root plus three children, one with a user tail and one with no log at all. */
function family(overrides: Partial<MessageMap> = {}): { sessions: Row[]; messages: MessageMap } {
  return {
    sessions: [
      sessionRow("ses_test"),
      sessionRow("ses_child", { parentID: "ses_test" }),
      sessionRow("ses_skip", { parentID: "ses_test" }),
      sessionRow("ses_empty", { parentID: "ses_test" }),
    ],
    messages: {
      ses_test: [user("u1"), assistant("a1"), user("u2"), assistant("a2")],
      ses_child: [user("c1"), assistant("c1a")],
      ses_skip: [user("s1")],
      ses_empty: [],
      ...overrides,
    },
  }
}

interface Controls {
  tick(): void
  setHeaders(next: HeaderSummary[] | undefined): void
  setBook(next: PriceBook | undefined): void
  setView(next: PanelView): void
  setRunning(ids: readonly string[]): void
}

interface Params {
  readonly sessions?: Row[]
  readonly messages?: MessageMap
  readonly models?: readonly unknown[]
  readonly running?: readonly string[]
  readonly headers?: HeaderSummary[]
  readonly book?: PriceBook
  readonly view?: PanelView
  readonly props?: PanelProps
}

/** Runs a probe inside a root so the model's memos and effects are tracked and disposable. */
function probe<T>(run: (model: ReturnType<typeof createFleetModel>, controls: Controls) => T, params: Params = {}): T {
  const data = family()
  const sessions = params.sessions ?? data.sessions
  const running = createSignal<readonly string[]>(params.running ?? [])
  const messages = params.messages ?? data.messages
  const view = createSignal<PanelView>(params.view ?? "fleet")
  const headers = createSignal<HeaderSummary[] | undefined>(params.headers)
  const book = createSignal<PriceBook | undefined>(params.book === undefined ? priceBook : params.book)
  const structure = createSignal(0)
  const childStructure = createSignal(0)
  const loaded = createSignal(0)
  const stream = createSignal(0)
  const props = params.props ?? makeSessionProps()
  ;(props.session.server as unknown as { data: unknown }).data = makeData({
    sessions,
    messages,
    models: params.models,
    running: [],
  })
  // Status reads the running signal so a test can flip an agent live mid-run.
  const store = (props.session.server as unknown as { data: ReturnType<typeof makeData> }).data
  store.session.status = (id: string) => (running[0]().includes(id) ? "running" : "idle")
  const bump = (setter: (value: (current: number) => number) => void) => setter((value) => value + 1)
  const controls: Controls = {
    tick: () => {
      bump(structure[1])
      bump(childStructure[1])
      bump(loaded[1])
      bump(stream[1])
    },
    setHeaders: (next) => headers[1](next),
    setBook: (next) => book[1](next),
    setView: (next) => view[1](next),
    setRunning: (ids) => running[1](ids),
  }
  return createRoot((dispose) => {
    const model = createFleetModel({
      props,
      view: view[0],
      headers: headers[0],
      priceBook: book[0],
      structureTick: structure[0],
      childStructureTick: childStructure[0],
      fleetLoadedTick: loaded[0],
      streamTick: stream[0],
    })
    try {
      return run(model, controls)
    } finally {
      dispose()
    }
  })
}

/** Reads every memo once so the empty fallbacks and the populated path both run. */
function readAll(model: ReturnType<typeof createFleetModel>) {
  return {
    fleet: model.fleet(),
    running: model.fleetRunning(),
    hues: model.fleetHues(),
    byID: model.fleetByID(),
    current: model.fleetCurrent(),
    inspected: model.fleetInspected(),
    layout: model.fleetLayout(),
    lit: model.fleetLit(),
    models: model.fleetModelList(),
    heads: model.fleetHeads(),
    detail: model.fleetInspectedDetail(),
    delegations: model.fleetDelegations(),
    incoming: model.fleetIncoming(),
    chain: model.fleetChain(),
    timeline: model.fleetTimeline(),
    summary: model.fleetSummary(),
    categories: model.fleetCategories(),
  }
}

const idsOf = (set: ReadonlySet<string> | undefined) => [...(set ?? [])].sort()

describe("createFleetModel", () => {
  test("returns the empty fallbacks while the panel is not on the fleet tab", () => {
    const read = probe((model) => readAll(model), { view: "overview" })
    assert.deepEqual(read.fleet, { nodes: [], edges: [], rootID: "", solo: true })
    assert.equal(read.running, false)
    // The overview still gets fleet hues for its subagent circles.
    assert.equal(read.hues.size, 4)
    assert.deepEqual([...read.heads.entries()], [])
    assert.deepEqual([...read.delegations.entries()], [])
    assert.equal(read.detail, undefined)
    assert.deepEqual(read.timeline, {
      rows: [],
      start: 0,
      end: 1,
      now: 0,
      ticks: [],
      buckets: [],
      peak: 0,
      links: [],
      segments: [],
      active: 0,
      activeSum: 0,
    })
    assert.equal(read.summary.agents, 0)
    assert.deepEqual(read.categories, [])
    assert.equal(read.lit, undefined)
    assert.equal(read.chain, undefined)
  })

  test("maps every session to the hue the fleet draws for it", () => {
    const read = probe((model, controls) => {
      const overview = model.fleetHues()
      controls.setView("fleet")
      const nodes = model.fleet().nodes
      return { overview, nodes }
    }, { view: "overview" })
    // The overview builds the same forest, so every id maps to the fleet's own family hue.
    assert.equal(read.overview.size, read.nodes.length)
    for (const node of read.nodes) assert.equal(read.overview.get(node.id), fleetHue(node))
    assert.equal(read.overview.get("ses_test"), "#5b8def")
    assert.notEqual(read.overview.get("ses_child"), "#5b8def")
  })

  test("has no hues outside the overview and the fleet tabs", () => {
    const read = probe((model) => model.fleetHues(), { view: "browser" })
    assert.equal(read.size, 0)
  })

  test("builds the forest, picks the current node and resolves the inspector", () => {
    const read = probe((model) => {
      const first = readAll(model)
      const fallback = model.fleetInspected()
      model.setFleetPinned("ses_child")
      const pinned = model.fleetInspected()
      model.setFleetPinned(undefined)
      model.setFleetHover("ses_ghost")
      const missing = model.fleetInspected()
      model.setFleetHover("ses_child")
      const hovered = model.fleetInspected()
      return { first, fallback, pinned, missing, hovered }
    })

    assert.deepEqual(read.first.fleet.nodes.map((node) => node.id), [
      "ses_test",
      "ses_child",
      "ses_empty",
      "ses_skip",
    ])
    assert.deepEqual(read.first.fleet.edges, [
      { from: "ses_test", to: "ses_child" },
      { from: "ses_test", to: "ses_empty" },
      { from: "ses_test", to: "ses_skip" },
    ])
    assert.equal(read.first.current?.id, "ses_test")
    assert.equal(read.fallback?.id, "ses_test")
    assert.equal(read.pinned?.id, "ses_child")
    assert.equal(read.missing?.id, "ses_test")
    assert.equal(read.hovered?.id, "ses_child")
    assert.equal(read.first.layout.points.length, 4)
    assert.equal(read.first.byID.size, 4)
  })

  test("returns no current node when the session is not in the store", () => {
    const props = makeSessionProps()
    ;(props.session as { id: string }).id = "ses_missing"
    const read = probe(
      (model) => ({
        nodes: model.fleet().nodes,
        current: model.fleetCurrent(),
        inspected: model.fleetInspected(),
        detail: model.fleetInspectedDetail(),
      }),
      { props },
    )
    assert.deepEqual(read.nodes, [])
    assert.equal(read.current, undefined)
    assert.equal(read.inspected, undefined)
    assert.equal(read.detail, undefined)
  })

  test("lights the hovered node's neighbours and its whole chain", () => {
    const read = probe((model) => {
      const none = { lit: model.fleetLit(), chain: model.fleetChain() }
      model.setFleetHover("ses_child")
      const child = { lit: model.fleetLit(), chain: model.fleetChain() }
      model.setFleetHover(undefined)
      model.setFleetPinned("ses_test")
      const root = { lit: model.fleetLit(), chain: model.fleetChain() }
      return { none, child, root }
    })

    assert.equal(read.none.lit, undefined)
    assert.equal(read.none.chain, undefined)
    assert.deepEqual(idsOf(read.child.lit), ["ses_child", "ses_test"])
    assert.deepEqual(idsOf(read.child.chain), ["ses_child", "ses_empty", "ses_skip", "ses_test"])
    assert.deepEqual(idsOf(read.root.lit), ["ses_child", "ses_empty", "ses_skip", "ses_test"])
    assert.deepEqual(idsOf(read.root.chain), ["ses_child", "ses_empty", "ses_skip", "ses_test"])
  })

  test("resolves the model list and the context limit per node", () => {
    const models = [
      { providerID: "p", id: "m", limit: { context: 1000 } },
      { providerID: "q", modelID: "n", limit: { context: 2000 } },
    ]
    const read = probe(
      (model) => ({
        list: model.fleetModelList(),
        byID: model.fleetLimitOf(fleetNode({ id: "a", provider: "p", model: "m" })),
        byModelID: model.fleetLimitOf(fleetNode({ id: "b", provider: "q", model: "n" })),
        unknown: model.fleetLimitOf(fleetNode({ id: "c", provider: "z", model: "x" })),
        bare: model.fleetLimitOf(fleetNode({ id: "d" })),
        modelOnly: model.fleetLimitOf(fleetNode({ id: "e", model: "m" })),
        providerOnly: model.fleetLimitOf(fleetNode({ id: "f", provider: "p" })),
      }),
      { models },
    )
    assert.equal(read.list?.length, 2)
    assert.equal(read.byID, 1000)
    assert.equal(read.byModelID, 2000)
    assert.equal(read.unknown, undefined)
    assert.equal(read.bare, undefined)
    assert.equal(read.modelOnly, undefined)
    assert.equal(read.providerOnly, undefined)
  })

  test("returns no model list when the session has no location", () => {
    const props = makeSessionProps()
    ;(props.session as { location?: unknown }).location = undefined
    const read = probe((model) => ({
      models: model.fleetModelList(),
      limit: model.fleetLimitOf(fleetNode({ id: "a", provider: "p", model: "m" })),
    }), { props })
    assert.equal(read.models, undefined)
    assert.equal(read.limit, undefined)
  })

  test("keys each head on the node's log, versions and price book", () => {
    const read = probe(
      (model, controls) => {
        const first = model.fleetHeads()
        const again = model.fleetHeads()
        controls.tick()
        const moved = model.fleetHeads()
        model.setFleetHeaders(new Map([["ses_child", [header(T0)]]]))
        const fetched = model.fleetHeads()
        controls.setHeaders(undefined)
        const own = model.fleetHeads()
        controls.setBook(undefined)
        const noBook = model.fleetHeads()
        return { first, again, moved, fetched, own, noBook }
      },
      { headers: [header(T0)] },
    )

    assert.equal(read.first.size, 4)
    assert.equal(read.first.get("ses_test")?.steps, 2)
    assert.equal(read.first.get("ses_test")?.prompt?.text, "go")
    assert.equal(read.first.get("ses_test")?.composition?.headerMissing, false)
    assert.equal(read.first.get("ses_test")?.cost !== undefined, true)
    assert.equal(read.again, read.first)
    assert.equal(read.moved, read.first)
    assert.equal(read.fetched.get("ses_child")?.composition?.headerPending, false)
    assert.notEqual(read.fetched, read.first)
    assert.equal(read.own.get("ses_test")?.composition?.headerPending, true)
    assert.equal(read.noBook.size, 4)
  })

  test("drops the oldest head once the cache passes 512 entries", () => {
    const messages: MessageMap = family().messages
    const read = probe(
      (model, controls) => {
        for (let index = 0; index < 513; index++) {
          messages.ses_test = [
            user("u1"),
            assistant(`a-${index}`, { time: { created: T0 + index, completed: T0 + index + 1 } }),
          ]
          controls.tick()
          model.fleetHeads()
        }
        return model.fleetHeads().size
      },
      { messages },
    )
    assert.equal(read, 4)
  })

  test("reuses the previous head map while every head keeps its identity", () => {
    const read = probe((model, controls) => {
      const first = model.fleetHeads()
      controls.tick()
      const second = model.fleetHeads()
      return { first, second }
    })
    assert.equal(read.first, read.second)
  })

  test("rebuilds the head map when a node leaves the family", () => {
    const sessions = family().sessions
    const read = probe(
      (model, controls) => {
        const first = model.fleetHeads()
        sessions.splice(3, 1)
        controls.setView("overview")
        controls.setView("fleet")
        const second = model.fleetHeads()
        return { first, second, sizes: [first.size, second.size] }
      },
      { sessions },
    )
    assert.deepEqual(read.sizes, [4, 3])
    assert.notEqual(read.first, read.second)
  })

  test("builds the inspector transcript from the pinned node", () => {
    const read = probe((model) => {
      model.setFleetPinned("ses_child")
      return model.fleetInspectedDetail()
    })
    assert.equal(read?.rows.length, 2)
    assert.equal(read?.reply?.text, "done")
    assert.equal(read?.steps, 1)
  })

  test("reuses the inspector transcript across a hover while the log holds", () => {
    const read = probe((model, controls) => {
      const first = model.fleetInspectedDetail()
      model.setFleetHover("ses_test")
      const hovered = model.fleetInspectedDetail()
      controls.tick()
      const again = model.fleetInspectedDetail()
      model.setFleetHover(undefined)
      const back = model.fleetInspectedDetail()
      return { first, hovered, again, back }
    })
    assert.equal(read.hovered, read.first)
    assert.equal(read.again, read.first)
    assert.equal(read.back, read.first)
  })

  test("rebuilds the transcript cache when the log grows or the tail moves", () => {
    const messages: MessageMap = {
      ses_test: [user("u1"), assistant("a1")],
      ses_child: [],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe(
      (model, controls) => {
        const first = model.fleetInspectedDetail()
        messages.ses_test = [user("u1"), assistant("a1"), user("u2"), assistant("a2")]
        controls.tick()
        const grown = model.fleetInspectedDetail()
        messages.ses_test = [...messages.ses_test, user("u3")]
        controls.tick()
        const tail = model.fleetInspectedDetail()
        return { first, grown, tail }
      },
      { messages },
    )
    assert.equal(read.first?.rows.length, 2)
    assert.equal(read.grown?.rows.length, 4)
    assert.equal(read.tail?.rows.length, 5)
  })

  test("keeps the transcript cache to its last eight keys", () => {
    const messages: MessageMap = {
      ses_test: [user("u1"), assistant("a1")],
      ses_child: [],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe(
      (model, controls) => {
        const sizes: Array<number | undefined> = []
        for (let index = 0; index < 10; index++) {
          messages.ses_test = [user(`u-${index}`), assistant(`a-${index}`, { time: { created: T0 + index, completed: T0 + index + 1 } })]
          controls.tick()
          sizes.push(model.fleetInspectedDetail()?.rows.length)
        }
        return sizes
      },
      { messages },
    )
    assert.deepEqual(read, [2, 2, 2, 2, 2, 2, 2, 2, 2, 2])
  })

  test("merges a streaming tail into the cached transcript", () => {
    const tail = assistant("live", { time: { created: T0 + 5000 }, content: [{ type: "text", text: "streaming" }] })
    const messages: MessageMap = {
      ses_test: [user("u1"), assistant("a1"), tail],
      ses_child: [],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe(
      (model, controls) => {
        const first = model.fleetInspectedDetail()
        controls.tick()
        const again = model.fleetInspectedDetail()
        tail.content = [{ type: "text", text: "more text" }]
        controls.tick()
        const changed = model.fleetInspectedDetail()
        return { first, again, changed }
      },
      { messages },
    )
    assert.equal(read.first?.rows.at(-1)?.text, "streaming")
    assert.equal(read.again, read.first)
    assert.notEqual(read.changed, read.first)
    assert.equal(read.changed?.rows.at(-1)?.text, "more text")
  })

  test("returns the same transcript when the live tail produced identical rows", () => {
    const tail = assistant("live", { time: { created: T0 + 5000 }, content: [{ type: "text", text: "same" }] })
    const messages: MessageMap = {
      ses_test: [user("u1"), tail],
      ses_child: [],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe(
      (model, controls) => {
        const first = model.fleetInspectedDetail()
        controls.tick()
        const again = model.fleetInspectedDetail()
        return { first, again }
      },
      { messages },
    )
    assert.equal(read.again, read.first)
  })

  test("leaves a settled tail alone in the transcript", () => {
    const read = probe((model) => model.fleetInspectedDetail())
    assert.equal(read?.rows.length, 4)
    assert.equal(read?.reply?.text, "done")
  })

  test("skips the live merge for a transcript whose tail is a prompt", () => {
    const messages: MessageMap = {
      ses_test: [assistant("a1"), user("u1")],
      ses_child: [],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe((model) => model.fleetInspectedDetail(), { messages })
    assert.equal(read?.rows.length, 2)
    assert.equal(read?.reply?.text, "done")
  })

  test("skips the live merge when the tail has no message", () => {
    const messages: MessageMap = { ses_test: [], ses_child: [], ses_skip: [], ses_empty: [] }
    const read = probe((model) => model.fleetInspectedDetail(), { messages })
    assert.equal(read?.rows.length, 0)
  })

  test("groups delegations under their parent and keys them on the parent log", () => {
    const delegating = assistant("a-tool", {
      content: [
        {
          type: "tool",
          id: "tool-1",
          name: "task",
          state: {
            status: "completed",
            input: { description: "scan", prompt: "find all files", subagent_type: "explore" },
            metadata: { sessionID: "ses_child" },
            content: [{ type: "text", text: "ok" }],
          },
          time: { created: T0 + 1200 },
        },
      ],
    })
    const messages: MessageMap = {
      ses_test: [user("u1"), delegating],
      ses_child: [user("c1", "find all files")],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe(
      (model, controls) => {
        const first = model.fleetDelegations()
        const again = model.fleetDelegations()
        controls.tick()
        const moved = model.fleetDelegations()
        model.setFleetHeaders(new Map([["ses_child", [header(T0)]]]))
        const withHeaders = model.fleetDelegations()
        const incoming = model.fleetIncoming()
        return { first, again, moved, withHeaders, incoming }
      },
      { messages },
    )

    assert.deepEqual([...read.first.keys()], ["ses_test"])
    assert.equal(read.first.get("ses_test")?.length, 1)
    assert.equal(read.first.get("ses_test")?.[0].childID, "ses_child")
    assert.equal(read.first.get("ses_test")?.[0].exact, true)
    assert.equal(read.first.get("ses_test")?.[0].agent, "explore")
    assert.equal(read.first.get("ses_test")?.[0].result, "ok")
    assert.equal(read.again, read.first)
    assert.equal(read.moved, read.first)
    assert.equal(read.withHeaders.get("ses_test")?.[0].prompt, "find all files")
    assert.equal(read.incoming.get("ses_child")?.parent.id, "ses_test")
  })

  test("reuses delegation rows until the parent log or the child metadata moves", () => {
    const tool = assistant("a-tool", {
      content: [
        {
          type: "tool",
          id: "tool-1",
          name: "task",
          state: { status: "running", input: { description: "scan" } },
          time: { created: T0 + 1200 },
        },
      ],
    })
    const messages: MessageMap = {
      ses_test: [user("u1"), tool],
      ses_child: [],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe(
      (model, controls) => {
        const first = model.fleetDelegations()
        controls.tick()
        const again = model.fleetDelegations()
        messages.ses_test = [...messages.ses_test, user("u2")]
        controls.tick()
        const grown = model.fleetDelegations()
        model.setFleetHeaders(new Map([["ses_child", [header(T0)]]]))
        const renamed = model.fleetDelegations()
        return { first, again, grown, renamed }
      },
      { messages },
    )
    assert.equal(read.again, read.first)
    assert.notEqual(read.grown, read.first)
    assert.notEqual(read.renamed, read.grown)
    assert.equal(read.first.size, 1)
  })

  test("keeps a delegation whose tool is still streaming out of the map", () => {
    const tool = assistant("a-tool", {
      content: [
        {
          type: "tool",
          id: "tool-1",
          name: "subagent",
          state: { status: "streaming", input: { description: "scan" } },
          time: { created: T0 + 1200 },
        },
      ],
    })
    const messages: MessageMap = {
      ses_test: [tool],
      ses_child: [],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe((model) => model.fleetDelegations(), { messages })
    assert.equal(read.size, 0)
  })

  test("drops the oldest delegation entry past 64 parents", () => {
    const sessions = [sessionRow("ses_test")]
    const messages: MessageMap = { ses_test: [] }
    for (let index = 0; index < 65; index++) {
      const parent = `ses_p${index}`
      const target = `ses_t${index}`
      sessions.push(sessionRow(parent, { parentID: "ses_test" }), sessionRow(target, { parentID: parent }))
      messages[target] = []
      messages[parent] = [
        assistant(`a-${index}`, {
          content: [
            {
              type: "tool",
              id: `t-${index}`,
              name: "task",
              state: {
                status: "completed",
                input: { description: `c${index}`, prompt: `p${index}` },
                metadata: { sessionID: target },
              },
              time: { created: T0 + index * 10 },
            },
          ],
        }),
      ]
    }
    const read = probe((model) => model.fleetDelegations(), { sessions, messages })
    assert.equal(read.size, 65)
  })

  test("skips delegation rows for an unknown parent or a row without a child", () => {
    const read = probe((model) => {
      const delegations = new Map<string, readonly FleetDelegation[]>([
        ["ses_ghost", [{ parentID: "ses_ghost", at: T0, description: "gone", exact: false }]],
        ["ses_test", [{ parentID: "ses_test", at: T0, description: "no child", exact: false }]],
      ])
      return { delegations, incoming: model.fleetIncoming() }
    })
    assert.equal(read.delegations.size, 2)
    assert.equal(read.incoming.size, 0)
  })

  test("keeps the earliest delegation when a child is claimed more than once", () => {
    const task = (id: string, minute: number) =>
      assistant(id, {
        content: [
          {
            type: "tool",
            id: `${id}-tool`,
            name: "task",
            state: { status: "completed", input: { description: id }, metadata: { sessionID: "ses_child" } },
            time: { created: T0 + minute },
          },
        ],
      })
    const messages: MessageMap = {
      ses_test: [user("u1"), task("first", 2000), task("later", 3000), task("earliest", 1000)],
      ses_child: [],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe(
      (model) => ({
        rows: model.fleetDelegations().get("ses_test")?.map((row) => row.at),
        incoming: model.fleetIncoming(),
      }),
      { messages },
    )
    assert.deepEqual(read.rows, [T0 + 2000, T0 + 3000, T0 + 1000])
    assert.equal(read.incoming.get("ses_child")?.delegation.at, T0 + 1000)
    assert.equal(read.incoming.get("ses_child")?.delegation.description, "earliest")
  })

  test("skips a delegation whose child session cannot be matched", () => {
    const tool = assistant("a-tool", {
      content: [
        {
          type: "tool",
          id: "tool-1",
          name: "task",
          state: { status: "completed", input: { description: "scan", prompt: "find all files" } },
          time: { created: T0 + 1200 },
        },
      ],
    })
    const messages: MessageMap = {
      ses_test: [user("u1"), tool],
      ses_child: [{ id: "unmatched", type: "user", text: "something else", time: { created: T0 + 900_000 } }],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe(
      (model) => ({ delegations: model.fleetDelegations(), incoming: model.fleetIncoming() }),
      {
        messages,
        sessions: [
          sessionRow("ses_test"),
          sessionRow("ses_child", {
            parentID: "ses_test",
            title: "unrelated",
            time: { created: T0 + 86400_000, updated: T0 + 86460_000 },
          }),
        ],
      },
    )
    assert.equal(read.delegations.get("ses_test")?.[0].childID, undefined)
    assert.equal(read.incoming.size, 0)
  })

  test("reuses the timeline when a structural tick does not change what it draws", () => {
    const familyData = family()
    const sessions = familyData.sessions.map((row, index) =>
      index === 0
        ? sessionRow("ses_test", { time: { created: T0, updated: T0 + 60_000, idle: T0 + 60_000 } })
        : row,
    )
    const read = probe(
      (model, controls) => {
        const first = model.fleetTimeline()
        const again = model.fleetTimeline()
        controls.tick()
        const same = model.fleetTimeline()
        controls.setRunning(["ses_child"])
        const live = model.fleetTimeline()
        model.setFleetNow(live.now + 15_000)
        const advanced = model.fleetTimeline()
        return { first, again, same, live, advanced }
      },
      { sessions, running: [] },
    )
    assert.equal(read.first.rows.length, 4)
    assert.equal(read.first.rows[0].spans.length, 2)
    assert.equal(read.first.active > 0, true)
    assert.equal(read.again, read.first)
    assert.equal(read.same, read.first)
    assert.notEqual(read.live, read.first)
    assert.equal(read.live.rows[1].node.running, true)
    assert.equal(read.advanced.now, read.live.now + 15_000)
    assert.notEqual(read.advanced, read.live)
  })

  test("tracks whether any agent is running without a new object per wake", () => {
    const read = probe((model, controls) => {
      const idle = model.fleetRunning()
      controls.setRunning(["ses_child"])
      const live = model.fleetRunning()
      controls.setRunning([])
      const done = model.fleetRunning()
      return { idle, live, done }
    })
    assert.equal(read.idle, false)
    assert.equal(read.live, true)
    assert.equal(read.done, false)
  })

  test("sums the summary cost from the heads and falls back to the node cost", () => {
    const read = probe((model) => {
      const first = model.fleetSummary()
      model.setFleetHeaders(new Map([["ses_empty", [header(T0)]]]))
      const withHead = model.fleetSummary()
      return { first, withHead }
    })
    assert.equal(read.first.agents, 4)
    assert.equal(read.first.running, 0)
    // The empty log's head has no cost, so its node cost is used.
    assert.equal(read.first.cost > 0, true)
    assert.equal(read.withHead.agents, 4)
  })

  test("keeps only the categories present in a head composition", () => {
    const messages: MessageMap = { ses_test: [], ses_child: [], ses_skip: [], ses_empty: [] }
    const read = probe(
      (model, controls) => {
        const empty = model.fleetCategories()
        messages.ses_test = [user("u1"), assistant("a1")]
        controls.tick()
        const filled = model.fleetCategories()
        return { empty, filled }
      },
      { headers: [header(T0)], messages },
    )
    assert.deepEqual(read.empty, [])
    assert.deepEqual(read.filled, ["system", "tools", "user"])
  })

  test("tracks the stage width, mode, fit and clock signals", () => {
    const read = probe((model) => {
      model.setFleetNow(1234)
      model.setFleetStageWidth(640)
      model.setFleetMode("tree")
      model.setFleetTimelineFit("overview")
      model.setFleetFocus("ses_child")
      const layout = model.fleetLayout()
      return {
        now: model.fleetNow(),
        width: model.fleetStageWidth(),
        mode: model.fleetMode(),
        fit: model.fleetTimelineFit(),
        focus: model.fleetFocus(),
        layout,
      }
    })
    assert.equal(read.now, 1234)
    assert.equal(read.width, 640)
    assert.equal(read.mode, "tree")
    assert.equal(read.fit, "overview")
    assert.equal(read.focus, "ses_child")
    assert.equal(read.layout.width > 0, true)
  })

  test("starts on the timeline view with a fresh clock and empty headers", () => {
    const read = probe((model) => ({
      mode: model.fleetMode(),
      fit: model.fleetTimelineFit(),
      width: model.fleetStageWidth(),
      headers: [...model.fleetHeaders().entries()],
      now: model.fleetNow(),
      pinned: model.fleetPinned(),
      focus: model.fleetFocus(),
      hover: model.fleetHover(),
    }))
    assert.equal(read.mode, "timeline")
    assert.equal(read.fit, "adaptive")
    assert.equal(read.width, 420)
    assert.deepEqual(read.headers, [])
    assert.equal(typeof read.now, "number")
    assert.equal(read.pinned, undefined)
    assert.equal(read.focus, undefined)
    assert.equal(read.hover, undefined)
  })

  test("labels an unreadable title from the agent and falls back to the id", () => {
    const read = probe(
      (model) => model.fleet().nodes.map((node) => node.title),
      {
        sessions: [
          sessionRow("ses_test", { title: undefined, agent: "build" }),
          sessionRow("ses_child", { parentID: "ses_test", title: "<system-reminder>x", agent: undefined }),
        ],
      },
    )
    assert.deepEqual(read, ["build", "ses_child"])
  })

  test("keeps a node with no agent and no model", () => {
    const read = probe(
      (model) => model.fleet().nodes[0] as FleetNode,
      { sessions: [sessionRow("ses_test", { agent: undefined, model: undefined })] },
    )
    assert.equal(read.agent, undefined)
    assert.equal(read.provider, undefined)
    assert.equal(read.id, "ses_test")
  })

  test("reads an assistant tail that only streamed", () => {
    const tail = assistant("a-stream", { time: { created: T0 + 1000, streamed: T0 + 1500 } })
    const messages: MessageMap = {
      ses_test: [user("u1"), tail],
      ses_child: [assistant("c1a", { time: { created: T0, streamed: T0 + 500 } })],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe((model) => ({
      heads: model.fleetHeads().size,
      delegations: model.fleetDelegations().size,
      detail: model.fleetInspectedDetail()?.rows.length,
    }), { messages })
    assert.equal(read.heads, 4)
    assert.equal(read.delegations, 0)
    assert.equal(read.detail, 2)
  })

  test("reads an assistant tail that has not settled yet", () => {
    const tail = assistant("a-open", { time: { created: T0 + 1000 } })
    const messages: MessageMap = {
      ses_test: [user("u1"), tail],
      ses_child: [],
      ses_skip: [],
      ses_empty: [],
    }
    const read = probe((model) => model.fleetInspectedDetail(), { messages })
    assert.equal(read?.rows.length, 2)
  })

  test("tracks the inspector inside a computed", () => {
    const read = probe((model) => {
      const seen: number[] = []
      createComputed(() => {
        seen.push(model.fleetInspectedDetail()?.rows.length ?? -1)
      })
      return seen
    })
    assert.deepEqual(read, [4])
  })
})
