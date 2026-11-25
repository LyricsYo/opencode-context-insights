import assert from "node:assert/strict"
import { afterAll, beforeAll, beforeEach, describe, test, vi } from "vitest"
import { createSignal } from "solid-js"
import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { ContextView } from "../../../src/client/components/contextView.tsx"
import { HOST_CONTRACT, REQUIRED_HOST_METHODS } from "../../../src/shared/host.ts"
import { headerCache, panelMemory, panelMemoryOf } from "../../../src/client/panelSupport.ts"
import { makePluginContext, mount } from "../helpers/mount.tsx"
import { makeRpc, makeSessionProps, settle } from "../helpers/session.ts"

// The real loader hits models.dev on a miss and caches its first answer for an hour;
// the panel only reacts to the result, so the loader is handed to the test.
const priceState = vi.hoisted(() => ({
  book: undefined as unknown,
  calls: 0,
}))

vi.mock("../../../src/client/models/prices.ts", () => ({
  loadHostPriceBook: async (request: () => Promise<unknown>) => {
    priceState.calls += 1
    if (priceState.book !== undefined) return priceState.book
    // Exercise the panel's request closure, but keep the answer test-controlled.
    await request().catch(() => undefined)
    return undefined
  },
}))

const T0 = Date.UTC(2026, 10, 16, 8, 0)
const minute = (value: number) => T0 + value * 60_000

const scrollIntoViewCalls: Element[] = []
const scrollToCalls: Array<{ el: Element; left: number }> = []
const resizeObservers: Array<{ callback: ResizeObserverCallback; targets: Element[] }> = []

class CaptureResizeObserver {
  private readonly entry: { callback: ResizeObserverCallback; targets: Element[] }
  constructor(callback: ResizeObserverCallback) {
    this.entry = { callback, targets: [] }
    resizeObservers.push(this.entry)
  }
  observe(target: Element): void {
    this.entry.targets.push(target)
  }
  unobserve(): void {}
  disconnect(): void {}
}

beforeAll(() => {
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrollIntoViewCalls.push(this)
  }
  HTMLElement.prototype.scrollTo = function scrollTo(this: HTMLElement, options?: ScrollToOptions | number) {
    if (typeof options === "object" && options !== null) scrollToCalls.push({ el: this, left: Number(options.left ?? 0) })
    else scrollToCalls.push({ el: this, left: Number(options ?? 0) })
  }
  globalThis.ResizeObserver = CaptureResizeObserver as unknown as typeof ResizeObserver
})

afterAll(() => {
  delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
})

beforeEach(() => {
  panelMemory.clear()
  headerCache.clear()
  scrollIntoViewCalls.length = 0
  scrollToCalls.length = 0
  resizeObservers.length = 0
  priceState.book = undefined
  priceState.calls = 0
})

const text = (value: string) => ({ type: "text", text: value })
const reasoning = (value: string, created?: number, completed?: number) => ({
  type: "reasoning",
  text: value,
  ...(created === undefined ? {} : { time: { created, ...(completed === undefined ? {} : { completed }) } }),
})
const tool = (
  id: string,
  name: string,
  patch: {
    created: number
    ran?: number
    completed?: number
    status?: string
    input?: Record<string, unknown>
    content?: unknown[]
    metadata?: Record<string, unknown>
    error?: Record<string, unknown>
  },
) => ({
  type: "tool",
  id,
  name,
  time: {
    created: patch.created,
    ...(patch.ran === undefined ? {} : { ran: patch.ran }),
    ...(patch.completed === undefined ? {} : { completed: patch.completed }),
  },
  state: {
    status: patch.status ?? (patch.completed === undefined ? "running" : "completed"),
    input: patch.input ?? {},
    ...(patch.content === undefined ? {} : { content: patch.content }),
    ...(patch.metadata === undefined ? {} : { metadata: patch.metadata }),
    ...(patch.error === undefined ? {} : { error: patch.error }),
  },
})

const assistant = (patch: Record<string, unknown>) => ({ type: "assistant", ...patch }) as unknown as SessionMessageInfo

/**
 * One turn pair plus a streaming tail, every message kind and tool outcome the panel
 * reads, so a single mount exercises the overview, browser, events and fleet paths.
 */
function richMessages(): SessionMessageInfo[] {
  return [
    { id: "u1", type: "user", text: "inspect the repo", time: { created: minute(0) } },
    {
      id: "sys1",
      type: "system",
      text: "system rules",
      description: "Bootstrap",
      time: { created: minute(0) + 1000 },
    },
    {
      id: "y1",
      type: "synthetic",
      text: "<context>injected payload</context>",
      time: { created: minute(0) + 2000 },
    },
    assistant({
      id: "a1",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: minute(1), completed: minute(2) },
      tokens: { input: 900, output: 30, reasoning: 10, cache: { read: 50, write: 25 } },
      cost: 0.02,
      content: [
        text("the answer"),
        reasoning("thinking hard", minute(1) + 1000, minute(1) + 5000),
        tool("call-read", "read", {
          created: minute(1) + 2000,
          ran: minute(1) + 3000,
          completed: minute(1) + 10_000,
          input: { path: "src/app.ts" },
          content: [{ type: "text", text: "lines 1-10 of src/app.ts" }],
        }),
        tool("call-shell", "shell", {
          created: minute(1) + 15_000,
          ran: minute(1) + 16_000,
          completed: minute(1) + 35_000,
          input: { command: "pnpm test", description: "Run tests", workdir: "D:/repo" },
          metadata: { exit: 1 },
          content: [{ type: "text", text: "failed\nline two" }],
        }),
      ],
    }),
    {
      id: "c1",
      type: "compaction",
      status: "completed",
      reason: "auto",
      summary: "old context summary",
      time: { created: minute(2) + 30_000 },
    },
    { id: "u2", type: "user", text: "run the tests", time: { created: minute(3) } },
    { id: "sk1", type: "skill", skill: "pdf", name: "pdf", text: "skill body", time: { created: minute(3) + 10_000 } },
    {
      id: "m1",
      type: "model-switched",
      model: { providerID: "p2", id: "m2" },
      previous: { providerID: "p", id: "m" },
      time: { created: minute(3) + 20_000 },
    },
    {
      id: "m0",
      type: "model-switched",
      model: { providerID: "p", id: "m" },
      time: { created: minute(3) + 25_000 },
    },
    {
      id: "g1",
      type: "agent-switched",
      agent: "explore",
      previous: "build",
      time: { created: minute(3) + 30_000 },
    },
    {
      id: "g0",
      type: "agent-switched",
      agent: "build",
      time: { created: minute(3) + 35_000 },
    },
    assistant({
      id: "a2",
      agent: "explore",
      model: { id: "m", providerID: "p" },
      time: { created: minute(4), completed: minute(5) },
      tokens: { input: 150, output: 20, reasoning: 0, cache: { read: 50, write: 0 } },
      cost: 0.03,
      content: [
        text("done"),
        reasoning("second thought", minute(4) + 1000, minute(4) + 2000),
        tool("call-edit", "edit", {
          created: minute(4) + 3000,
          ran: minute(4) + 4000,
          completed: minute(4) + 5000,
          input: { path: "src/app.ts", newString: "a\nb", oldString: "c" },
          metadata: { files: [{ file: "src/app.ts", status: "completed", additions: 2, deletions: 1 }] },
        }),
        tool("call-write", "write", {
          created: minute(4) + 6000,
          completed: minute(4) + 7000,
          input: { path: "docs/new.md", content: "hello\nworld" },
        }),
        tool("call-image", "read", {
          created: minute(4) + 8000,
          completed: minute(4) + 9000,
          input: { path: "assets/logo.png" },
        }),
        tool("call-a", "read", {
          created: minute(4) + 10_000,
          completed: minute(4) + 11_000,
          input: { path: "a/app.ts" },
        }),
        tool("call-b", "read", {
          created: minute(4) + 12_000,
          completed: minute(4) + 13_000,
          input: { path: "b/app.ts" },
        }),
        tool("call-grep", "grep", {
          created: minute(4) + 14_000,
          completed: minute(4) + 15_000,
          input: { path: "src", pattern: "needle" },
          metadata: { matches: 5 },
        }),
        tool("call-glob", "glob", {
          created: minute(4) + 16_000,
          completed: minute(4) + 17_000,
          input: { pattern: "**/*.ts" },
          metadata: { matches: 3 },
        }),
        tool("call-skill", "skill", {
          created: minute(4) + 18_000,
          completed: minute(4) + 19_000,
          input: { id: "pdf" },
          metadata: { name: "pdf" },
          content: [{ type: "text", text: "skill body" }],
        }),
        tool("call-question", "question", {
          created: minute(4) + 20_000,
          ran: minute(4) + 21_000,
          completed: minute(4) + 22_000,
          input: { question: "Which one?" },
        }),
        tool("call-exec", "execute", {
          created: minute(4) + 23_000,
          ran: minute(4) + 24_000,
          completed: minute(4) + 25_000,
          input: { code: "await tools.bash({})" },
          content: [{ type: "text", text: "ok" }],
          metadata: {
            toolCalls: [
              { tool: "shell", status: "completed", input: { command: "git status" } },
              { tool: "read", status: "completed", input: { path: "docs/new.md" } },
              { tool: "edit", status: "completed", input: { path: "x.ts", newString: "a", oldString: "b" } },
              { tool: "grep", status: "completed", input: { pattern: "nested" } },
              { tool: "write", status: "completed", input: { path: "y.ts", content: "z" } },
            ],
          },
        }),
        tool("call-build", "shell", {
          created: minute(4) + 26_000,
          ran: minute(4) + 27_000,
          completed: minute(4) + 47_000,
          input: { command: "pnpm build", background: true },
          metadata: { exit: 0 },
        }),
        tool("call-test2", "shell", {
          created: minute(4) + 48_000,
          ran: minute(4) + 48_500,
          completed: minute(4) + 49_000,
          input: { command: "pnpm test" },
          metadata: { exit: 1 },
        }),
      ],
    }),
    {
      id: "c4",
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "fresh summary",
      time: { created: minute(5) + 10_000 },
    },
    assistant({
      id: "a3",
      agent: "explore",
      model: { id: "m", providerID: "p" },
      time: { created: minute(6) },
      tokens: { input: 100, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
      content: [text("streaming answer")],
    }),
    assistant({
      id: "a4",
      agent: "explore",
      model: { id: "m", providerID: "p" },
      time: { created: minute(6) + 10_000, completed: minute(6) + 20_000 },
      content: [
        tool("call-late-read", "read", {
          created: minute(6) + 15_000,
          completed: minute(6) + 16_000,
          input: { path: "late/file.ts" },
        }),
        tool("call-late-shell", "shell", {
          created: minute(6) + 17_000,
          ran: minute(6) + 17_500,
          completed: minute(6) + 18_000,
          input: { command: "ls" },
          metadata: { exit: 0 },
        }),
      ],
    }),
    { id: "i1", type: "idle", outcome: "failed", error: { type: "structured", message: "boom" }, time: { created: minute(6) + 30_000 } },
    { id: "i2", type: "idle", outcome: "succeeded", time: { created: minute(6) + 40_000 } },
    { id: "i3", type: "idle", outcome: "interrupted", time: { created: minute(6) + 50_000 } },
    { id: "i4", type: "idle", outcome: "failed", time: { created: minute(6) + 55_000 } },
    {
      id: "c5",
      type: "compaction",
      status: "running",
      reason: "auto",
      summary: "",
      time: { created: minute(6) + 60_000 },
    },
    {
      id: "c7",
      type: "compaction",
      status: "failed",
      reason: "manual",
      error: { type: "structured", message: "nope" },
      time: { created: minute(6) + 65_000 },
    },
    {
      id: "c6",
      type: "compaction",
      status: "completed",
      reason: "manual",
      summary: "final summary",
      time: { created: minute(6) + 70_000 },
    },
  ]
}

