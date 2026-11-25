import assert from "node:assert/strict"
import { afterEach, describe, test, vi } from "vitest"
import { createRoot, createSignal } from "solid-js"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import type { PanelProps } from "@opencode/plugin/gui"
import { createSessionModel } from "../../../src/client/models/session.ts"
import { SETTLE_MS, STRUCTURE_MS, type PanelView } from "../../../src/client/panelSupport.ts"
import type { HeaderSummary } from "../../../src/shared/header.ts"

const now = Date.UTC(2026, 10, 16, 8, 41)

const user = (id: string, text: string): SessionMessageInfo =>
  ({ id, type: "user", text, time: { created: now } }) as unknown as SessionMessageInfo

const assistant = (id: string, patch: Record<string, unknown> = {}): SessionMessageInfo =>
  ({
    id,
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: now + 1000, completed: now + 2000 },
    content: [],
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.01,
    ...patch,
  }) as unknown as SessionMessageInfo

const session = (id: string, patch: Record<string, unknown> = {}): SessionInfo =>
  ({
    id,
    title: `Session ${id}`,
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: now, updated: now + 2000 },
    tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.01,
    location: { directory: "D:/repo" },
    projectID: "p",
    ...patch,
  }) as unknown as SessionInfo

interface PropsOptions {
  readonly messages: () => SessionMessageInfo[]
  readonly sessions?: () => SessionInfo[]
  readonly missing?: () => boolean
  readonly info?: SessionInfo
}

function makeProps(options: PropsOptions): PanelProps {
  const info = options.info ?? session("ses_test")
  const data = {
    listen: () => () => {},
    location: { model: { list: () => [] } },
    session: {
      missing: options.missing ?? (() => false),
      get: () => info,
      list: options.sessions ?? (() => [info]),
      status: () => "idle",
      sync: async () => {},
      message: {
        list: options.messages,
        sync: async () => {},
        more: () => false,
        loading: () => false,
        loadMore: async () => {},
      },
    },
  }
  const routed = {
    id: "ses_test",
    directory: "D:/repo",
    location: { directory: "D:/repo" },
    server: {
      id: "srv_test",
      data,
      client: { rpc: () => ({}), config: { get: async () => [] } },
    },
  }
  return { tab: { id: "context", title: "Context" }, session: routed, screen: {} } as unknown as PanelProps
}

