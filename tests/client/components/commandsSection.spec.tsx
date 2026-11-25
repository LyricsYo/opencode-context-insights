import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createSignal } from "solid-js"
import type { CommandRow, CommandSummary } from "../../../src/shared/report.ts"
import { CommandsSection, type CommandsSectionProps } from "../../../src/client/components/commandsSection.tsx"
import { mount } from "../helpers/mount.tsx"

const at = Date.UTC(2026, 10, 16, 8, 41)

function makeRow(patch: Partial<CommandRow> = {}): CommandRow {
  return {
    id: "c1",
    messageID: "m1",
    at,
    command: "pnpm test",
    preview: "pnpm test",
    tool: "bash",
    nested: false,
    status: "completed",
    background: false,
    truncated: false,
    program: "pnpm",
    programs: ["pnpm"],
    lines: 1,
    heredoc: false,
    inline: false,
    output: "ok",
    outChars: 2,
    outLines: 1,
    ...patch,
  }
}

function makeSummary(patch: Partial<CommandSummary> = {}): CommandSummary {
  return {
    runs: 3,
    failed: 1,
    totalMs: 4200,
    background: 0,
    programs: [
      { name: "pnpm", count: 2 },
      { name: "git", count: 1 },
    ],
    ...patch,
  }
}

interface AttentionChip {
  readonly label: string
  readonly value: string
  readonly count: number
  readonly on: boolean
  readonly apply: () => void
}

interface CommandUiInit {
  readonly commands?: CommandRow[]
  readonly shown?: CommandRow[]
  readonly summary?: CommandSummary
  readonly attention?: AttentionChip[]
  readonly stamps?: Map<string, { turn: number; step: number }>
  readonly filter?: string
  readonly sort?: string
  readonly query?: string
  readonly program?: string
  readonly open?: string
  readonly limit?: number
  readonly counts?: Record<string, number>
}

function makeCommandsUi(init: CommandUiInit = {}) {
  const [filter, setFilter] = createSignal(init.filter ?? "all")
  const [sort, setSort] = createSignal(init.sort ?? "latest")
  const [query, setQuery] = createSignal(init.query ?? "")
  const [program, setProgram] = createSignal<string | undefined>(init.program)
  const [open, setOpen] = createSignal<string | undefined>(init.open)
  const [limit, setLimit] = createSignal(init.limit ?? 50)
  const focused: CommandRow[] = []
  const ui = {
    commandShown: () => init.shown ?? init.commands ?? [],
    commands: () => init.commands ?? [],
    commandSummary: () => init.summary ?? makeSummary(),
    commandAttention: () => init.attention ?? [],
    commandCounts: () => init.counts ?? {},
    stepStampByID: () => init.stamps ?? new Map(),
    commandFilter: filter,
    setCommandFilter: setFilter,
    commandSort: sort,
    setCommandSort: setSort,
    commandQuery: query,
    setCommandQuery: setQuery,
    commandProgram: program,
    setCommandProgram: setProgram,
    commandOpen: open,
    setCommandOpen: setOpen,
    commandLimit: limit,
    setCommandLimit: setLimit,
    focusCommand: (row: CommandRow) => focused.push(row),
  }
  return { ui, focused, filter, sort, query, program, open, limit }
}

const noop = () => {}

function makeProps(ui: object): CommandsSectionProps {
  return {
    session: undefined,
    trend: undefined,
    timing: undefined,
    browser: undefined,
    ui,
    attachTrendScroll: noop,
    attachTimingScroll: noop,
    attachBrowserAnchor: noop,
    attachBrowserSelect: noop,
    measureTrendWindow: noop,
    measureTimingWindow: noop,
    refreshTrendWindow: noop,
    refreshTimingWindow: noop,
    scrollToBrowser: noop,
  } as unknown as CommandsSectionProps
}

