import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createSignal } from "solid-js"
import { clock, type FileOpRow, type FileRow } from "../../../src/shared/report.ts"
import { FilesSection, type FilesSectionProps } from "../../../src/client/components/filesSection.tsx"
import { mount } from "../helpers/mount.tsx"

const at = Date.UTC(2026, 10, 16, 8, 41)

function makeOp(patch: Partial<FileOpRow> = {}): FileOpRow {
  return {
    id: "o1",
    messageID: "m1",
    at,
    kind: "read",
    path: "src/app.ts",
    tool: "read",
    status: "completed",
    additions: 0,
    deletions: 0,
    ...patch,
  }
}

function makeFile(patch: Partial<FileRow> = {}): FileRow {
  return {
    path: "src/app.ts",
    reads: 1,
    writes: 0,
    searches: 0,
    additions: 0,
    deletions: 0,
    ops: [makeOp()],
    ...patch,
  }
}

const allCounts = {
  all: { files: 4, ops: 9 },
  read: { files: 2, ops: 4 },
  write: { files: 1, ops: 2 },
  search: { files: 1, ops: 3 },
  image: { files: 0, ops: 0 },
}

interface FilesUiInit {
  readonly groups?: FileRow[]
  readonly shown?: FileRow[]
  readonly counts?: Record<string, { files: number; ops: number }>
  readonly hint?: string
  readonly filter?: string
  readonly query?: string
  readonly sort?: string
  readonly open?: string
  readonly missing?: Map<string, boolean>
  readonly stamps?: Map<string, { turn: number; step: number }>
  readonly limit?: number
  readonly opsLimit?: number
}

function makeFilesUi(init: FilesUiInit = {}) {
  const [filter, setFilter] = createSignal(init.filter ?? "all")
  const [query, setQuery] = createSignal(init.query ?? "")
  const [sort, setSort] = createSignal(init.sort ?? "latest")
  const [open, setOpen] = createSignal<string | undefined>(init.open)
  const [limit, setLimit] = createSignal(init.limit ?? 50)
  const [opsLimit, setOpsLimit] = createSignal(init.opsLimit ?? 50)
  const focused: Array<{ messageID: string; path: string }> = []
  const previews: string[] = []
  const ui = {
    shownFiles: () => init.shown ?? init.groups ?? [],
    fileKindCounts: () => init.counts ?? allCounts,
    fileLimit: limit,
    setFileLimit: setLimit,
    fileOpsLimit: opsLimit,
    setFileOpsLimit: setOpsLimit,
    stepStampByID: () => init.stamps ?? new Map(),
    fileHint: () => init.hint ?? "4 files · 9 ops",
    fileFilter: filter,
    setFileFilter: setFilter,
    fileQuery: query,
    setFileQuery: setQuery,
    fileSort: sort,
    setFileSort: setSort,
    fileGroups: () => init.groups ?? [],
    fileOpen: open,
    setFileOpen: setOpen,
    fileMissing: () => init.missing ?? new Map(),
    focusFileOp: (messageID: string, path: string) => focused.push({ messageID, path }),
    previewFile: (path: string) => previews.push(path),
  }
  return { ui, focused, previews, filter, query, sort, open, limit, opsLimit }
}

const noop = () => {}

function makeProps(ui: object): FilesSectionProps {
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
  } as unknown as FilesSectionProps
}

const click = (element: Element) => element.dispatchEvent(new MouseEvent("click", { bubbles: true }))