function mounted<T>(run: () => T) {
  let dispose = () => {}
  const value = createRoot((stop) => {
    dispose = stop
    return run()
  })
  return { value, dispose }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("createSessionModel", () => {
  test("reads the routed session and builds the overview rows", () => {
    const messages = [user("u1", "inspect the repo"), assistant("a1", { content: [{ type: "text", text: "answer" }] })]
    const list = [session("ses_test"), session("kid", { parentID: "ses_test", title: "Kid" }), session("other")]
    const props = makeProps({ messages: () => messages, sessions: () => list })
    const [view] = createSignal<PanelView>("overview")
    const [headers] = createSignal<HeaderSummary[] | undefined>(undefined)
    const { value: model, dispose } = mounted(() =>
      createSessionModel({ props, view, headers, revision: () => 0 }),
    )

    assert.equal(model.data(), props.session.server.data)
    assert.equal(model.info()?.id, "ses_test")
    assert.equal(model.messages(), messages)
    assert.equal(model.sessionIndex().turnCount, 1)
    assert.equal(model.steps().length, 1)
    assert.equal(model.turnCount(), 1)
    assert.equal(model.latest()?.id, "a1")
    assert.deepEqual(model.events(), [])
    assert.deepEqual(model.compactions(), [])
    assert.equal(model.tokenScan().steps.length, 1)
    assert.equal(model.tokenSteps().length, 1)
    assert.deepEqual(model.tools(), [])
    assert.deepEqual(model.generated(), { reasoning: 0, answers: 2, calls: 0 })
    assert.deepEqual(
      model.children().map((child) => child.id),
      ["kid"],
    )
    dispose()
  })

  test("skips the index for the fleet tab and reports a missing session", () => {
    const messages = [user("u1", "hello"), assistant("a1")]
    const props = makeProps({ messages: () => messages, missing: () => true })
    const [view] = createSignal<PanelView>("fleet")
    const { value: model, dispose } = mounted(() =>
      createSessionModel({ props, view, headers: () => undefined, revision: () => 0 }),
    )

    assert.equal(model.info(), undefined)
    assert.equal(model.sessionIndex().steps.length, 0)
    assert.equal(model.steps().length, 0)
    assert.deepEqual(model.events(), [])
    assert.deepEqual(model.compactions(), [])
    assert.deepEqual(model.generated(), { reasoning: 0, answers: 0, calls: 0 })
    assert.deepEqual(model.children(), [])
    dispose()
  })

  test("builds event rows and header versions in the browser tab", () => {
    const messages = [
      user("u1", "hello"),
      { id: "s1", type: "system", text: "system note", time: { created: now + 500 } } as unknown as SessionMessageInfo,
      assistant("a1", { content: [{ type: "text", text: "answer" }] }),
      { id: "c1", type: "compaction", status: "completed", reason: "auto", summary: "summary", time: { created: now + 3000 } } as unknown as SessionMessageInfo,
    ]
    const headers: HeaderSummary[] = [
      { at: now, systemHash: "s", toolsHash: "t", system: [{ key: "core", tokens: 10 }], tools: [{ name: "read", tokens: 2 }] },
    ]
    const props = makeProps({ messages: () => messages })
    const [view] = createSignal<PanelView>("browser")
    const { value: model, dispose } = mounted(() =>
      createSessionModel({ props, view, headers: () => headers, revision: () => 0 }),
    )

    assert.deepEqual(
      model.events().map((event) => event.kind),
      ["compaction", "inject"],
    )
    assert.deepEqual(
      model.compactions().map((row) => row.id),
      ["c1"],
    )
    assert.equal(model.sessionIndex().scan.steps[0]?.byCategory.system, 10)
    assert.deepEqual(model.children(), [])
    dispose()
  })

  test("coalesces structure, child, stream and settle wakes", async () => {
    vi.useFakeTimers()
    const [list, setList] = createSignal<SessionMessageInfo[]>([user("u1", "hello"), assistant("a1")])
    const props = makeProps({ messages: () => list() })
    const [revision, setRevision] = createSignal(0, { equals: false })
    const { value: model, dispose } = mounted(() =>
      createSessionModel({ props, view: () => "overview", headers: () => undefined, revision }),
    )

    model.bumpStructure()
    model.bumpStructure()
    model.bumpChildStructure()
    model.bumpChildStructure()
    model.bumpStream()
    model.bumpStream()
    model.bumpFleetLoaded()
    assert.equal(model.fleetLoadedTick(), 1)

    await vi.advanceTimersByTimeAsync(STRUCTURE_MS)
    assert.equal(model.structureTick(), 1)
    assert.equal(model.childStructureTick(), 1)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    assert.equal(model.settleTick(), 1)
    assert.equal(model.streamTick(), 1)

    // Same revision while a settle timer is armed: the effect returns without rearming.
    setRevision(0)
    model.flushStructure()
    assert.equal(model.structureTick(), 2)
    model.bumpStructure()
    model.flushStructure()
    assert.equal(model.structureTick(), 3)

    // A revision bump clears the armed settle timer and rescans at once.
    model.bumpStructure()
    setRevision(1)
    assert.equal(model.settleTick(), 2)

    // A new message list length rescans too, even with the revision unchanged.
    setList([...list(), user("u2", "again")])
    assert.equal(model.settleTick(), 3)

    model.bumpStructure()
    model.bumpChildStructure()
    model.bumpStream()
    dispose()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    assert.equal(model.structureTick(), 5)
    assert.equal(model.childStructureTick(), 1)
    assert.equal(model.streamTick(), 1)
  })

  test("ignores a rerun while the settle timer is already armed", async () => {
    vi.useFakeTimers()
    const messages = [user("u1", "hello"), assistant("a1")]
    const props = makeProps({ messages: () => messages })
    const [revision, setRevision] = createSignal(0, { equals: false })
    const { value: model, dispose } = mounted(() =>
      createSessionModel({ props, view: () => "overview", headers: () => undefined, revision }),
    )

    setRevision(0)
    assert.equal(model.settleTick(), 0)
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    assert.equal(model.settleTick(), 1)
    assert.equal(model.structureTick(), 0)
    dispose()
  })

  test("disposes without timers when the last effect run returned early", async () => {
    vi.useFakeTimers()
    const [list, setList] = createSignal<SessionMessageInfo[]>([user("u1", "hello"), assistant("a1")])
    const props = makeProps({ messages: () => list() })
    const { value: model, dispose } = mounted(() =>
      createSessionModel({ props, view: () => "overview", headers: () => undefined, revision: () => 0 }),
    )

    setList([...list(), user("u2", "more")])
    dispose()
    await vi.advanceTimersByTimeAsync(SETTLE_MS)
    assert.equal(model.settleTick(), 1)
  })

  test("subscribes to the streamed tail and grows only its generated estimate", () => {
    const tailContent = [
      { type: "text", text: "hello" },
      { type: "reasoning", text: "thinking" },
      { type: "tool", id: "t1", name: "read", state: { status: "streaming", input: { path: "a" } }, time: { created: now + 1000 } },
      { type: "tool", id: "t2", name: "read", state: { status: "completed", input: { path: "b" }, content: [] }, time: { created: now + 1000 } },
    ]
    const tail = assistant("a1", { content: tailContent })
    const messages = [user("u1", "hello"), tail]
    const props = makeProps({ messages: () => messages })
    const { value: model, dispose } = mounted(() =>
      createSessionModel({ props, view: () => "overview", headers: () => undefined, revision: () => 0 }),
    )

    const first = model.generated()
    assert.deepEqual(first, { reasoning: 2, answers: 2, calls: 10 })

    // The tail grew without a structural rescan: the live estimate replaces its share.
    tailContent[0].text = "hello there friend"
    model.setSettleTick(model.settleTick() + 1)
    assert.deepEqual(model.generated(), { reasoning: 2, answers: 5, calls: 10 })

    // A non-assistant tail and a different assistant id both fall back to the scan.
    ;(messages as SessionMessageInfo[]).push(user("u2", "next"))
    model.setSettleTick(model.settleTick() + 1)
    assert.deepEqual(model.generated(), first)

    ;(messages as SessionMessageInfo[]).push(assistant("a2", { content: [{ type: "text", text: "later" }] }))
    model.setSettleTick(model.settleTick() + 1)
    assert.deepEqual(model.generated(), first)
    dispose()
  })

  test("ignores a tail without an assistant type in the settle effect", () => {
    const messages = [user("u1", "hello")]
    const props = makeProps({ messages: () => messages })
    const { value: model, dispose } = mounted(() =>
      createSessionModel({ props, view: () => "overview", headers: () => undefined, revision: () => 0 }),
    )
    assert.deepEqual(model.generated(), { reasoning: 0, answers: 0, calls: 0 })
    dispose()
  })
})
