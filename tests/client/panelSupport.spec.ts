import assert from "node:assert/strict"
import { beforeEach, describe, test } from "vitest"
import {
  COMMAND_GLYPH,
  commandDurationColor,
  defaultPanelUi,
  FILE_FILTERS,
  fileGlyphOf,
  isImagePath,
  panelMemory,
  panelMemoryOf,
  previewableFile,
  revealScrollIndex,
  splitFilePath,
  stackedRibbon,
  visibleWindow,
} from "../../src/client/panelSupport.ts"
import { TREND_BAR, TREND_GAP, TREND_HEIGHT } from "../../src/client/styleMetrics.ts"

describe("commandDurationColor", () => {
  test("marks slow and very slow runs only", () => {
    assert.equal(commandDurationColor(5_000), undefined)
    assert.equal(commandDurationColor(10_000), "#c9a227")
    assert.equal(commandDurationColor(59_999), "#c9a227")
    assert.equal(commandDurationColor(60_000), "#d64545")
  })
})

describe("file helpers", () => {
  test("recognises image paths case-insensitively", () => {
    assert.equal(isImagePath("a/b/shot.PNG"), true)
    assert.equal(isImagePath("a/b/shot.webp"), true)
    assert.equal(isImagePath("a/b/shot.txt"), false)
  })

  test("maps extensions to glyph labels with a neutral fallback", () => {
    assert.deepEqual(fileGlyphOf("src/a.ts"), { label: "TS", color: "#3b82f6" })
    assert.deepEqual(fileGlyphOf("logo.svg"), { label: "IMG", color: "#8b5cf6" })
    assert.deepEqual(fileGlyphOf("README"), { label: "·", color: "#94a3b8" })
  })

  test("splits on the last slash of either kind", () => {
    assert.deepEqual(splitFilePath("src/lib/a.ts"), { dir: "src/lib/", base: "a.ts" })
    assert.deepEqual(splitFilePath("src\\lib\\a.ts"), { dir: "src\\lib\\", base: "a.ts" })
    assert.deepEqual(splitFilePath("a.ts"), { dir: "", base: "a.ts" })
  })

  test("only offers a preview for known text and image extensions", () => {
    assert.equal(previewableFile("a.ts"), true)
    assert.equal(previewableFile("D:/x/report.PDF"), false)
    assert.equal(previewableFile("notes.md"), true)
    assert.equal(previewableFile("archive.tar.gz"), false)
    assert.equal(previewableFile("README"), false)
    assert.equal(previewableFile(".gitignore"), false)
  })
})

describe("panelMemoryOf", () => {
  beforeEach(() => panelMemory.clear())

  test("creates the default view and UI state", () => {
    const memory = panelMemoryOf("ses_a")
    assert.equal(memory.view, "overview")
    assert.equal(memory.sections.size, 0)
    assert.deepEqual(memory.ui, defaultPanelUi())
    assert.equal(memory.ui.eventLimit, 50)
    assert.deepEqual(memory.ui.eventKinds, ["inject", "skill", "compaction", "model", "agent", "error"])
  })

  test("returns the same memory and keeps the newest 32 sessions", () => {
    assert.equal(panelMemoryOf("ses_a"), panelMemoryOf("ses_a"))
    panelMemory.clear()
    for (let index = 0; index < 33; index++) panelMemoryOf(`ses_${index}`)
    assert.equal(panelMemory.size, 32)
    assert.equal(panelMemory.has("ses_0"), false)
    assert.equal(panelMemory.has("ses_32"), true)
  })
})

describe("visibleWindow", () => {
  test("maps the scroll offset to bar indices", () => {
    const el = { clientWidth: 44, scrollLeft: 0 } as HTMLDivElement
    assert.deepEqual(visibleWindow(el, 10), { from: 0, to: 1 })

    el.scrollLeft = 2 * (TREND_BAR + TREND_GAP)
    assert.deepEqual(visibleWindow(el, 10), { from: 2, to: 3 })

    el.scrollLeft = 1_000
    assert.deepEqual(visibleWindow(el, 10), { from: 45, to: 9 })
  })

  test("returns nothing without bars or width", () => {
    assert.equal(visibleWindow({ clientWidth: 44, scrollLeft: 0 } as HTMLDivElement, 0), undefined)
    assert.equal(visibleWindow({ clientWidth: 0, scrollLeft: 0 } as HTMLDivElement, 5), undefined)
  })
})

describe("revealScrollIndex", () => {
  test("scrolls an off-screen bar to the middle", () => {
    const calls: Array<{ left: number; behavior: string }> = []
    const el = {
      clientWidth: 100,
      scrollLeft: 0,
      scrollWidth: 1_000,
      scrollTo: (options: { left: number; behavior: string }) => calls.push(options),
    } as unknown as HTMLDivElement
    revealScrollIndex(el, 10, 20)
    assert.deepEqual(calls, [{ left: 179, behavior: "smooth" }])
  })

  test("keeps an already visible bar still", () => {
    const calls: number[] = []
    const el = {
      clientWidth: 100,
      scrollLeft: 0,
      scrollWidth: 1_000,
      scrollTo: ({ left }: { left: number }) => calls.push(left),
    } as unknown as HTMLDivElement
    revealScrollIndex(el, 1, 20)
    assert.deepEqual(calls, [])
    revealScrollIndex(el, -1, 20)
    revealScrollIndex(el, 20, 20)
    assert.deepEqual(calls, [])
  })
})

describe("stackedRibbon", () => {
  test("returns nothing for an empty chart", () => {
    assert.deepEqual(stackedRibbon(0, ["a"], 10, () => 1), [])
  })

  test("keeps only bands with values and stacks their heights", () => {
    const polygons = stackedRibbon(3, ["a", "b", "c"], 4, (_index, key) => (key === "a" ? 1 : key === "b" ? 2 : 0))
    assert.deepEqual(polygons.map((polygon) => polygon.key), ["a", "b"])
    assert.match(polygons[0].points, new RegExp(`^0,${TREND_HEIGHT - (1 / 4) * TREND_HEIGHT}`))
    assert.match(polygons[1].points, new RegExp(`^0,${TREND_HEIGHT - (3 / 4) * TREND_HEIGHT}`))
  })

  test("uses a full-width band for a single point", () => {
    const polygons = stackedRibbon(1, ["a"], 10, () => 5)
    assert.deepEqual(polygons, [{ key: "a", points: `0,${TREND_HEIGHT / 2} 1000,${TREND_HEIGHT / 2} 1000,${TREND_HEIGHT} 0,${TREND_HEIGHT}` }])
  })

  test("samples long series at most 320 columns", () => {
    const polygons = stackedRibbon(1_000, ["a"], 10, () => 1)
    const points = polygons[0].points.split(" ")
    assert.equal(points.length, 2 * 251)
  })
})

describe("constants", () => {
  test("lists the filters and command glyphs the sections render", () => {
    assert.deepEqual(FILE_FILTERS, ["all", "read", "write", "search", "image"])
    assert.equal(COMMAND_GLYPH.failed.glyph, "✕")
    assert.equal(COMMAND_GLYPH.running.label, "cmds.status.running")
  })
})