describe("FilesSection", () => {
  test("shows the hint and empty state, and drives the toolbar", () => {
    const state = makeFilesUi({ hint: "4 files · 9 ops" })
    const { container, dispose } = mount(() => <FilesSection {...makeProps(state.ui)} />)

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "File activity")
    assert.equal(container.querySelector(".oc-hint")?.textContent, "4 files · 9 ops")
    assert.match(container.textContent ?? "", /No file operations/)

    const toolbars = container.querySelectorAll<HTMLElement>(".oc-file-toolbar .oc-toolbar")
    const filterButtons = [...toolbars[0].querySelectorAll<HTMLButtonElement>(".oc-toggle")]
    assert.deepEqual(filterButtons.map((button) => button.firstChild?.textContent), ["All", "Read", "Write", "Search", "Images"])
    assert.equal(filterButtons[0].getAttribute("title"), "4 files · 9 ops")
    assert.equal(filterButtons[1].getAttribute("title"), "2 files · 4 ops")
    assert.equal(filterButtons[4].getAttribute("title"), "0 files · 0 ops")
    assert.ok(filterButtons[0].classList.contains("oc-toggle-active"))

    click(filterButtons[1])
    assert.equal(state.filter(), "read")
    assert.ok(filterButtons[1].classList.contains("oc-toggle-active"))
    click(filterButtons[1])
    assert.equal(state.filter(), "all")

    const sortButtons = [...toolbars[1].querySelectorAll<HTMLButtonElement>("button")]
    assert.deepEqual(sortButtons.map((button) => button.textContent), ["Count", "Lines", "Latest", "Path", "Name"])
    assert.ok(sortButtons[2].classList.contains("oc-toggle-active"))
    click(sortButtons[1])
    assert.equal(state.sort(), "lines")

    const search = container.querySelector<HTMLInputElement>(".oc-search")!
    search.value = "src"
    search.dispatchEvent(new Event("input", { bubbles: true }))
    assert.equal(state.query(), "src")

    click(filterButtons[3])
    assert.equal(state.filter(), "search")
    dispose()
  })

  test("renders file rows, preview links, missing files and change badges", () => {
    const app = makeFile({
      path: "src/app.ts",
      reads: 3,
      writes: 2,
      searches: 1,
      additions: 10,
      deletions: 4,
      ops: [makeOp({ path: "src/app.ts" })],
    })
    const binary = makeFile({
      path: "assets/logo.unknown",
      reads: 0,
      writes: 0,
      searches: 0,
      ops: [makeOp({ path: "assets/logo.unknown", at: at + 1000 })],
    })
    const gone = makeFile({
      path: "docs/missing.md",
      reads: 0,
      ops: [makeOp({ path: "docs/missing.md", at: at + 2000 })],
      deletions: 2,
    })
    const added = makeFile({
      path: "src/added.ts",
      reads: 0,
      additions: 2,
      ops: [makeOp({ path: "src/added.ts", at: at + 3000 })],
    })
    const empty = makeFile({ path: "logs/empty.txt", reads: 0, writes: 0, searches: 0, ops: [] })
    const missing = new Map([
      ["src/app.ts", true],
      ["docs/missing.md", false],
    ])
    const state = makeFilesUi({ groups: [app, binary, gone, added, empty], shown: [app, binary, gone, added, empty], missing })
    const { container, dispose } = mount(() => <FilesSection {...makeProps(state.ui)} />)

    const rows = [...container.querySelectorAll<HTMLElement>(".oc-file-jump")]
    assert.equal(rows.length, 5)

    const first = rows[0]
    assert.equal(first.querySelector(".oc-file-glyph")?.textContent, "TS")
    assert.equal(first.querySelector(".oc-file-dir")?.textContent, "src/")
    assert.equal(first.querySelector(".oc-file-link b")?.textContent, "app.ts")
    assert.equal(first.querySelector(".oc-file-link")?.getAttribute("title"), "Preview this file")
    assert.deepEqual(
      [...first.querySelectorAll(".oc-file-badge")].map((node) => node.textContent),
      ["R3", "W2", "S1"],
    )
    assert.equal(first.querySelector(".oc-file-delta")?.textContent, "+10 −4")
    assert.equal(first.querySelector(".oc-file-chevron")?.textContent, "▸")
    assert.equal(first.querySelector(".oc-event-time")?.textContent, clock(at))

    const second = rows[1]
    assert.equal(second.querySelector(".oc-file-link"), null)
    assert.equal(second.querySelector(".oc-file-path b")?.textContent, "logo.unknown")
    assert.equal(second.querySelector(".oc-file-path b")?.classList.contains("oc-missing"), false)
    assert.equal(second.querySelector(".oc-file-path b")?.getAttribute("title"), null)
    assert.equal(second.querySelectorAll(".oc-file-badge").length, 0)
    assert.equal(second.querySelector(".oc-file-delta"), null)

    const third = rows[2]
    assert.equal(third.querySelector(".oc-file-link"), null)
    assert.equal(third.querySelector(".oc-file-path b")?.classList.contains("oc-missing"), true)
    assert.equal(third.querySelector(".oc-file-path b")?.getAttribute("title"), "File no longer exists")
    assert.equal(third.querySelector(".oc-file-delta")?.textContent, " −2")

    const fourth = rows[3]
    assert.equal(fourth.querySelector(".oc-file-delta")?.textContent, "+2")

    const fifth = rows[4]
    assert.equal(fifth.querySelector(".oc-file-delta"), null)
    assert.equal(fifth.querySelector(".oc-event-time")?.textContent, clock(0))
    dispose()
  })

  test("opens a file, pages its ops and marks failures", () => {
    const ops = [
      makeOp({ id: "o1", kind: "write", tool: "edit", additions: 10, deletions: 4, detail: "edit src/app.ts" }),
      makeOp({ id: "o2", kind: "read", lines: 12, tool: "read", messageID: "m2" }),
      makeOp({ id: "o3", kind: "read", status: "failed", tool: "read" }),
      makeOp({ id: "o4", kind: "search", tool: "grep", hits: 5, detail: "needle" }),
      makeOp({ id: "o5", kind: "search", status: "error", tool: "glob" }),
    ]
    const file = makeFile({ path: "src/app.ts", ops, additions: 10, deletions: 4 })
    const stamps = new Map([["m1", { turn: 1, step: 2 }]])
    const state = makeFilesUi({
      groups: [file],
      shown: [file],
      open: "src/app.ts",
      opsLimit: 2,
      stamps,
      missing: new Map([["src/app.ts", true]]),
    })
    const { container, dispose } = mount(() => <FilesSection {...makeProps(state.ui)} />)

    const detail = container.querySelector(".oc-file-ops")!
    assert.ok(detail)
    let opRows = [...detail.querySelectorAll<HTMLElement>(".oc-file-op-row")]
    assert.equal(opRows.length, 2)
    assert.deepEqual(
      [...opRows[0].querySelectorAll(".oc-file-op-tail span")].map((node) => node.textContent),
      ["+10 −4", clock(at), "T1 S2"],
    )
    assert.equal(opRows[0].querySelector(".oc-file-op-detail")?.textContent, "edit src/app.ts")
    assert.equal(opRows[1].querySelector(".oc-file-op-detail")?.textContent, "")
    assert.match(opRows[1].textContent ?? "", /12 lines/)
    assert.equal(opRows[1].querySelectorAll(".oc-file-op-tail span").length, 2)

    const showAll = [...detail.querySelectorAll<HTMLButtonElement>("button")].find((button) =>
      /Show all/.test(button.textContent ?? ""),
    )!
    assert.equal(showAll.textContent, "Show all 5 items")
    click(showAll)
    assert.equal(state.opsLimit(), 5)
    opRows = [...detail.querySelectorAll<HTMLElement>(".oc-file-op-row")]
    assert.equal(opRows.length, 5)

    assert.match(opRows[2].textContent ?? "", /failed/)
    assert.ok(opRows[2].querySelector(".oc-file-op-error"))
    assert.match(opRows[3].textContent ?? "", /5 matches/)
    assert.match(opRows[4].textContent ?? "", /error/)
    assert.ok(opRows[4].querySelector(".oc-file-op-error"))
    assert.equal(opRows[3].querySelector(".oc-file-op-error"), null)

    click(opRows[3])
    assert.deepEqual(state.focused, [{ messageID: "m1", path: "src/app.ts" }])
    dispose()
  })

  test("previews through mouse and keyboard without toggling the row", () => {
    const file = makeFile({ ops: [makeOp()] })
    const state = makeFilesUi({ groups: [file], shown: [file], missing: new Map([["src/app.ts", true]]) })
    const { container, dispose } = mount(() => <FilesSection {...makeProps(state.ui)} />)

    const link = container.querySelector<HTMLElement>(".oc-file-link")!
    click(link)
    assert.deepEqual(state.previews, ["src/app.ts"])
    assert.equal(state.open(), undefined)

    link.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }))
    assert.equal(state.previews.length, 1)
    link.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    assert.equal(state.previews.length, 2)
    link.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }))
    assert.equal(state.previews.length, 3)

    const row = container.querySelector<HTMLElement>(".oc-file-jump")!
    click(row)
    assert.equal(state.open(), "src/app.ts")
    assert.equal(state.opsLimit(), 50)
    assert.equal(container.querySelector(".oc-file-chevron")?.textContent, "▾")
    assert.ok(row.classList.contains("oc-file-row-open"))
    assert.equal(container.querySelectorAll(".oc-file-op-row").length, 1)
    assert.doesNotMatch(container.querySelector(".oc-file-ops")?.textContent ?? "", /Show all/)

    click(row)
    assert.equal(state.open(), undefined)
    assert.equal(container.querySelector(".oc-file-ops"), null)
    assert.equal(container.querySelector(".oc-file-chevron")?.textContent, "▸")
    dispose()
  })

  test("reports files filtered out and grows the file page on scroll", () => {
    const filtered = makeFilesUi({ groups: [makeFile()], shown: [] })
    const filteredMount = mount(() => <FilesSection {...makeProps(filtered.ui)} />)
    assert.match(filteredMount.container.textContent ?? "", /No files match/)
    filteredMount.dispose()

    const files = Array.from({ length: 70 }, (_, index) =>
      makeFile({ path: `src/file${index}.ts`, ops: [makeOp({ path: `src/file${index}.ts` })] }),
    )
    const state = makeFilesUi({ groups: files, shown: files, limit: 50 })
    const { container, dispose } = mount(() => <FilesSection {...makeProps(state.ui)} />)
    assert.equal(container.querySelectorAll(".oc-file-jump").length, 50)

    const scroll = container.querySelector<HTMLElement>(".oc-section-scroll")!
    Object.defineProperty(scroll, "scrollHeight", { value: 500, configurable: true })
    Object.defineProperty(scroll, "clientHeight", { value: 400, configurable: true })
    scroll.scrollTop = 100
    scroll.dispatchEvent(new Event("scroll"))

    assert.equal(state.limit(), 70)
    assert.equal(container.querySelectorAll(".oc-file-jump").length, 70)
    dispose()
  })
})
