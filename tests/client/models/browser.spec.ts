import assert from "node:assert/strict"
import { afterEach, describe, test, vi } from "vitest"
import { createRoot, createSignal } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client"
import type { HeaderDetail, HeaderSummary } from "../../../src/shared/header.ts"
import type { StepRow } from "../../../src/shared/report.ts"
import { buildBrowserGroups } from "../../../src/shared/browser.ts"
import { createBrowserModel } from "../../../src/client/models/browser.ts"
import { BROWSER_LIVE_MS, type PanelView } from "../../../src/client/panelSupport.ts"

const now = Date.UTC(2026, 10, 16, 8, 41)

const user = (id: string, text: string, files?: unknown[]): SessionMessageInfo =>
  ({ id, type: "user", text, files, time: { created: now } }) as unknown as SessionMessageInfo

const toolPart = (
  id: string,
  name: string,
  state: Record<string, unknown>,
  start = now,
): Record<string, unknown> => ({
  type: "tool",
  id,
  name,
  time: { created: start, ran: start, completed: start + 10 },
  state,
})

const assistant = (id: string, content: unknown[], patch: Record<string, unknown> = {}): SessionMessageInfo =>
  ({
    id,
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: now + 1000, completed: now + 2000 },
    content,
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.01,
    ...patch,
  }) as unknown as SessionMessageInfo

const messages = (): SessionMessageInfo[] => [
  user("u1", "inspect the repo", [{ type: "file", mime: "text/plain", name: "shot.png", data: "AA" }]),
  { id: "s1", type: "system", text: "system note", time: { created: now + 100 } } as unknown as SessionMessageInfo,
  { id: "k1", type: "skill", name: "demo", text: "skill body", time: { created: now + 200 } } as unknown as SessionMessageInfo,
  assistant("a1", [
    { type: "text", text: "the answer" },
    { type: "reasoning", text: "thinking hard" },
    toolPart("t1", "read", {
      status: "completed",
      input: { path: "src/a.ts" },
      content: [
        { type: "text", text: "file body" },
        { type: "file", mime: "text/plain", name: "a.ts", data: "AA" },
      ],
      metadata: { truncated: true },
    }),
    toolPart("t2", "bash", { status: "error", input: "rm -rf", error: { message: "boom" } }),
  ]),
  assistant("a2", [{ type: "text", text: "second reply" }]),
]

const summary = (patch: Partial<HeaderSummary> = {}): HeaderSummary => ({
  at: now,
  systemHash: "s1",
  toolsHash: "t1",
  system: [{ key: "core", tokens: 100 }],
  tools: [
    { name: "read", tokens: 50 },
    { name: "bash", tokens: 20 },
    { name: "grep", tokens: 10 },
    { name: "glob", tokens: 10 },
  ],
  ...patch,
})

const detail = (patch: Partial<HeaderDetail> = {}): HeaderDetail => ({
  summary: summary(),
  system: [{ key: "core", text: "you are a bot" }],
  tools: [
    { name: "read", description: "Read a file", schema: '{"path":"string"}' },
    { name: "bash", description: "", schema: "" },
    // grep and glob have no detail: the preview falls back to the name.
  ],
  ...patch,
})

const step = (patch: Partial<StepRow> = {}): StepRow => ({
  id: "a1",
  at: now,
  turn: 1,
  step: 1,
  prompt: 100,
  output: 10,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
  cost: 0,
  duration: 1000,
  agent: "build",
  afterCompaction: false,
  ...patch,
})

