import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { Dot, Section, Stat } from "../../../src/client/components/section.tsx"
import { mount } from "../helpers/mount.tsx"

describe("Section", () => {
  test("renders the title, hint and header actions", () => {
    const { container, dispose } = mount(() => (
      <Section title="Context Stats" hint="session totals" headerActions={<span class="actions">A</span>}>
        <p class="body">body</p>
      </Section>
    ))

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "Context Stats")
    assert.equal(container.querySelector(".oc-hint")?.textContent, "session totals")
    assert.equal(container.querySelector(".actions")?.textContent, "A")
    assert.equal(container.querySelector(".body")?.textContent, "body")
    assert.equal(container.querySelector(".oc-section-scroll"), null)
    dispose()
  })

  test("wraps scrollable content with its key and forwards scroll events", () => {
    let scrolled = 0
    const { container, dispose } = mount(() => (
      <Section title="Files" scroll scrollKey="files" onScroll={() => (scrolled += 1)}>
        <p>rows</p>
      </Section>
    ))

    const scroll = container.querySelector(".oc-section-scroll")!
    assert.equal(scroll.getAttribute("data-scroll-key"), "files")
    scroll.dispatchEvent(new Event("scroll", { bubbles: false }))
    assert.equal(scrolled, 1)
    dispose()
  })
})

describe("Stat", () => {
  test("renders the label, value, hint and optional colour dot", () => {
    const { container, dispose } = mount(() => (
      <Stat label="Turns" value="23" hint="this session" color="#5b8def" />
    ))

    assert.equal(container.querySelector(".oc-stat-value")?.textContent, "23")
    assert.match(container.textContent ?? "", /Turns/)
    assert.match(container.textContent ?? "", /this session/)
    assert.equal(container.querySelector<HTMLElement>(".oc-dot")?.style.backgroundColor, "rgb(91, 141, 239)")
    dispose()
  })

  test("omits the dot without a colour", () => {
    const { container, dispose } = mount(() => <Stat label="Steps" value="4" />)
    assert.equal(container.querySelector(".oc-dot"), null)
    dispose()
  })
})

describe("Dot", () => {
  test("uses the colour as its background", () => {
    const { container, dispose } = mount(() => <Dot color="red" />)
    assert.equal(container.querySelector<HTMLElement>(".oc-dot")?.style.backgroundColor, "red")
    dispose()
  })
})