const click = (element: Element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
const detailOf = (row: Element) => row.parentElement?.querySelector<HTMLElement>(".oc-command-detail") ?? null

describe("CommandsSection", () => {
  test("shows the summary hint and the empty state", () => {
    const state = makeCommandsUi({ summary: makeSummary() })
    const { container, dispose } = mount(() => <CommandsSection {...makeProps(state.ui)} />)

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "Commands")
    assert.equal(container.querySelector(".oc-hint")?.textContent, "3 runs · 4.2s · 1 failed (33%)")
    assert.match(container.textContent ?? "", /No commands executed in this session/)
    dispose()
  })

  test("filters, sorts, searches and picks a program", () => {
    const state = makeCommandsUi({ commands: [], filter: "failed", sort: "slowest", program: "pnpm" })
    const { container, dispose } = mount(() => <CommandsSection {...makeProps(state.ui)} />)

    const toolbars = container.querySelectorAll<HTMLElement>(".oc-command-toolbar .oc-toolbar")
    const toolbarButtons = [...toolbars[0].querySelectorAll<HTMLButtonElement>("button")]
    const filterButtons = toolbarButtons.slice(0, 4)
    assert.deepEqual(filterButtons.map((button) => button.firstChild?.textContent), ["All", "Failed", "Slow", "Background"])
    assert.ok(filterButtons[1].classList.contains("oc-toggle-active"))

    click(filterButtons[1])
    assert.equal(state.filter(), "all")
    click(filterButtons[2])
    assert.equal(state.filter(), "slow")
    assert.ok(filterButtons[2].classList.contains("oc-toggle-active"))

    const sortButtons = toolbarButtons.slice(4)
    assert.deepEqual(sortButtons.map((button) => button.textContent), ["Latest", "Slowest"])
    assert.ok(sortButtons[1].classList.contains("oc-toggle-active"))
    click(sortButtons[0])
    assert.equal(state.sort(), "latest")

    const search = container.querySelector<HTMLInputElement>(".oc-search")!
    search.value = "git log"
    search.dispatchEvent(new Event("input", { bubbles: true }))
    assert.equal(state.query(), "git log")
    assert.equal(state.program(), undefined)

    const select = container.querySelector<HTMLSelectElement>("select")!
    assert.equal(select.querySelectorAll("option")[0].value, "")
    assert.equal(select.value, "")
    select.value = "pnpm"
    select.dispatchEvent(new Event("change", { bubbles: true }))
    assert.equal(state.program(), "pnpm")
    assert.equal(select.value, "pnpm")
    select.value = ""
    select.dispatchEvent(new Event("change", { bubbles: true }))
    assert.equal(state.program(), undefined)
    dispose()
  })

  test("renders run badges and reveals the detail of each row", () => {
    const failing = makeRow({
      id: "c1",
      messageID: "m1",
      command: "pnpm build --long",
      preview: "pnpm build --long",
      description: "Build the package",
      status: "failed",
      exit: 1,
      duration: 61_000,
      nested: true,
      background: true,
      lines: 3,
      heredoc: true,
      inline: true,
      workdir: "D:/repo",
      timeoutMs: 90_000,
      outChars: 1234,
      outLines: 7,
      truncated: true,
      output: "line one\nline two",
    })
    const running = makeRow({
      id: "c2",
      messageID: "m2",
      command: "sleep 5",
      preview: "sleep 5",
      status: "running",
      output: "",
      outChars: 0,
      outLines: 0,
      at: at + 60_000,
    })
    const plain = makeRow({
      id: "c3",
      messageID: "m3",
      command: "echo hi",
      preview: "echo hi",
      duration: 500,
      output: "hi\n",
      outChars: 3,
      outLines: 1,
      at: at + 120_000,
    })
    const stamps = new Map([["m1", { turn: 2, step: 3 }]])
    const state = makeCommandsUi({ commands: [failing, running, plain], shown: [failing, running, plain], stamps })
    const { container, dispose } = mount(() => <CommandsSection {...makeProps(state.ui)} />)

    const rows = [...container.querySelectorAll<HTMLElement>(".oc-command-row")]
    assert.equal(rows.length, 3)

    const first = rows[0]
    assert.equal(first.querySelector(".oc-command-toggle")?.getAttribute("title"), "Build the package")
    assert.equal(first.querySelector(".oc-file-chevron")?.textContent, "▸")
    assert.deepEqual(
      [...first.querySelectorAll(".oc-command-tag")].map((node) => node.textContent),
      ["nested", "bg"],
    )
    assert.deepEqual(
      [...first.querySelectorAll(".oc-command-badge")].map((node) => node.textContent),
      ["3 lines", "heredoc", "inline"],
    )
    assert.equal(first.querySelector(".oc-command-duration")?.textContent, "1m01s")
    assert.equal((first.querySelector<HTMLElement>(".oc-command-duration")!).style.color, "rgb(214, 69, 69)")
    assert.match(first.querySelector(".oc-command-time")?.textContent ?? "", /^T2 S3 · \d{2}-\d{2} \d{2}:\d{2}$/)

    const second = rows[1]
    assert.equal(second.querySelectorAll(".oc-command-tag").length, 0)
    assert.equal(second.querySelectorAll(".oc-command-badge").length, 0)
    assert.equal(second.querySelector(".oc-command-duration")?.textContent, "Running")
    assert.equal((second.querySelector<HTMLElement>(".oc-command-duration")!).style.color, "rgb(201, 162, 39)")
    assert.doesNotMatch(second.querySelector(".oc-command-time")?.textContent ?? "", /^T/)

    const third = rows[2]
    assert.equal(third.querySelector(".oc-command-toggle")?.getAttribute("title"), "echo hi")
    assert.equal(third.querySelectorAll(".oc-command-badge").length, 0)

    click(first.querySelector(".oc-command-toggle")!)
    assert.equal(state.open(), "c1")
    assert.ok(first.classList.contains("oc-command-row-open"))
    assert.equal(first.querySelector(".oc-file-chevron")?.textContent, "▾")
    const detail = detailOf(first)!
    const facts = detail.querySelector(".oc-command-facts")?.textContent ?? ""
    assert.match(facts, /Failed/)
    assert.match(facts, /exit 1/)
    assert.match(facts, /1m01s/)
    assert.match(facts, /D:\/repo/)
    assert.match(facts, /timeout 1m30s/)
    assert.match(facts, /1\.2k chars · truncated/)
    assert.match(facts, /T2 S3/)
    assert.match(facts, /Reveal/)
    assert.equal(detail.querySelector(".oc-command-code")?.textContent, "pnpm build --long")
    assert.match(detail.querySelector(".oc-command-output-head")?.textContent ?? "", /7 lines · 1\.2k chars/)
    assert.equal(detail.querySelector(".oc-command-output")?.textContent, "line one\nline two")

    click(first.querySelector(".oc-command-toggle")!)
    assert.equal(state.open(), undefined)
    assert.equal(detailOf(first), null)
    assert.equal(first.querySelector(".oc-file-chevron")?.textContent, "▸")

    click(second.querySelector(".oc-command-toggle")!)
    const runningFacts = detailOf(second)?.querySelector(".oc-command-facts")?.textContent ?? ""
    assert.match(runningFacts, /Running/)
    assert.doesNotMatch(runningFacts, /exit |timeout |T\d+ S\d+/)
    assert.match(detailOf(second)?.textContent ?? "", /No text output/)
    assert.equal(detailOf(second)?.querySelector(".oc-command-output"), null)

    click(third.querySelector(".oc-command-toggle")!)
    const plainFacts = detailOf(third)?.querySelector(".oc-command-facts")?.textContent ?? ""
    assert.match(plainFacts, /Completed/)
    assert.match(plainFacts, /500ms/)
    assert.doesNotMatch(plainFacts, /truncated/)
    assert.match(detailOf(third)?.querySelector(".oc-command-output-head")?.textContent ?? "", /1 lines · 3 chars/)
    assert.equal(detailOf(third)?.querySelector(".oc-command-output")?.textContent, "hi\n")

    click(detailOf(third)!.querySelector(".oc-command-locate")!)
    assert.deepEqual(state.focused, [plain])
    click(first.querySelector(".oc-command-time")!)
    click(second.querySelector(".oc-command-time")!)
    assert.deepEqual(state.focused, [plain, failing, running])
    dispose()
  })

  test("renders attention chips and reports filtered-out runs", () => {
    const applied: string[] = []
    const state = makeCommandsUi({
      commands: [makeRow()],
      shown: [],
      attention: [
        { label: "Slowest", value: "pnpm build", count: 2, on: true, apply: () => applied.push("slowest") },
        { label: "Failures", value: "", count: 1, on: false, apply: () => applied.push("failures") },
      ],
    })
    const { container, dispose } = mount(() => <CommandsSection {...makeProps(state.ui)} />)

    assert.match(container.textContent ?? "", /No commands match the current filters/)
    const chips = [...container.querySelectorAll<HTMLElement>(".oc-attention-chip")]
    assert.equal(chips.length, 2)
    assert.ok(chips[0].classList.contains("oc-attention-chip-on"))
    assert.equal(chips[0].querySelector(".oc-attention-value")?.textContent, "pnpm build")
    assert.equal(chips[0].querySelector(".oc-attention-count")?.textContent, "2")
    assert.equal(chips[1].classList.contains("oc-attention-chip-on"), false)
    assert.equal(chips[1].querySelector(".oc-attention-value"), null)
    assert.equal(chips[1].querySelector(".oc-attention-count")?.textContent, "1")

    click(chips[0])
    click(chips[1])
    assert.deepEqual(applied, ["slowest", "failures"])
    assert.equal(container.querySelectorAll(".oc-command-row").length, 0)
    dispose()
  })

  test("grows the command page when the list nears its end", () => {
    const rows = Array.from({ length: 60 }, (_, index) =>
      makeRow({ id: `c${index}`, messageID: `m${index}` }),
    )
    const state = makeCommandsUi({ commands: rows, shown: rows, limit: 50 })
    const { container, dispose } = mount(() => <CommandsSection {...makeProps(state.ui)} />)

    assert.equal(container.querySelectorAll(".oc-command-row").length, 50)
    const scroll = container.querySelector<HTMLElement>(".oc-section-scroll")!
    Object.defineProperty(scroll, "scrollHeight", { value: 500, configurable: true })
    Object.defineProperty(scroll, "clientHeight", { value: 400, configurable: true })
    scroll.scrollTop = 100
    scroll.dispatchEvent(new Event("scroll"))

    assert.equal(state.limit(), 60)
    assert.equal(container.querySelectorAll(".oc-command-row").length, 60)
    dispose()
  })
})