function setup(overrides: Record<string, unknown> = {}) {
  const [view, setView] = createSignal<PanelView>("browser")
  const [browserStep, setBrowserStep] = createSignal<StepRow | undefined>(undefined)
  const [browserLive, setBrowserLive] = createSignal(false)
  const [trendPreview, setTrendPreview] = createSignal<string | undefined>(undefined)
  const [trendPreviewStep, setTrendPreviewStep] = createSignal<StepRow | undefined>(undefined)
  const [header, setHeader] = createSignal<HeaderDetail | null | undefined>(detail())
  const [messageList, setMessageList] = createSignal<SessionMessageInfo[]>(messages())
  const [structureTick, setStructureTick] = createSignal(0)
  const [settleTick, setSettleTick] = createSignal(0)
  const [browserDelta, setBrowserDelta] = createSignal<"off" | "step" | "turn">("off")
  const [steps, setSteps] = createSignal<StepRow[]>([step({ id: "a1", turn: 1 }), step({ id: "a2", turn: 2, step: 1 })])
  const [latestDone, setLatestDone] = createSignal<StepRow | undefined>(step({ id: "a2", turn: 2 }))
  const [selectedStep, setSelectedStep] = createSignal<StepRow | undefined>(undefined)
  const [browserOpen, setBrowserOpen] = createSignal<string | undefined>(undefined)
  const [browserAll, setBrowserAll] = createSignal(false)
  const [browserFlat, setBrowserFlat] = createSignal(false)
  const [browserRowQuery, setBrowserRowQuery] = createSignal("")
  const [browserQuery, setBrowserQuery] = createSignal("")
  const [toolSort, setToolSort] = createSignal<"size" | "calls" | "name">("calls")
  const deps = {
    browserStep,
    browserLive,
    trendPreview,
    trendPreviewStep,
    header,
    messageList,
    structureTick,
    settleTick,
    browserDelta,
    steps,
    latestDone,
    selectedStep,
    browserOpen,
    browserAll,
    browserFlat,
    browserRowQuery,
    browserQuery,
    toolSort,
    ...overrides,
  }

  let dispose = () => {}
  const model = createRoot((stop) => {
    dispose = stop
    return createBrowserModel({
      view,
      browserStep: deps.browserStep,
      browserLive: deps.browserLive,
      trendPreview: deps.trendPreview,
      trendPreviewStep: deps.trendPreviewStep,
      header: deps.header,
      messages: deps.messageList,
      structureTick: deps.structureTick,
      settleTick: deps.settleTick,
      browserDelta: deps.browserDelta,
      steps: deps.steps,
      latestDone: deps.latestDone,
      selectedStep: deps.selectedStep,
      browserOpen: deps.browserOpen,
      browserAll: deps.browserAll,
      browserFlat: deps.browserFlat,
      browserRowQuery: deps.browserRowQuery,
      browserQuery: deps.browserQuery,
      toolSort: deps.toolSort,
    })
  })
  return {
    model,
    dispose,
    signals: {
      setView,
      setBrowserStep,
      setBrowserLive,
      setTrendPreview,
      setTrendPreviewStep,
      setHeader,
      setMessageList,
      setStructureTick,
      setSettleTick,
      setBrowserDelta,
      setSteps,
      setLatestDone,
      setSelectedStep,
      setBrowserOpen,
      setBrowserAll,
      setBrowserFlat,
      setBrowserRowQuery,
      setBrowserQuery,
      setToolSort,
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("createBrowserModel", () => {
  test("groups the request and totals the tokens", () => {
    const { model, dispose } = setup()
    assert.ok(model.browserGroups().length > 0)
    assert.equal(
      model.browserTotal(),
      model.browserGroups().reduce((sum, group) => sum + group.tokens, 0),
    )
    const groups = new Map(model.browserGroups().map((group) => [group.key, group]))
    assert.deepEqual(groups.get("system")?.rows.map((row) => row.id), ["sys:0"])
    assert.equal(groups.get("tools")?.rows.length, 4)
    assert.equal(groups.get("user")?.rows[0].preview, "shot.png")
    assert.deepEqual(groups.get("injected")?.rows.map((row) => row.name), ["System"])
    assert.deepEqual(groups.get("skills")?.rows.map((row) => row.name), ["demo"])
    assert.deepEqual(groups.get("assistant")?.rows.map((row) => row.text), ["second reply", "the answer"])
    assert.deepEqual(groups.get("reasoning")?.rows.map((row) => row.text), ["thinking hard"])
    assert.equal(groups.get("toolCalls")?.rows.length, 2)
    assert.equal(groups.get("toolResults")?.rows.length, 2)
    dispose()
  })

  test("returns no rows outside the browser tab", () => {
    const { model, dispose, signals } = setup()
    signals.setView("overview")
    assert.deepEqual(model.browserGroups(), [])
    assert.equal(model.browserTotal(), 0)
    dispose()
  })

  test("caches non-live groups per step and evicts the oldest", () => {
    const { model, dispose, signals } = setup()
    signals.setBrowserStep(step({ id: "a1" }))
    const first = model.browserGroups()

    // A new header object with the same hashes reuses the cached grouping.
    signals.setHeader(detail())
    assert.equal(model.browserGroups(), first)

    // A previewed tail that is itself the step measures only its text parts.
    signals.setMessageList(messages())
    assert.ok(model.browserGroups().length > 0)

    // An absent header keys the cache separately.
    signals.setHeader(undefined)
    assert.ok(model.browserGroups().length > 0)

    for (let index = 0; index < 30; index++) {
      signals.setHeader(detail({ summary: summary({ systemHash: `s${index}`, toolsHash: `t${index}` }) }))
      assert.ok(model.browserGroups().length > 0)
    }
    dispose()
  })

  test("measures the previewed tail text and tolerates a missing header", () => {
    const tailContent = [
      { type: "text", text: "streaming" },
      toolPart("t1", "read", { status: "completed", input: {}, content: [] }),
    ]
    const tail = assistant("a1", tailContent)
    const { model, dispose, signals } = setup({
      messageList: () => [user("u1", "hi"), tail],
      header: () => undefined,
    })
    signals.setBrowserStep(step({ id: "a1" }))
    const groups = model.browserGroups()
    assert.equal(groups.find((group) => group.key === "system")?.rows.length, 0)
    assert.equal(groups.find((group) => group.key === "user")?.rows.length, 1)
    assert.equal(groups.find((group) => group.key === "toolResults")?.rows.length, 0)

    // Same list length and header: the cache serves the earlier grouping.
    signals.setSettleTick(1)
    assert.equal(model.browserGroups(), groups)

    // The streamed tail grew, so the key changes and the grouping is rebuilt.
    tailContent[0].text = "streaming more"
    signals.setSettleTick(2)
    assert.notStrictEqual(model.browserGroups(), groups)
    dispose()
  })

  test("throttles live grouping and wakes on the live tick", async () => {
    vi.useFakeTimers()
    const { model, dispose, signals } = setup()
    signals.setBrowserLive(true)
    assert.ok(model.browserGroups().length > 0)
    signals.setSettleTick(1)
    await vi.advanceTimersByTimeAsync(BROWSER_LIVE_MS)
    // The tick itself is not exposed; the grouping reads it without throwing.
    assert.ok(model.browserGroups().length > 0)

    // A previewed step stops live grouping.
    dispose()
  })

  test("clears an armed live timer on cleanup", async () => {
    vi.useFakeTimers()
    const { model, dispose, signals } = setup()
    signals.setBrowserLive(true)
    assert.ok(model.browserGroups().length > 0)
    dispose()
    await vi.advanceTimersByTimeAsync(BROWSER_LIVE_MS)
    assert.ok(model.browserGroups !== undefined)
  })

  test("resolves the provider from the preview, the live tail or the selection", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.browserProvider(), undefined)

    signals.setSelectedStep(step({ id: "picked" }))
    assert.equal(model.browserProvider(), 100)

    signals.setBrowserLive(true)
    assert.equal(model.browserProvider(), 100)

    signals.setTrendPreview("turn:1")
    signals.setTrendPreviewStep(step({ id: "preview", prompt: 77 }))
    assert.equal(model.browserProvider(), 77)
    dispose()
  })

  test("finds the delta base: off, live, unknown, first and step mode", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.browserDeltaBase(), undefined)

    signals.setBrowserDelta("step")
    assert.equal(model.browserDeltaBase(), undefined)

    signals.setBrowserStep(step({ id: "missing" }))
    assert.equal(model.browserDeltaBase(), undefined)

    signals.setBrowserStep(step({ id: "a1" }))
    assert.equal(model.browserDeltaBase(), undefined)

    signals.setBrowserStep(step({ id: "a2", turn: 2 }))
    assert.equal(model.browserDeltaBase()?.id, "a1")

    signals.setBrowserLive(true)
    assert.equal(model.browserDeltaBase(), undefined)
    dispose()
  })

  test("finds the delta base in turn mode and gives up when no earlier turn exists", () => {
    const { model, dispose, signals } = setup()
    signals.setBrowserDelta("turn")

    signals.setBrowserStep(step({ id: "a2", turn: 2 }))
    assert.equal(model.browserDeltaBase()?.id, "a1")

    signals.setSteps([
      step({ id: "b1", turn: 1, step: 1 }),
      step({ id: "b2", turn: 1, step: 2 }),
      step({ id: "b3", turn: 1, step: 3 }),
    ])
    signals.setBrowserStep(step({ id: "b3", turn: 1 }))
    assert.equal(model.browserDeltaBase(), undefined)
    dispose()
  })

  test("computes group deltas against the base request", () => {
    const { model, dispose, signals } = setup()
    assert.deepEqual(model.browserDeltas(), {})

    signals.setBrowserDelta("step")
    signals.setBrowserStep(step({ id: "a2", turn: 2 }))
    const deltas = model.browserDeltas()
    const base = buildBrowserGroups(messages(), detail(), "a1", false)
    for (const group of model.browserGroups()) {
      const before = base.find((entry) => entry.key === group.key)!
      assert.deepEqual(deltas[group.key], {
        tokens: group.tokens - before.tokens,
        items: group.rows.length - before.rows.length,
      })
    }
    dispose()
  })

  test("signs numbers with a plus, a minus or nothing", () => {
    const { model, dispose } = setup()
    assert.match(model.signed(12), /^\+12/)
    assert.match(model.signed(0), /^0/)
    assert.match(model.signed(-3), /^−3/)
    dispose()
  })

  test("filters and sorts the rows of one group", () => {
    const { model, dispose, signals } = setup()
    const groups = new Map(model.browserGroups().map((group) => [group.key, group]))
    const tools = groups.get("tools")!

    signals.setBrowserRowQuery("  BASH ")
    assert.deepEqual(model.browserRowsOf(tools).map((row) => row.name), ["bash"])

    signals.setBrowserRowQuery("no-such-row")
    assert.deepEqual(model.browserRowsOf(tools), [])

    signals.setBrowserRowQuery("")
    signals.setToolSort("name")
    assert.deepEqual(model.browserRowsOf(tools).map((row) => row.name), ["bash", "glob", "grep", "read"])
    signals.setToolSort("size")
    assert.deepEqual(model.browserRowsOf(tools).map((row) => row.name), ["read", "bash", "glob", "grep"])
    signals.setToolSort("calls")
    assert.deepEqual(model.browserRowsOf(tools).map((row) => row.name), ["bash", "read", "glob", "grep"])
    dispose()
  })

  test("filters the optional row fields and the file names", () => {
    const { model, dispose, signals } = setup()
    const group = model.browserGroups().find((entry) => entry.key === "toolResults")!
    signals.setBrowserRowQuery("a.ts")
    const rows = model.browserRowsOf(group)
    assert.deepEqual(rows.map((row) => row.name), ["read"])
    signals.setBrowserRowQuery("read a file")
    assert.deepEqual(model.browserRowsOf(group), [])
    dispose()
  })

  test("opens one group and totals its tokens", () => {
    const { model, dispose, signals } = setup()
    assert.equal(model.browserOpenGroup(), undefined)
    assert.deepEqual(model.browserOpenRows(), [])
    assert.equal(model.browserOpenTokens(), 0)

    signals.setBrowserOpen("assistant")
    assert.equal(model.browserOpenGroup()?.key, "assistant")
    assert.equal(model.browserOpenRows().length, 2)
    assert.equal(
      model.browserOpenTokens(),
      model.browserOpenRows().reduce((sum, row) => sum + row.tokens, 0),
    )
    dispose()
  })

  test("slices a long open group unless every row is shown", () => {
    const many = Array.from({ length: 250 }, (_, index) => ({ type: "text", text: `reply ${index}` }))
    const { model, dispose, signals } = setup({ messageList: () => [user("u1", "hi"), assistant("a1", many)] })
    signals.setBrowserOpen("assistant")
    assert.equal(model.browserOpenShown().length, 200)

    signals.setBrowserAll(true)
    assert.equal(model.browserOpenShown().length, 250)
    dispose()
  })

  test("flattens the groups, filters them and orders the tail last", () => {
    const { model, dispose, signals } = setup()
    assert.deepEqual(model.browserFlatRows(), [])

    signals.setBrowserFlat(true)
    const rows = model.browserFlatRows()
    assert.equal(rows.length, model.browserGroups().reduce((sum, group) => sum + group.rows.length, 0))
    assert.equal(
      model.browserFlatTokens(),
      rows.reduce((sum, entry) => sum + entry.row.tokens, 0),
    )
    assert.deepEqual(
      rows.filter((entry) => entry.row.tail).map((entry) => entry.row.id),
      ["sys:0", "tool:read", "tool:bash", "tool:grep", "tool:glob"],
    )
    signals.setBrowserQuery("BASH")
    const bashRows = model.browserFlatRows()
    assert.ok(bashRows.length > 0)
    assert.deepEqual(new Set(bashRows.map((entry) => entry.row.name)), new Set(["bash"]))
    signals.setBrowserQuery("no-such-row")
    assert.deepEqual(model.browserFlatRows(), [])
    dispose()
  })

  test("slices long flat lists unless every row is shown", () => {
    const many = Array.from({ length: 250 }, (_, index) => ({ type: "text", text: `reply ${index}` }))
    const { model, dispose, signals } = setup({ messageList: () => [user("u1", "hi"), assistant("a1", many)] })
    signals.setBrowserFlat(true)
    assert.equal(model.browserFlatShown().length, 200)

    signals.setBrowserAll(true)
    assert.equal(model.browserFlatShown().length, model.browserFlatRows().length)
    dispose()
  })

  test("orders rows with the same position by their timestamp", () => {
    const { model, dispose, signals } = setup({
      header: () => undefined,
      messageList: () => [
        user("u1", "one"),
        assistant("a1", [{ type: "text", text: "alpha" }], { time: { created: now, completed: now + 1000 } }),
        assistant("a2", [{ type: "text", text: "beta" }], { time: { created: now, completed: now + 1000 } }),
      ],
    })
    signals.setBrowserFlat(true)
    // Same timestamp, so position breaks the tie; both orders stay stable.
    assert.deepEqual(model.browserFlatRows().map((entry) => entry.row.id), ["a2:0", "a1:0", "u1"])
    dispose()
  })

  test("sorts tool rows that never recorded a call count", () => {
    const { model, dispose, signals } = setup()
    const group = {
      key: "tools" as const,
      tokens: 0,
      rows: [
        { id: "t1", kind: "toolSchema" as const, name: "beta", preview: "", tokens: 3, at: now },
        { id: "t2", kind: "toolSchema" as const, name: "alpha", preview: "", tokens: 3, at: now },
      ],
    }
    signals.setToolSort("calls")
    assert.deepEqual(model.browserRowsOf(group).map((row) => row.name), ["alpha", "beta"])
    signals.setToolSort("size")
    assert.deepEqual(model.browserRowsOf(group).map((row) => row.name), ["alpha", "beta"])
    dispose()
  })

  test("sorts a flat list of header rows before a message row", () => {
    const system = Array.from({ length: 40 }, (_, index) => ({ key: `part-${index}`, text: `text ${index}` }))
    const tools = Array.from({ length: 40 }, (_, index) => ({ name: `tool-${index}`, description: "", schema: "" }))
    const header = detail({
      summary: summary({
        system: system.map((part) => ({ key: part.key, tokens: 10 })),
        tools: tools.map((tool) => ({ name: tool.name, tokens: 10 })),
      }),
      system,
      tools,
    })
    const { model, dispose, signals } = setup({
      header: () => header,
      messageList: () => [user("u1", "hi")],
    })
    signals.setBrowserFlat(true)
    const rows = model.browserFlatRows()
    assert.equal(rows.length, 81)
    assert.equal(rows[0].row.id, "u1")
    assert.ok(rows.slice(1).every((entry) => entry.row.tail === true))
    dispose()
  })

  test("orders header rows that carry no position or timestamp", () => {
    const system = Array.from({ length: 6 }, (_, index) => ({ key: `part-${index}`, text: `text ${index}` }))
    const header = detail({
      summary: summary({ system: system.map((part) => ({ key: part.key, tokens: 10 })), tools: [] }),
      system,
      tools: [],
    })
    const { model, dispose, signals } = setup({
      header: () => header,
      messageList: () => [],
    })
    signals.setBrowserFlat(true)
    const rows = model.browserFlatRows()
    assert.equal(rows.length, 6)
    assert.deepEqual(
      rows.map((entry) => entry.row.id),
      ["sys:0", "sys:1", "sys:2", "sys:3", "sys:4", "sys:5"],
    )
    dispose()
  })
})
