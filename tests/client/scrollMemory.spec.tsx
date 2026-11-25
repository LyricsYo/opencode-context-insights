import assert from "node:assert/strict"
import { beforeEach, describe, test } from "vitest"
import { createSignal } from "solid-js"
import { createScrollMemory } from "../../src/client/scrollMemory.ts"
import { panelMemory, panelMemoryOf } from "../../src/client/panelSupport.ts"
import { mount } from "./helpers/mount.tsx"

function probe() {
  const view = createSignal<"overview" | "browser" | "fleet">("overview")
  let memory: ReturnType<typeof createScrollMemory> | undefined
  let section: HTMLDivElement | undefined
  let body: HTMLDivElement | undefined
  const mounted = mount(() => {
    memory = createScrollMemory({ sessionID: () => "ses_scroll", view: view[0] })
    return (
      <div ref={(el) => memory!.attachRoot(el)}>
        <div
          data-scroll-key="section-a"
          ref={(el) => {
            section = el
            memory!.attachBody(el)
          }}
        >
          <div
            data-scroll-key="section-b"
            ref={(el) => (body = el)}
          />
        </div>
        <div class="plain" />
        <svg class="vector" />
        <div
          data-scroll-key="ghost"
          ref={(el) => Object.defineProperty(el, "dataset", { value: {} })}
        />
      </div>
    )
  })
  assert.ok(memory && section && body)
  return { memory, section, body, view, ...mounted }
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 10))

describe("createScrollMemory", () => {
  beforeEach(() => panelMemory.clear())

  test("restores the body and keyed offsets", () => {
    const memory = probe()
    const saved = panelMemoryOf("ses_scroll")
    saved.scroll.set("overview", 25)
    saved.sections.set("section-a", { top: 10, left: 2 })
    saved.sections.set("section-b", { top: 30, left: 4 })

    memory.memory.restore()
    assert.equal(memory.section.scrollTop, 10)
    assert.equal(memory.section.scrollLeft, 2)
    assert.equal(memory.body.scrollTop, 30)
    assert.equal(memory.body.scrollLeft, 4)
    memory.dispose()
  })

  test("saves the panel body offset after a scroll", async () => {
    const memory = probe()
    await tick()
    memory.section.scrollTop = 55
    memory.memory.onBodyScroll()
    assert.equal(panelMemoryOf("ses_scroll").scroll.get("overview"), 55)
    memory.dispose()
  })

  test("saves nested scrollers unless they are collapsed", async () => {
    const memory = probe()
    await tick()
    Object.defineProperty(memory.body, "clientHeight", { value: 40, configurable: true })
    memory.body.scrollTop = 12
    memory.body.scrollLeft = 3
    memory.body.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.deepEqual(panelMemoryOf("ses_scroll").sections.get("section-b"), { top: 12, left: 3 })

    memory.section.scrollTop = 99
    memory.section.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(panelMemoryOf("ses_scroll").sections.get("section-a"), undefined)
    memory.dispose()
  })

  test("remembers the chart scroll only once mounted", async () => {
    const memory = probe()
    const trend = { scrollLeft: 120 } as HTMLDivElement
    memory.memory.rememberChartScroll("trend", trend)
    assert.equal(panelMemoryOf("ses_scroll").trendLeft, undefined)

    await tick()
    memory.memory.rememberChartScroll("trend", trend)
    memory.memory.rememberChartScroll("timing", { scrollLeft: 80 } as HTMLDivElement)
    assert.equal(panelMemoryOf("ses_scroll").trendLeft, 120)
    assert.equal(panelMemoryOf("ses_scroll").timingLeft, 80)
    memory.dispose()
  })

  test("records the active tab and restores that tab's offset", async () => {
    const memory = probe()
    await tick()
    const saved = panelMemoryOf("ses_scroll")
    saved.scroll.set("browser", 77)

    memory.view[1]("browser")
    await tick()
    assert.equal(saved.view, "browser")
    assert.equal(memory.section.scrollTop, 77)
    memory.dispose()
  })

  test("restores nothing before the root and body are attached", async () => {
    let memory: ReturnType<typeof createScrollMemory> | undefined
    const mounted = mount(() => {
      memory = createScrollMemory({ sessionID: () => "ses_bare", view: () => "overview" })
      return <div />
    })
    assert.ok(memory)
    const controller = memory
    controller.restore()
    controller.restoreKeyed()
    controller.onBodyScroll()
    await tick()
    mounted.dispose()
  })

  test("ignores scroll events before ready, without a key, or from non-elements", async () => {
    const memory = probe()
    memory.section.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(panelMemoryOf("ses_scroll").sections.get("section-a"), undefined)

    await tick()
    memory.container.querySelector("svg")?.dispatchEvent(new Event("scroll", { bubbles: true }))
    memory.container.querySelector(".plain")?.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(panelMemoryOf("ses_scroll").sections.size, 0)
    memory.dispose()
  })

  test("skips saving an unchanged nested offset", async () => {
    const memory = probe()
    await tick()
    Object.defineProperty(memory.body, "clientHeight", { value: 40, configurable: true })
    memory.body.scrollTop = 12
    memory.body.scrollLeft = 3
    memory.body.dispatchEvent(new Event("scroll", { bubbles: true }))
    memory.body.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.deepEqual(panelMemoryOf("ses_scroll").sections.get("section-b"), { top: 12, left: 3 })
    memory.dispose()
  })

  test("evicts the oldest saved section past 256 keys", async () => {
    const memory = probe()
    await tick()
    const saved = panelMemoryOf("ses_scroll")
    Object.defineProperty(memory.body, "clientHeight", { value: 40, configurable: true })
    for (let index = 0; index < 256; index += 1) saved.sections.set(`fill-${index}`, { top: index, left: index })
    memory.body.scrollTop = 12
    memory.body.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(saved.sections.size, 256)
    assert.equal(saved.sections.has("fill-0"), false)
    assert.ok(saved.sections.has("section-b"))
    memory.dispose()
  })

  test("keeps the scrolled key when it is already the oldest", async () => {
    const memory = probe()
    await tick()
    const saved = panelMemoryOf("ses_scroll")
    Object.defineProperty(memory.body, "clientHeight", { value: 40, configurable: true })
    saved.sections.set("section-b", { top: 0, left: 0 })
    for (let index = 0; index < 256; index += 1) saved.sections.set(`fill-${index}`, { top: index, left: index })
    memory.body.scrollTop = 12
    memory.body.dispatchEvent(new Event("scroll", { bubbles: true }))
    assert.equal(saved.sections.size, 257)
    assert.deepEqual(saved.sections.get("section-b"), { top: 12, left: 0 })
    memory.dispose()
  })
})