const sessionInfo = (patch: Record<string, unknown> = {}) =>
  ({
    id: "ses_test",
    title: "Demo session",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: T0, updated: minute(7) },
    tokens: { input: 1000, output: 50, reasoning: 10, cache: { read: 200, write: 25 } },
    cost: 0.1,
    location: { directory: "D:/repo" },
    projectID: "p",
    ...patch,
  }) as unknown as SessionInfo

const childSession = (patch: Record<string, unknown> = {}) =>
  ({
    id: "ses_child",
    parentID: "ses_test",
    title: "Worker",
    agent: "explore",
    model: { id: "m", providerID: "p" },
    time: { created: minute(1), updated: minute(2) },
    tokens: { input: 20, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.01,
    location: { directory: "D:/repo" },
    projectID: "p",
    ...patch,
  }) as unknown as SessionInfo

interface SetupOptions {
  messages?: SessionMessageInfo[]
  rpc?: Record<string, unknown>
  sessions?: SessionInfo[]
  info?: SessionInfo | null
  status?: (id: string) => string
  models?: unknown
  location?: unknown
  listen?: boolean
  messageMore?: boolean
  messageLoading?: boolean
  messageSync?: () => Promise<void>
  config?: unknown[] | Promise<unknown>
  ctx?: never
}

interface Calls {
  syncMessages: string[]
  loadMore: Array<{ id: string; all: boolean }>
  syncSession: Array<{ id: string; children: boolean }>
  configGets: number
}

function setup(options: SetupOptions = {}) {
  const [messages, setMessages] = createSignal<SessionMessageInfo[]>(options.messages ?? richMessages())
  const listeners: Array<(event: { details: { type: string; data?: { sessionID?: string } } }) => void> = []
  const status = options.status ?? ((id: string) => (id === "ses_child" ? "running" : "idle"))
  const calls: Calls = { syncMessages: [], loadMore: [], syncSession: [], configGets: 0 }
  const data = {
    listen: (callback: (event: { details: { type: string; data?: { sessionID?: string } } }) => void) => {
      if (options.listen !== false) listeners.push(callback)
      return () => {
        const index = listeners.indexOf(callback)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    location: { model: { list: () => options.models } },
    session: {
      missing: () => options.info === null,
      get: () => options.info ?? sessionInfo(),
      list: () => options.sessions ?? [sessionInfo(), childSession()],
      status,
      sync: async (id: string, params?: { children?: boolean }) => {
        calls.syncSession.push({ id, children: params?.children === true })
      },
      message: {
        list: () => messages(),
        sync: async (id: string) => {
          if (options.messageSync !== undefined) await options.messageSync()
          calls.syncMessages.push(id)
        },
        more: () => options.messageMore === true,
        loading: () => options.messageLoading === true,
        loadMore: async (id: string, params: { all?: boolean }) => {
          calls.loadMore.push({ id, all: params.all === true })
        },
      },
    },
  }
  const rpc = makeRpc(options.rpc)
  const session = {
    id: "ses_test",
    directory: "D:/repo",
    location: options.location === undefined ? { directory: "D:/repo" } : options.location,
    server: {
      id: "srv_test",
      data,
      client: {
        rpc: () => rpc,
        config: {
          get: async () => {
            calls.configGets += 1
            return options.config ?? []
          },
        },
      },
    },
  }
  const props = { tab: { id: "context", title: "Context" }, session, screen: {} } as unknown as Parameters<typeof ContextView>[0]
  const mounted = mount(() => <ContextView {...props} />, options.ctx ?? makePluginContext())
  return {
    ...mounted,
    props,
    data,
    session,
    messages,
    setMessages,
    listeners,
    calls,
    emit(type: string, sessionID?: string) {
      for (const listener of listeners) listener({ details: { type, data: sessionID === undefined ? undefined : { sessionID } } })
    },
  }
}

const tab = (container: HTMLElement, label: string): HTMLButtonElement => {
  const found = [...container.querySelectorAll<HTMLButtonElement>(".oc-tab")].find((node) => node.textContent === label)
  assert.ok(found, `missing ${label} tab`)
  return found
}

const click = (element: Element | null | undefined): void => {
  assert.ok(element, "expected an element to click")
  element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

const hover = (element: Element | null | undefined, type = "mouseenter"): void => {
  assert.ok(element, "expected an element to hover")
  element.dispatchEvent(new MouseEvent(type))
}

const byText = <T extends Element>(container: ParentNode, selector: string, needle: string): T | undefined =>
  [...container.querySelectorAll<T>(selector)].find((node) => node.textContent?.includes(needle))

const typeInto = (element: Element | null | undefined, value: string): void => {
  assert.ok(element instanceof HTMLInputElement, "expected an input")
  element.value = value
  element.dispatchEvent(new Event("input", { bubbles: true }))
}

const choose = (element: Element | null | undefined, value: string): void => {
  assert.ok(element instanceof HTMLSelectElement, "expected a select")
  element.value = value
  element.dispatchEvent(new Event("change", { bubbles: true }))
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const headerVersion = (at: number) => ({
  at,
  systemHash: `s${at}`,
  toolsHash: `t${at}`,
  system: [{ key: "core", tokens: 120 }],
  tools: [{ name: "read", tokens: 40 }],
})

const headerDetail = (at: number) => ({
  summary: headerVersion(at),
  system: [{ key: "core", text: "system text" }],
  tools: [{ name: "read", description: "Read a file", schema: "{}" }],
})

function richRpc(extra: Record<string, unknown> = {}, at = minute(4)) {
  return {
    headers: async () => ({ headers: [headerVersion(T0)] }),
    header: async () => ({ header: headerDetail(at) }),
    snapshot: async () => ({ snapshot: null }),
    ...extra,
  }
}

describe("ContextView", () => {
  test("renders the panel shell, CSS and the overview sections", async () => {
    const props = makeSessionProps()
    const { container, dispose } = mount(() => <ContextView {...props} />)
    await settle()

    assert.ok(container.querySelector(".opencode-context-panel.oc-root"))
    const css = container.querySelector("style")?.textContent ?? ""
    assert.match(css, /\.opencode-context-panel \.oc-card/)
    assert.equal(container.querySelector(".oc-title")?.textContent, "Context")
    assert.match(container.querySelector(".oc-subtitle")?.textContent ?? "", /^Demo session · build · m$/)
    const titles = [...container.querySelectorAll(".oc-section-title")].map((node) => node.textContent)
    assert.ok(titles.includes("Context Stats"))
    assert.ok(titles.includes("Current Context"))
    assert.ok(titles.includes("Token Stats"))
    assert.ok(titles.includes("Timing Stats"))
    assert.match(container.querySelector(".oc-footer")?.textContent ?? "", /Token splits are estimated/)
    assert.doesNotMatch(container.querySelector(".oc-footer")?.textContent ?? "", /out of date/)
    dispose()
  })

  test("loads a host price book when the host answers with entries", async () => {
    priceState.book = { byProvider: new Map(), byModel: new Map(), entries: [] }
    const view = setup()
    await settle()
    assert.equal(priceState.calls, 1)
    assert.match(view.container.querySelector(".oc-subtitle")?.textContent ?? "", /Demo session/)
    view.dispose()
  })

  test("switches to the Details and Fleet tabs", async () => {
    const props = makeSessionProps()
    const { container, dispose } = mount(() => <ContextView {...props} />)
    await settle()

    click(tab(container, "Details"))
    await settle()
    assert.equal(container.querySelector(".oc-tab-active")?.textContent, "Details")
    assert.ok(container.querySelectorAll(".oc-section-title").length > 0)

    click(tab(container, "Fleet"))
    await settle()
    assert.equal(container.querySelector(".oc-tab-active")?.textContent, "Fleet")
    dispose()
  })

  test("warns when the host handshake is missing", async () => {
    const props = makeSessionProps(undefined, makeRpc({ hello: async () => Promise.reject(new Error("no host")) }))
    const { container, dispose } = mount(() => <ContextView {...props} />)
    await settle()

    assert.match(container.querySelector(".oc-footer")?.textContent ?? "", /Host plugin is out of date/)
    dispose()
  })

  test("warns when a required host method is missing", async () => {
    const props = makeSessionProps(
      undefined,
      makeRpc({ hello: async () => ({ contract: 0, storage: 1, methods: [] }) }),
    )
    const { container, dispose } = mount(() => <ContextView {...props} />, makePluginContext())
    await settle()

    assert.match(container.querySelector(".oc-footer")?.textContent ?? "", /Host plugin is out of date/)
    dispose()
  })

  test("renders provider usage, model limits, children and the rich overview", async () => {
    const view = setup({
      rpc: richRpc({
        hello: async () => ({
          plugin: "opencode-context",
          contract: HOST_CONTRACT,
          storage: 1,
          app: "opencode",
          appVersion: "2.2.6",
          methods: [...REQUIRED_HOST_METHODS, "prices"],
        }),
        snapshot: async () => ({
          snapshot: { at: minute(4) + 120_000, total: 500, byCategory: {}, items: [], sessionID: "ses_test", agent: "explore", model: { providerID: "p", id: "m" } },
        }),
      }),
      models: [
        { id: "m", providerID: "p", name: "Model X", limit: { context: 100_000, output: 32_000 } },
      ],
      config: [{ type: "document", info: { compaction: { auto: true, buffer: "20" } } }],
    })
    await settle()
    await settle()

    const textContent = view.container.textContent ?? ""
    assert.match(view.container.querySelector(".oc-subtitle")?.textContent ?? "", /Demo session · build · m/)
    assert.match(textContent, /Model X/)
    assert.match(textContent, /request in progress/i)
    assert.match(textContent, /Auto-compaction at/)
    assert.match(textContent, /80%/)
    assert.match(textContent, /Worker/)
    const child = view.container.querySelector<HTMLButtonElement>(".oc-table-button")
    assert.ok(child)
    click(child)
    await settle()
    assert.equal(view.container.querySelector(".oc-tab-active")?.textContent, "Fleet")
    assert.ok(view.container.querySelector(".oc-fleet-timeline-lane") || view.container.querySelector(".oc-fleet-stage"))
    view.dispose()
  })

  test("counts only assistant steps with visible reply text", async () => {
    const view = setup({
      messages: [
        { id: "u1", type: "user", text: "go", time: { created: minute(0) } },
        assistant({
          id: "a1",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: minute(1), completed: minute(2) },
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          content: [text("")],
        }),
        assistant({
          id: "a2",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: minute(3), completed: minute(4) },
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          content: [text("   ")],
        }),
        assistant({
          id: "a3",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: minute(5), completed: minute(6) },
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
          content: [text("visible")],
        }),
      ],
    })
    await settle()
    const stat = [...view.container.querySelectorAll(".oc-stat")].find((node) =>
      node.textContent?.includes("Model replies"),
    )
    assert.match(stat?.textContent ?? "", /Model replies1/)
    view.dispose()
  })

  test("switches views, remembers UI state and drives the chrome", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()

    click(tab(view.container, "Details"))
    await settle()
    assert.equal(view.container.querySelector(".oc-tab-active")?.textContent, "Details")
    assert.ok(view.container.querySelector(".oc-section-title"))
    click(tab(view.container, "Overview"))
    await settle()

    const copyCall = vi.fn(async () => {})
    view.dispose()

    const ctx = makePluginContext({
      system: { copy: copyCall, openExternal: () => {} },
      toast: { show: () => {} },
    })
    const headerCalls = { count: 0 }
    const second = setup({
      ctx,
      rpc: {
        ...richRpc(),
        headers: async () => {
          headerCalls.count += 1
          return { headers: [headerVersion(T0)] }
        },
      },
    })
    await settle()
    assert.equal(second.container.querySelector(".oc-tab-active")?.textContent, "Overview")
    const copy = byText<HTMLButtonElement>(second.container, "button", "Copy session ID")
    assert.ok(copy)
    click(copy)
    await settle()
    assert.deepEqual(copyCall.mock.calls[0], ["ses_test"])

    const before = headerCalls.count
    const refresh = byText<HTMLButtonElement>(second.container, "button", "Refresh")
    assert.ok(refresh)
    click(refresh)
    await settle()
    assert.equal(headerCalls.count, before + 1)
    second.dispose()
  })

  test("renders the details sections with real data", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const titles = [...view.container.querySelectorAll(".oc-section-title")].map((node) => node.textContent)
    assert.deepEqual(titles, ["Trend", "Timing trend", "Context browser", "Context events", "Compactions", "File activity", "Commands"])
    assert.equal(view.container.querySelectorAll(".oc-trend-bar").length, 6)
    assert.ok(view.container.querySelectorAll(".oc-event-row").length > 0)

    const browser = view.container.querySelector(".oc-section-title + .oc-hint")?.textContent ?? ""
    assert.match(browser, /next request/)
    assert.equal(view.container.querySelectorAll(".oc-bar-seg").length, 3)

    const files = [...view.container.querySelectorAll<HTMLElement>(".oc-file-row")].map((row) => row.title)
    assert.deepEqual(files.slice(0, 2), ["docs/new.md", "src/app.ts"])
    assert.ok(files.includes("src"))
    assert.ok(files.includes("assets/logo.png"))
    const commands = [...view.container.querySelectorAll<HTMLElement>(".oc-command-row")].map(
      (row) => row.querySelector(".oc-command-preview")?.textContent,
    )
    assert.ok(commands.includes("pnpm build"))
    assert.ok(commands.includes("git status"))
    assert.ok(commands.includes("pnpm test"))
    view.dispose()
  })

  test("drives the browser select, flat mode, grouping and row reveals", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const select = view.container.querySelector<HTMLSelectElement>(".oc-select")
    assert.ok(select)
    assert.equal(select.value, "live")
    const options = [...select.querySelectorAll("option")].map((option) => option.value)
    assert.equal(options.length, 4)
    choose(select, "a2")
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.selected, "a2")
    assert.equal(panelMemoryOf("ses_test").ui.browserLive, false)
    assert.equal(select.value, "a2")
    choose(select, "live")
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.selected, undefined)
    assert.equal(panelMemoryOf("ses_test").ui.browserLive, true)

    const flat = byText<HTMLButtonElement>(view.container, ".oc-toolbar button", "Flat")
    assert.ok(flat)
    click(flat)
    await settle()
    assert.equal(view.container.querySelector(".oc-trend-chart-box"), null)
    assert.ok(view.container.querySelector(".oc-table"))
    assert.match(view.container.textContent ?? "", /items/)
    click(flat)
    await settle()

    const bars = view.container.querySelectorAll(".oc-bar-seg")
    click(bars[0])
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.browserOpen, "system")
    assert.ok(view.container.querySelector(".oc-cat-body"))
    const category = view.container.querySelector<HTMLButtonElement>(".oc-cat-row")
    assert.ok(category)
    click(category)
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.browserOpen, undefined)

    const toolCategory = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-cat-row")].find((row) =>
      row.textContent?.includes("Tool Schemas"),
    )
    assert.ok(toolCategory)
    click(toolCategory)
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.browserOpen, "tools")
    const sort = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-cat-body .oc-toggle")].find(
      (node) => node.textContent === "By calls",
    )
    assert.ok(sort)
    click(sort)
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.toolSort, "calls")
    view.dispose()
  })

  test("filters, sorts and opens the events, files and commands sections", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const kind = (label: string) =>
      [...view.container.querySelectorAll<HTMLButtonElement>(".oc-event-filters .oc-toggle")].find((node) =>
        node.textContent?.startsWith(label),
      )

    click(kind("inject"))
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.eventKinds.join(","), "inject")
    click(kind("inject"))
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.eventKinds.length, 6)
    click(kind("skill"))
    await settle()
    click(kind("compaction"))
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.eventKinds.join(","), "skill,compaction")
    assert.ok(view.container.querySelectorAll(".oc-event-row").length > 0)

    const compactionRow = view.container.querySelector<HTMLButtonElement>(".oc-compaction-row")
    assert.ok(compactionRow)
    click(compactionRow)
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.browserOpen, "injected")

    const fileFilters = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-file-toolbar .oc-toggle")]
    click(fileFilters[1])
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.fileFilter, "read")
    click(fileFilters[1])
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.fileFilter, "all")

    for (const label of ["Lines", "Latest", "Path", "Name", "Count"]) {
      const sort = byText<HTMLButtonElement>(view.container, ".oc-file-toolbar .oc-toggle", label)
      assert.ok(sort, `missing ${label} sort`)
      click(sort)
      await settle()
    }

    const fileRow = view.container.querySelector<HTMLButtonElement>(".oc-file-jump")
    assert.ok(fileRow)
    click(fileRow)
    await settle()
    assert.ok(view.container.querySelector(".oc-file-ops"))
    const op = view.container.querySelector<HTMLButtonElement>(".oc-file-op-row")
    assert.ok(op)
    click(op)
    await settle()

    const command = view.container.querySelector<HTMLButtonElement>(".oc-command-time")
    assert.ok(command)
    click(command)
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.browserOpen, "toolResults")
    view.dispose()
  })

  test("reveals a brief chip, an event row and a file op through the browser row scan", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const chip = view.container.querySelector<HTMLButtonElement>(".oc-brief-chip")
    assert.ok(chip)
    click(chip)
    await settle()
    await wait(30)
    assert.ok(scrollIntoViewCalls.length > 0)

    const event = view.container.querySelector<HTMLButtonElement>(".oc-event-jump")
    assert.ok(event)
    click(event)
    await settle()
    await wait(30)
    assert.ok(scrollIntoViewCalls.length > 1)

    const compaction = view.container.querySelector<HTMLButtonElement>(".oc-compaction-row")
    assert.ok(compaction)
    click(compaction)
    await settle()
    await wait(30)
    assert.ok(scrollIntoViewCalls.length > 2)
    view.dispose()
  })

  test("hovers trend and timing bars and switches granularity", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const trendBar = view.container.querySelector(".oc-trend-chart-up > div")
    assert.ok(trendBar)
    hover(trendBar)
    await wait(150)
    await settle()
    assert.ok(panelMemoryOf("ses_test").ui.browserFlat === false)

    hover(trendBar, "mouseleave")

    const turns = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].filter(
      (node) => node.textContent === "Turns",
    )
    assert.equal(turns.length, 2)
    click(turns[0])
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.granularity, "turn")
    click(turns[0])
    await settle()
    click(view.container.querySelector<HTMLButtonElement>(".oc-trend-bars, .oc-trend-turn"))

    const timingBar = view.container.querySelector(".oc-trend-bar-stack")
    assert.ok(timingBar)
    hover(timingBar)
    await settle()
    click(timingBar)
    await settle()

    const timingTurn = view.container.querySelector<HTMLButtonElement>(".oc-trend-turns .oc-trend-turn")
    assert.ok(timingTurn)
    hover(timingTurn)
    click(timingTurn)
    await settle()
    view.dispose()
  })

  test("maps a timing turn back to a trend step when the two charts differ", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    const turns = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].filter(
      (node) => node.textContent === "Turns",
    )
    // The first Turns button belongs to the trend chart; the second switches the timing chart.
    assert.equal(turns.length, 2)
    click(turns[1])
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.timingGranularity, "turn")
    assert.equal(panelMemoryOf("ses_test").ui.granularity, "step")

    const turn = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-trend-turns .oc-trend-turn")].at(-1)
    assert.ok(turn)
    hover(turn)
    await settle()
    click(turn)
    await settle()
    view.dispose()
  })

  test("handles a missing session and stale hosts with empty data", async () => {
    const view = setup({
      info: null,
      messages: [],
      sessions: [],
      rpc: makeRpc({ hello: async () => ({ contract: HOST_CONTRACT, storage: 1, methods: ["snapshot"] }) }),
    })
    await settle()
    assert.match(view.container.querySelector(".oc-subtitle")?.textContent ?? "", /ses_test · agent · model/)
    assert.match(view.container.querySelector(".oc-footer")?.textContent ?? "", /Host plugin is out of date/)
    assert.match(view.container.textContent ?? "", /No provider usage yet/)
    view.dispose()

    const noMethods = setup({
      messages: [],
      rpc: makeRpc({ hello: async () => ({ contract: HOST_CONTRACT, storage: 1 }) }),
    })
    await settle()
    assert.match(noMethods.container.querySelector(".oc-footer")?.textContent ?? "", /Host plugin is out of date/)
    noMethods.dispose()
  })

  test("omits token stats when the session has no provider usage", async () => {
    const view = setup({ info: sessionInfo({ tokens: undefined }), messages: [richMessages()[0]] })
    await settle()
    assert.match(view.container.textContent ?? "", /No provider usage yet|Send a message/)
    assert.doesNotMatch(view.container.textContent ?? "", /Token Stats[^]*Cache Hit/)
    view.dispose()
  })

  test("reports a header request failure and reuses a cached header", async () => {
    const failure = setup({
      rpc: richRpc({
        header: async () => {
          throw new Error("header exploded")
        },
      }),
    })
    await settle()
    click(tab(failure.container, "Details"))
    await settle()
    await settle()
    assert.match(failure.container.textContent ?? "", /snapshot unavailable/)
    failure.dispose()

    const cached = setup({ rpc: richRpc() })
    await settle()
    click(tab(cached.container, "Details"))
    await settle()
    await settle()
    assert.match(cached.container.querySelector(".oc-subtitle")?.textContent ?? "", /Demo session/)
    const headerCalls = headerCache.size
    assert.equal(headerCalls, 1)
    cached.dispose()

    const reused = setup({ rpc: richRpc() })
    await settle()
    click(tab(reused.container, "Details"))
    await settle()
    await settle()
    assert.equal(headerCache.size, 1)
    reused.dispose()
  })

  test("restores saved chart offsets and scroll keys from panel memory", async () => {
    const memory = panelMemoryOf("ses_test")
    memory.view = "browser"
    memory.trendLeft = 42
    memory.timingLeft = 24
    memory.sections.set("browser", { top: 12, left: 3 })
    const view = setup({ rpc: richRpc() })
    await settle()
    await settle()
    assert.equal(view.container.querySelector(".oc-tab-active")?.textContent, "Details")
    const trend = view.container.querySelector<HTMLElement>(".oc-trend-scroll")
    const timing = [...view.container.querySelectorAll<HTMLElement>(".oc-trend-scroll")][1]
    assert.ok(trend)
    assert.equal(trend.scrollLeft, 42)
    assert.ok(timing)
    assert.equal(timing.scrollLeft, 24)
    const section = view.container.querySelector<HTMLElement>('[data-scroll-key="browser"]')
    assert.ok(section)
    assert.equal(section.scrollTop, 12)
    view.dispose()
  })

  test("measures chart windows and reveals bars on resize and scroll", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const scroll = view.container.querySelector<HTMLElement>(".oc-trend-scroll")
    assert.ok(scroll)
    Object.defineProperty(scroll, "clientWidth", { value: 64, configurable: true })
    Object.defineProperty(scroll, "scrollWidth", { value: 320, configurable: true })
    scroll.scrollLeft = 22
    scroll.dispatchEvent(new Event("scroll"))
    await settle()
    assert.ok(resizeObservers.length >= 2)

    const timingScroll = [...view.container.querySelectorAll<HTMLElement>(".oc-trend-scroll")][1]
    assert.ok(timingScroll)
    Object.defineProperty(timingScroll, "clientWidth", { value: 64, configurable: true })
    Object.defineProperty(timingScroll, "scrollWidth", { value: 320, configurable: true })
    timingScroll.scrollLeft = 22
    timingScroll.dispatchEvent(new Event("scroll"))
    await settle()

    for (const observer of resizeObservers) {
      for (const target of observer.targets) {
        if (target === scroll || target === timingScroll) {
          observer.callback([{ contentRect: { width: 100 } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
        }
      }
    }
    await settle()
    assert.ok(view.container.querySelector(".oc-trend-scroll"))
    view.dispose()
  })

  test("toggles every event kind and the single-kind restore path", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const kinds = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-event-filters .oc-toggle")]
    assert.equal(kinds.length, 6)
    click(kinds[0])
    await settle()
    assert.deepEqual(panelMemoryOf("ses_test").ui.eventKinds, ["inject"])
    click(kinds[0])
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.eventKinds.length, 6)
    click(kinds[2])
    await settle()
    assert.deepEqual(panelMemoryOf("ses_test").ui.eventKinds, ["compaction"])
    click(kinds[2])
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.eventKinds.length, 6)
    click(kinds[2])
    await settle()
    click(kinds[3])
    await settle()
    assert.deepEqual(panelMemoryOf("ses_test").ui.eventKinds, ["compaction", "model"])
    click(kinds[2])
    await settle()
    assert.deepEqual(panelMemoryOf("ses_test").ui.eventKinds, ["model"])
    click(kinds[2])
    await settle()
    assert.deepEqual(panelMemoryOf("ses_test").ui.eventKinds, ["model", "compaction"])
    click(kinds[1])
    await settle()
    assert.deepEqual(panelMemoryOf("ses_test").ui.eventKinds, ["model", "compaction", "skill"])
    click(kinds[3])
    await settle()
    assert.deepEqual(panelMemoryOf("ses_test").ui.eventKinds, ["compaction", "skill"])
    click(kinds[2])
    await settle()
    assert.deepEqual(panelMemoryOf("ses_test").ui.eventKinds, ["skill"])
    click(kinds[1])
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.eventKinds.length, 6)
    view.dispose()
  })

  test("filters commands by program, fail state, slowness and background", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const search = [...view.container.querySelectorAll<HTMLInputElement>(".oc-search")].at(-1)
    assert.ok(search)
    typeInto(search, "git")
    await settle()
    const commandRows = () => [...view.container.querySelectorAll<HTMLElement>(".oc-command-row")]
    assert.equal(commandRows().length, 1)

    const program = view.container.querySelector<HTMLSelectElement>(".oc-select-narrow")
    assert.ok(program)
    choose(program, "pnpm")
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.commandProgram, "pnpm")
    choose(program, "")
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.commandProgram, undefined)

    const commandToggle = (label: string) =>
      [...view.container.querySelectorAll<HTMLButtonElement>(".oc-command-toolbar .oc-toggle")].find((node) =>
        node.textContent?.startsWith(label),
      )
    click(commandToggle("Failed"))
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.commandFilter, "failed")
    click(commandToggle("Slow"))
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.commandFilter, "slow")
    click(commandToggle("Background"))
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.commandFilter, "background")
    click(commandToggle("All"))
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.commandFilter, "all")
    click(commandToggle("Slowest"))
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.commandSort, "slowest")
    click(commandToggle("Latest"))
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.commandSort, "latest")

    click(byText(view.container, ".oc-toolbar", "git") as Element | undefined)
    await settle()
    view.dispose()
  })

  test("applies the attention chips and clears them again", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const chips = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-attention-chip")]
    assert.ok(chips.length > 0)
    for (const label of ["Slowest", "Most failures", "Most repeated", "Background"]) {
      const chip = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-attention-chip")].find(
        (node) => node.querySelector(".oc-attention-kind")?.textContent === label,
      )
      assert.ok(chip, `missing ${label} chip`)
      click(chip)
      await settle()
    }
    const status = panelMemoryOf("ses_test").ui
    assert.ok(status.commandQuery !== undefined)
    const applied = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-attention-chip-on")]
    assert.ok(applied.length > 0)
    for (const chip of [...view.container.querySelectorAll<HTMLButtonElement>(".oc-attention-chip")]) {
      if (chip.classList.contains("oc-attention-chip-on")) click(chip)
      await settle()
    }
    view.dispose()
  })

  test("filters files by kind, search, and each sort order", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const fileToolbars = view.container.querySelectorAll<HTMLElement>(".oc-file-toolbar .oc-toolbar")
    const filters = [...fileToolbars[0].querySelectorAll<HTMLButtonElement>(".oc-toggle")]
    for (const [index, kind] of ["read", "write", "search", "image"].entries()) {
      click(filters[index + 1])
      await settle()
      assert.equal(panelMemoryOf("ses_test").ui.fileFilter, kind)
    }
    click(filters[0])
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.fileFilter, "all")

    const search = view.container.querySelector<HTMLInputElement>(".oc-file-toolbar .oc-search")
    assert.ok(search)
    typeInto(search, "logo")
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.fileQuery, "logo")
    assert.equal(view.container.querySelectorAll(".oc-file-row").length, 1)
    typeInto(search, "")
    await settle()

    const sorts = [...fileToolbars[1].querySelectorAll<HTMLButtonElement>(".oc-toggle")]
    assert.equal(sorts.length, 5)
    for (const [index, kind] of ["count", "lines", "latest", "path", "name"].entries()) {
      click(sorts[index])
      await settle()
      assert.equal(panelMemoryOf("ses_test").ui.fileSort, kind)
    }
    view.dispose()
  })

  test("grows the event, file, command and children pages on scroll", async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      id: `ev${index}`,
      type: "system",
      text: `note ${index}`,
      time: { created: minute(0) + index },
    })) as unknown as SessionMessageInfo[]
    const files = Array.from({ length: 60 }, (_, index) => ({
      id: `fl${index}`,
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: minute(1) + index, completed: minute(1) + index + 10 },
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      content: [
        {
          type: "tool",
          id: `fl-tool-${index}`,
          name: "read",
          time: { created: minute(1) + index, completed: minute(1) + index + 5 },
          state: { status: "completed", input: { path: `src/file${index}.ts` } },
        },
        {
          type: "tool",
          id: `cmd-${index}`,
          name: "shell",
          time: { created: minute(1) + index, ran: minute(1) + index + 1, completed: minute(1) + index + 6 },
          state: { status: "completed", input: { command: `pnpm run ${index}` }, metadata: { exit: 0 } },
        },
      ],
    })) as unknown as SessionMessageInfo[]
    const view = setup({ messages: [...many, ...files] })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    for (const key of ["events", "files", "commands"]) {
      const section = view.container.querySelector<HTMLElement>(`[data-scroll-key="${key}"]`)
      assert.ok(section, `missing ${key} scroll`)
      Object.defineProperty(section, "scrollHeight", { value: 500, configurable: true })
      Object.defineProperty(section, "clientHeight", { value: 400, configurable: true })
      section.scrollTop = 100
      section.dispatchEvent(new Event("scroll"))
      await settle()
    }
    assert.equal(panelMemoryOf("ses_test").ui.eventLimit, 60)
    assert.equal(panelMemoryOf("ses_test").ui.fileLimit, 60)
    assert.equal(panelMemoryOf("ses_test").ui.commandLimit, 60)
    view.dispose()
  })

  test("reacts to session stream events and snapshot refreshes", async () => {
    const snapshots = { count: 0 }
    const view = setup({
      rpc: richRpc({
        snapshot: async () => {
          snapshots.count += 1
          return { snapshot: null }
        },
      }),
    })
    await settle()
    click(tab(view.container, "Details"))
    await settle()

    view.emit("session.text.delta")
    view.emit("session.tool.success")
    view.emit("session.tool.success", "ses_other")
    view.emit("session.step.ended")
    view.emit("session.step.ended", "ses_other")
    view.emit("session.compaction.ended")
    view.emit("session.execution.failed", "ses_other")
    view.emit("session.unknown.event")
    await wait(400)
    await settle()
    const before = snapshots.count
    view.emit("session.step.ended")
    await settle()
    assert.equal(snapshots.count, before + 1)
    view.dispose()
  })

  test("keeps the next snapshot when the routed session changed mid-flight", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    view.session.id = "ses_other"
    await settle()
    click(tab(view.container, "Overview"))
    await settle()
    assert.ok(view.container.querySelector(".oc-section-title"))
    view.dispose()
  })

  test("loads more history when the log is paged", async () => {
    const ctx = makePluginContext()
    const props = makeSessionProps()
    const paginated = props as unknown as { session: { server: { data: Record<string, unknown> } } }
    const data = paginated.session.server.data as {
      session: { message: { more: () => boolean; loading: () => boolean; loadMore: unknown } }
    }
    const loadMore = vi.fn(async () => {})
    data.session.message.more = () => true
    data.session.message.loading = () => false
    data.session.message.loadMore = loadMore
    const { container, dispose } = mount(() => <ContextView {...props} />, ctx)
    await settle()
    assert.equal(loadMore.mock.calls.length, 1)
    assert.ok(container.querySelector(".oc-section-title"))
    dispose()
  })

  test("skips loadMore while the store is already loading it", async () => {
    const props = makeSessionProps()
    const paginated = props as unknown as { session: { server: { data: Record<string, unknown> } } }
    const data = paginated.session.server.data as {
      session: { message: { more: () => boolean; loading: () => boolean; loadMore: unknown } }
    }
    const loadMore = vi.fn(async () => {})
    data.session.message.more = () => true
    data.session.message.loading = () => true
    data.session.message.loadMore = loadMore
    const { dispose } = mount(() => <ContextView {...props} />)
    await settle()
    assert.equal(loadMore.mock.calls.length, 0)
    dispose()
  })

  test("tracks live fleet activity and follows a focused agent", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Fleet"))
    await settle()
    await settle()

    const tree = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].find(
      (node) => node.textContent === "Tree",
    )
    assert.ok(tree)
    const stage = () => view.container.querySelector<HTMLElement>(".oc-fleet-stage")
    click(tree)
    await settle()
    assert.ok(stage())

    const width = 640
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { value: width, configurable: true })
    await settle()
    for (const observer of resizeObservers) {
      for (const target of observer.targets) {
        if (target instanceof HTMLElement && target.classList.contains("oc-fleet-stage")) {
          observer.callback([{ contentRect: { width: 700 } } as unknown as ResizeObserverEntry], {} as ResizeObserver)
        }
      }
    }
    await settle()
    const card = view.container.querySelector<HTMLButtonElement>(".oc-fleet-card")
    assert.ok(card)
    hover(card)
    await settle()
    click(card)
    await settle()
    const open = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-toggle")].find(
      (node) => node.textContent === "Open",
    )
    if (open !== undefined) {
      click(open)
      await settle()
    }
    delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth
    view.dispose()
  })

  test("jumps from the overview to a child agent and scrolls the fleet stage", async () => {
    const view = setup({ rpc: richRpc(), sessions: [sessionInfo(), childSession()] })
    await settle()
    const button = view.container.querySelector<HTMLButtonElement>(".oc-table-button")
    assert.ok(button)
    click(button)
    await settle()
    await settle()
    assert.equal(view.container.querySelector(".oc-tab-active")?.textContent, "Fleet")
    const tree = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].find(
      (node) => node.textContent === "Tree",
    )
    assert.ok(tree)
    click(tree)
    await settle()
    await settle()
    const focused = view.container.querySelector<HTMLElement>(".oc-fleet-card")
    assert.ok(focused)
    const firstID = focused.getAttribute("data-fleet-id")
    assert.ok(firstID === "ses_test" || firstID === "ses_child")
    const cards = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-fleet-card")]
    const child = cards.find((card) => card.dataset.fleetId !== firstID)
    assert.ok(child)
    click(child)
    await settle()
    assert.ok(view.container.querySelector(".oc-fleet-inspector"))
    view.dispose()
  })

  test("matches a model by modelID and shows the preview time", async () => {
    const view = setup({
      models: [{ id: "other", modelID: "m", providerID: "p", name: "Alias Model", limit: { context: 1000, output: 100 } }],
      rpc: richRpc(),
    })
    await settle()
    assert.match(view.container.textContent ?? "", /Alias Model/)
    view.dispose()
  })

  test("settles the hovered trend bar into the header time", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()
    const bar = view.container.querySelector(".oc-trend-bar")
    assert.ok(bar)
    hover(bar)
    await wait(160)
    await settle()
    assert.ok(view.container.querySelector(".oc-trend-detail"))
    hover(bar, "mouseleave")
    await wait(160)
    await settle()
    view.dispose()
  })

  test("fills and trims the composition cache across many steps", async () => {
    const base = richMessages()
    const view = setup({ messages: base, rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    for (let index = 0; index < 10; index += 1) {
      const tail = assistant({
        id: `t${index}`,
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: minute(10 + index), completed: minute(11 + index) },
        tokens: { input: 10 + index, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        content: [text(`tail ${index}`)],
      })
      view.setMessages([...base, tail])
      await settle()
      click(tab(view.container, "Overview"))
      await settle()
      click(tab(view.container, "Details"))
      await settle()
    }
    assert.ok(view.container.querySelector(".oc-section-title"))
    view.dispose()
  })

  test("pages the step select past 200 steps and pins an old step", async () => {
    const head = [{ id: "u1", type: "user", text: "go", time: { created: minute(0) } }] as SessionMessageInfo[]
    const steps = Array.from({ length: 210 }, (_, index) =>
      assistant({
        id: `s${index}`,
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: minute(1) + index * 1000, completed: minute(1) + index * 1000 + 500 },
        tokens: { input: 10 + index, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        content: [text("go")],
      }),
    )
    const memory = panelMemoryOf("ses_test")
    memory.ui.selected = "s0"
    memory.ui.browserLive = false
    const view = setup({ messages: [...head, ...steps], rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()
    const select = view.container.querySelector<HTMLSelectElement>(".oc-select")
    assert.ok(select)
    assert.equal(select.options.length, 201)
    assert.equal(select.options[1]?.value, "s0")
    choose(select, "s199")
    await settle()
    assert.equal(panelMemoryOf("ses_test").ui.selected, "s199")
    choose(select, "live")
    await settle()
    assert.equal(select.options[1]?.value, "s10")
    view.dispose()
  })

  test("focuses a file op and a command whose message is not a step", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const lateFile = [...view.container.querySelectorAll<HTMLElement>(".oc-file-row")].find((row) =>
      row.title.includes("late/file.ts"),
    )
    assert.ok(lateFile)
    click(lateFile)
    await settle()
    const lateOp = view.container.querySelector<HTMLButtonElement>(".oc-file-op-row")
    assert.ok(lateOp)
    click(lateOp)
    await settle()

    const lateCommand = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-command-time")].at(-1)
    assert.ok(lateCommand)
    click(lateCommand)
    await settle()
    view.dispose()
  })

  test("focuses every brief category and the response rows", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const chips = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-brief-chip")]
    assert.ok(chips.length > 0)
    for (const chip of chips) {
      click(chip)
      await settle()
    }
    assert.ok(view.container.querySelector(".oc-section-title"))
    view.dispose()
  })

  test("focuses compaction rows with and without a following step", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()
    const rows = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-compaction-row")]
    assert.equal(rows.length, 3)
    for (const row of rows) {
      click(row)
      await settle()
      await wait(40)
    }
    assert.equal(panelMemoryOf("ses_test").ui.browserOpen, "injected")
    view.dispose()
  })

  test("reveals a missing browser row after its retries run out", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()
    const jumps = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-event-jump")]
    assert.ok(jumps.length > 0)
    for (const jump of jumps) {
      click(jump)
      await settle()
    }
    await wait(700)
    await settle()
    assert.ok(scrollIntoViewCalls.length > 0)
    view.dispose()
  })

  test("closes a stale configuration request and reports a failed one", async () => {
    const view = setup({ rpc: richRpc() })
    view.dispose()

    const failing = setup({
      rpc: richRpc(),
      config: Promise.reject(new Error("no config")),
    })
    await settle()
    await settle()
    assert.ok(failing.container.querySelector(".oc-section-title"))
    failing.dispose()
  })

  test("survives a failing headers request and a stale header reply", async () => {
    const failing = setup({ rpc: richRpc({ headers: async () => Promise.reject(new Error("nope")) }) })
    await settle()
    click(tab(failing.container, "Details"))
    await settle()
    await settle()
    assert.ok(failing.container.querySelector(".oc-section-title"))
    failing.dispose()

    const stale = setup({ rpc: richRpc() })
    await settle()
    click(tab(stale.container, "Details"))
    stale.dispose()
  })

  test("keeps provider costs when the header reply has no detail", async () => {
    const view = setup({ rpc: richRpc({ header: async () => ({ header: null }) }) })
    await settle()
    await settle()
    assert.match(view.container.textContent ?? "", /No system\/tools snapshot/)
    assert.match(view.container.textContent ?? "", /provider-reported cost/)
    view.dispose()
  })

  test("evicts the oldest cached header once 17 versions exist", async () => {
    const head = [{ id: "u1", type: "user", text: "go", time: { created: minute(0) } }] as SessionMessageInfo[]
    const times = Array.from({ length: 17 }, (_, index) => minute(1) + index * 60_000)
    const steps = times.map((at, index) => assistant({
      id: `h${index}`,
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at, completed: at + 1000 },
      tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
      content: [text("ok")],
    }))
    const versions = times.map((at) => headerVersion(at))
    const view = setup({
      messages: [...head, ...steps],
      rpc: richRpc({
        headers: async () => ({ headers: versions }),
        header: async (params: { at: number }) => ({
          header: { summary: versions.find((version) => version.at === params.at) ?? versions[0], system: [], tools: [] },
        }),
      }),
    })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()
    for (const bar of view.container.querySelectorAll<HTMLElement>(".oc-trend-bar")) {
      click(bar)
      await settle()
    }
    assert.equal(headerCache.size, 16)
    view.dispose()
  })

  test("drops a snapshot reply that arrives after the session id changes", async () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const view = setup({
      rpc: richRpc({
        snapshot: async () => {
          await gate
          return { snapshot: null }
        },
      }),
    })
    await settle()
    view.session.id = "ses_moved"
    release()
    await settle()
    assert.ok(view.container.querySelector(".oc-section-title"))
    view.dispose()
  })

  test("reports a failed snapshot request", async () => {
    const view = setup({ rpc: richRpc({ snapshot: async () => Promise.reject(new Error("boom")) }) })
    await settle()
    await settle()
    assert.ok(view.container.querySelector(".oc-section-title"))
    view.dispose()
  })

  test("refreshes chart windows from the adaptive toggles", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()
    const adaptive = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].filter(
      (node) => node.textContent === "Adaptive",
    )
    assert.equal(adaptive.length, 2)
    for (const button of adaptive) {
      click(button)
      await settle()
      click(button)
      await settle()
    }
    assert.ok(view.container.querySelector(".oc-trend-scroll"))
    view.dispose()
  })

  test("reads stored limits that predate the current schema", async () => {
    const memory = panelMemoryOf("ses_test")
    memory.ui.eventLimit = undefined as never
    memory.ui.fileLimit = undefined as never
    memory.ui.fileOpsLimit = undefined as never
    memory.ui.commandLimit = undefined as never
    memory.ui.childrenLimit = undefined as never
    const view = setup({ rpc: richRpc() })
    await settle()
    assert.ok(view.container.querySelector(".oc-section-title"))
    view.dispose()
  })

  test("follows the overview jump while the tree mode is already chosen", async () => {
    const view = setup({ rpc: richRpc(), sessions: [sessionInfo(), childSession()] })
    await settle()
    click(tab(view.container, "Fleet"))
    await settle()
    const tree = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].find(
      (node) => node.textContent === "Tree",
    )
    assert.ok(tree)
    click(tree)
    await settle()
    click(tab(view.container, "Overview"))
    await settle()
    const button = view.container.querySelector<HTMLButtonElement>(".oc-table-button")
    assert.ok(button)
    click(button)
    await settle()
    await settle()
    assert.ok(view.container.querySelector(".oc-fleet-stage"))
    view.dispose()
  })

  test("skips the tree stage observer when the stage has no width or no observer", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Fleet"))
    await settle()
    const tree = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].find(
      (node) => node.textContent === "Tree",
    )
    assert.ok(tree)
    click(tree)
    await settle()
    const stage = view.container.querySelector<HTMLElement>(".oc-fleet-stage")
    assert.ok(stage)
    Object.defineProperty(stage, "clientWidth", { value: 0, configurable: true })
    await settle()
    const saved = globalThis.ResizeObserver
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver
    click(tab(view.container, "Overview"))
    await settle()
    click(tab(view.container, "Fleet"))
    await settle()
    globalThis.ResizeObserver = saved
    assert.ok(view.container.querySelector(".oc-fleet-stage"))
    view.dispose()
  })

  test("opens another agent from the fleet inspector", async () => {
    const opened: unknown[] = []
    const ctx = makePluginContext({
      tabs: { open: (target: unknown, options: unknown) => opened.push({ target, options }) },
    })
    const view = setup({ rpc: richRpc(), sessions: [sessionInfo(), childSession()], ctx })
    await settle()
    click(tab(view.container, "Fleet"))
    await settle()
    const tree = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].find(
      (node) => node.textContent === "Tree",
    )
    assert.ok(tree)
    click(tree)
    await settle()
    const cards = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-fleet-card")]
    const child = cards.find((card) => card.dataset.fleetId === "ses_child")
    assert.ok(child)
    click(child)
    await settle()
    const open = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-toggle")].find(
      (node) => node.textContent === "Open",
    )
    assert.ok(open)
    click(open)
    assert.equal(opened.length, 1)
    view.dispose()
  })

  test("focuses every kind of brief entry", async () => {
    const view = setup({
      messages: [
        { id: "u1", type: "user", text: "go", time: { created: minute(0) } },
        assistant({
          id: "a1",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: minute(1), completed: minute(2) },
          tokens: { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } },
          content: [
            tool("call-skill", "skill", {
              created: minute(1) + 1000,
              completed: minute(1) + 2000,
              input: { id: "pdf" },
              metadata: { name: "pdf" },
              content: [{ type: "text", text: "skill body" }],
            }),
            text("first reply"),
          ],
        }),
        assistant({
          id: "a2",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: minute(3), completed: minute(4) },
          tokens: { input: 20, output: 4, reasoning: 0, cache: { read: 0, write: 0 } },
          content: [
            text("second reply"),
            reasoning("why", minute(3) + 1000, minute(3) + 2000),
            tool("call-read", "read", {
              created: minute(3) + 3000,
              completed: minute(3) + 4000,
              input: { path: "src/app.ts" },
            }),
          ],
        }),
      ] as SessionMessageInfo[],
      rpc: richRpc(),
    })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const bars = [
      ...view.container.querySelectorAll<HTMLElement>(".oc-trend-plot .oc-trend-bar:not(.oc-trend-bar-stack)"),
    ]
    assert.equal(bars.length, 2)
    click(bars[1])
    await settle()
    const skill = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-brief-chip")].find(
      (chip) => chip.querySelector(".oc-brief-tag")?.textContent === "pdf",
    )
    assert.ok(skill)
    for (const chip of [...view.container.querySelectorAll<HTMLButtonElement>(".oc-brief-chip")]) {
      click(chip)
      await settle()
    }
    view.dispose()
  })

  test("labels swapped events that lack their fields", async () => {
    const view = setup({
      messages: [
        { id: "u1", type: "user", text: "go", time: { created: minute(0) } },
        { id: "m1", type: "model-switched", model: {}, time: { created: minute(1) } },
        { id: "g1", type: "agent-switched", time: { created: minute(1) + 1000 } },
      ] as unknown as SessionMessageInfo[],
      rpc: richRpc(),
    })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()
    const body = view.container.textContent ?? ""
    assert.match(body, /model switched: \? → \?/)
    assert.match(body, /agent switched: \? → \?/)
    view.dispose()
  })

  test("drops late configuration, header and snapshot replies", async () => {
    const documents = setup({
      rpc: richRpc(),
      config: [{ type: "document", info: {} }, { type: "other", info: {} }],
    })
    await settle()
    await settle()
    assert.ok(documents.container.querySelector(".oc-section-title"))
    documents.dispose()

    let releaseConfig = () => {}
    const configGate = new Promise<void>((resolve) => {
      releaseConfig = resolve
    })
    const lateConfig = setup({
      rpc: richRpc(),
      config: configGate.then(() => {
        throw new Error("late config")
      }),
    })
    await settle()
    lateConfig.dispose()
    releaseConfig()
    await settle()

    const emptyHeaders = setup({ rpc: richRpc({ headers: async () => ({}) }) })
    await settle()
    assert.ok(emptyHeaders.container.querySelector(".oc-section-title"))
    emptyHeaders.dispose()

    let releaseHeaders = () => {}
    const headersGate = new Promise<void>((resolve) => {
      releaseHeaders = resolve
    })
    const lateHeaders = setup({
      rpc: richRpc({
        headers: async () => {
          await headersGate
          return { headers: [headerVersion(T0)] }
        },
      }),
    })
    await settle()
    lateHeaders.dispose()
    releaseHeaders()
    await settle()

    let releaseHeaderError = () => {}
    const headerErrorGate = new Promise<void>((resolve) => {
      releaseHeaderError = resolve
    })
    const lateHeaderError = setup({
      rpc: richRpc({
        headers: async () => {
          await headerErrorGate
          throw new Error("late headers")
        },
      }),
    })
    await settle()
    lateHeaderError.dispose()
    releaseHeaderError()
    await settle()

    const stringError = setup({ rpc: richRpc({ header: async () => Promise.reject("bad detail") }) })
    await settle()
    click(tab(stringError.container, "Details"))
    await settle()
    await settle()
    assert.match(stringError.container.textContent ?? "", /snapshot unavailable/)
    stringError.dispose()

    let releaseDetail = () => {}
    const detailGate = new Promise<void>((resolve) => {
      releaseDetail = resolve
    })
    const lateDetail = setup({
      rpc: richRpc({
        header: async () => {
          await detailGate
          return { header: headerDetail(T0) }
        },
      }),
    })
    await settle()
    lateDetail.dispose()
    releaseDetail()
    await settle()

    let releaseDetailError = () => {}
    const detailErrorGate = new Promise<void>((resolve) => {
      releaseDetailError = resolve
    })
    const lateDetailError = setup({
      rpc: richRpc({
        header: async () => {
          await detailErrorGate
          throw new Error("late detail")
        },
      }),
    })
    await settle()
    lateDetailError.dispose()
    releaseDetailError()
    await settle()

    let releaseSnapshot = () => {}
    const snapshotGate = new Promise<void>((resolve) => {
      releaseSnapshot = resolve
    })
    const staleSnapshot = setup({
      rpc: richRpc({
        snapshot: async () => {
          await snapshotGate
          throw new Error("late snapshot")
        },
      }),
    })
    await settle()
    staleSnapshot.session.id = "ses_moved"
    releaseSnapshot()
    await settle()
    assert.ok(staleSnapshot.container.querySelector(".oc-section-title"))
    staleSnapshot.dispose()
  })

  test("skips chart scroll work when the root detaches", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    view.container.remove()
    await settle()
    assert.ok(view.container.querySelector(".oc-trend-scroll"))
    view.dispose()
  })

  test("renders an empty browser with live off", async () => {
    const memory = panelMemoryOf("ses_test")
    memory.view = "browser"
    memory.ui.browserLive = false
    memory.ui.selected = undefined
    const view = setup({ messages: [], rpc: richRpc(), info: null })
    await settle()
    await settle()
    assert.ok(view.container.querySelector(".oc-section-title"))
    view.dispose()
  })

  test("hovers turn rows and jumps into the browser from a chart segment", async () => {
    const view = setup({ rpc: richRpc() })
    await settle()
    click(tab(view.container, "Details"))
    await settle()
    await settle()

    const bar = view.container.querySelector<HTMLElement>(".oc-trend-bar")
    assert.ok(bar)
    hover(bar)
    await settle()

    const segment = view.container.querySelector<HTMLElement>(".oc-trend-chart-up > div")
    assert.ok(segment)
    click(segment)
    await settle()

    for (const strip of view.container.querySelectorAll<HTMLElement>(".oc-trend-turns")) {
      hover(strip, "mouseleave")
      await settle()
    }

    const turns = () =>
      [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].filter(
        (node) => node.textContent === "Turns",
      )
    assert.equal(turns().length, 2)
    click(turns()[0])
    await settle()
    click(turns()[1])
    await settle()

    const trendTurn = view.container.querySelector<HTMLElement>(".oc-trend-turn")
    assert.ok(trendTurn)
    hover(trendTurn)
    await settle()
    const timingBar = view.container.querySelector<HTMLElement>(".oc-trend-bar-stack")
    assert.ok(timingBar)
    hover(timingBar)
    await settle()
    view.dispose()
  })

  test("ticks the fleet clock and measures the tree stage", async () => {
    const savedWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth")
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 1200 })
    vi.useFakeTimers()
    try {
      const view = setup({ rpc: richRpc(), sessions: [sessionInfo(), childSession()] })
      await vi.advanceTimersByTimeAsync(50)
      click(tab(view.container, "Fleet"))
      await vi.advanceTimersByTimeAsync(50)
      const tree = [...view.container.querySelectorAll<HTMLButtonElement>(".oc-segment-btn")].find(
        (node) => node.textContent === "Tree",
      )
      assert.ok(tree)
      click(tree)
      await vi.advanceTimersByTimeAsync(50)

      const stage = view.container.querySelector<HTMLElement>(".oc-fleet-stage")
      assert.ok(stage)
      await vi.advanceTimersByTimeAsync(16_000)
      const observer = [...resizeObservers].reverse().find((entry) => entry.targets.includes(stage))
      assert.ok(observer)
      observer.callback([{ contentRect: { width: 900 } } as ResizeObserverEntry], {} as ResizeObserver)
      await vi.advanceTimersByTimeAsync(0)
      observer.callback([{ contentRect: { width: 900 } } as ResizeObserverEntry], {} as ResizeObserver)
      observer.callback([], {} as ResizeObserver)
      await vi.advanceTimersByTimeAsync(0)
      assert.ok(view.container.querySelector(".oc-fleet-stage"))
      view.dispose()
    } finally {
      vi.useRealTimers()
      if (savedWidth === undefined) delete (HTMLElement.prototype as { clientWidth?: unknown }).clientWidth
      else Object.defineProperty(HTMLElement.prototype, "clientWidth", savedWidth)
    }
  })

  test("swallows a failing message sync", async () => {
    const view = setup({
      rpc: richRpc(),
      messageSync: async () => {
        throw new Error("sync failed")
      },
    })
    await settle()
    assert.ok(view.container.querySelector(".oc-section-title"))
    view.dispose()
  })
})

