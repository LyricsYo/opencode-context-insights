import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { FleetCard } from "../../../src/client/components/agentCard.tsx"
import type { Category } from "../../../src/shared/estimate.ts"
import { fleetDetail, fleetHead, fleetNode } from "../helpers/fleetUi.ts"
import { mount } from "../helpers/mount.tsx"

const compositionOf = (total: number, entries: Partial<Record<Category, number>>) => ({
  total,
  byCategory: {
    system: 0,
    tools: 0,
    user: 0,
    injected: 0,
    skills: 0,
    assistant: 0,
    reasoning: 0,
    toolCalls: 0,
    toolResults: 0,
    ...entries,
  },
  items: [],
  prompt: 0,
  headerPending: false,
  headerMissing: false,
})

const defaultPoint = { id: "ses_a", x: 100, y: 20, depth: 0 }

describe("FleetCard", () => {
  test("renders composition mix, context usage, cost, duration and the current badge", () => {
    const node = fleetNode({
      id: "ses_a",
      title: "Scan repo",
      agent: "build",
      model: "gpt",
      prompt: 600,
      output: 400,
      duration: 90_000,
      isCurrent: true,
    })
    const detail = {
      ...fleetDetail([], {
        steps: 4,
        cost: 0.1234,
        composition: compositionOf(1000, { system: 300, tools: 200, user: 500 }),
      }),
    }
    const hovered: Array<string | null> = []
    const picked: string[] = []
    const { container, dispose } = mount(() => (
      <FleetCard
        node={node}
        point={defaultPoint}
        width={200}
        hue="#5b8def"
        active
        activeMs={90_000}
        lit
        detail={detail}
        limit={2000}
        pinned
        onHover={(id) => hovered.push(id)}
        onPick={(id) => picked.push(id)}
      />
    ))
    const card = container.querySelector<HTMLButtonElement>(".oc-fleet-card")!
    assert.ok(card.classList.contains("oc-fleet-card-active"))
    assert.equal(card.getAttribute("aria-pressed"), "true")
    assert.equal(card.style.opacity, "1")
    assert.equal(card.style.borderColor, "rgb(91, 141, 239)")
    assert.equal(card.querySelector(".oc-fleet-badge")?.textContent, "self")
    assert.match(card.querySelector(".oc-fleet-card-duty")?.textContent ?? "", /^build · gpt$/)
    assert.match(card.querySelector(".oc-fleet-card-metric")?.textContent ?? "", /\$0\.123/)
    const bars = [...card.querySelectorAll<HTMLElement>(".oc-fleet-bar i")]
    assert.equal(bars.length, 3)
    assert.equal(bars[0].style.width, "15%")
    assert.equal(bars[2].style.width, "25%")
    assert.ok(card.querySelector(".oc-fleet-card-meta")?.textContent?.includes("50%"))
    assert.ok(card.querySelector(".oc-fleet-card-meta")?.textContent?.includes("1m30s"))

    card.dispatchEvent(new MouseEvent("mouseenter"))
    card.dispatchEvent(new MouseEvent("focus"))
    card.dispatchEvent(new MouseEvent("mouseleave"))
    card.dispatchEvent(new MouseEvent("blur"))
    card.click()
    assert.deepEqual(hovered, ["ses_a", "ses_a", null, null])
    assert.deepEqual(picked, ["ses_a"])
    dispose()
  })

  test("falls back to prompt and reply tokens and dims an unrelated card", () => {
    const node = fleetNode({ id: "ses_b", title: "Second", prompt: 75, output: 25, cost: 0.2 })
    const { container, dispose } = mount(() => (
      <FleetCard
        node={node}
        point={{ ...defaultPoint, id: "ses_b", x: 200 }}
        width={160}
        hue="#22a06b"
        active={false}
        lit={false}
        detail={undefined}
        pinned={false}
        onHover={() => {}}
        onPick={() => {}}
      />
    ))
    const card = container.querySelector<HTMLButtonElement>(".oc-fleet-card")!
    assert.equal(card.style.opacity, "0.34")
    assert.equal(card.style.borderColor, "")
    assert.equal(card.getAttribute("aria-pressed"), "false")
    assert.equal(card.querySelector(".oc-fleet-badge"), null)
    const bars = [...card.querySelectorAll<HTMLElement>(".oc-fleet-bar i")]
    assert.equal(bars.length, 2)
    assert.equal(bars[0].style.width, "75%")
    assert.equal(bars[1].style.width, "25%")
    assert.equal(card.querySelectorAll(".oc-fleet-card-meta span").length, 0)
    dispose()
  })

  test("renders a plain card with no tokens, steps or usage", () => {
    const node = fleetNode({ id: "ses_c", prompt: 0, output: 0, cost: 0, title: "Bare" })
    const picked: string[] = []
    const { container, dispose } = mount(() => (
      <FleetCard
        node={node}
        point={defaultPoint}
        width={160}
        hue="#5b8def"
        active={false}
        detail={fleetHead({ steps: 0 })}
        pinned={false}
        onHover={() => {}}
        onPick={(id) => picked.push(id)}
      />
    ))
    const card = container.querySelector<HTMLButtonElement>(".oc-fleet-card")!
    assert.equal(card.querySelectorAll(".oc-fleet-bar i").length, 0)
    assert.equal(card.querySelectorAll(".oc-fleet-card-meta span").length, 0)
    assert.match(card.querySelector(".oc-fleet-card-duty")?.textContent ?? "", /^agent$/)
    card.click()
    assert.deepEqual(picked, ["ses_c"])
    dispose()
  })

  test("hides the usage chip when the limit is unusable", () => {
    const node = fleetNode({ id: "ses_d", prompt: 50, output: 10 })
    const detail = fleetHead({ composition: compositionOf(300, { tools: 300 }) })
    const render = (limit: number) => {
      const { container, dispose } = mount(() => (
        <FleetCard
          node={node}
          point={defaultPoint}
          width={160}
          hue="#5b8def"
          active={false}
          detail={detail}
          limit={limit}
          pinned={false}
          onHover={() => {}}
          onPick={() => {}}
        />
      ))
      assert.equal(container.querySelector(".oc-fleet-card-meta")?.textContent?.includes("%"), false)
      dispose()
    }
    render(0)
  })

  test("clamps usage above the context limit to 100 percent", () => {
    const node = fleetNode({ id: "ses_e", prompt: 10, output: 5 })
    const detail = fleetHead({ composition: compositionOf(300, { system: 300 }) })
    const { container, dispose } = mount(() => (
      <FleetCard
        node={node}
        point={defaultPoint}
        width={160}
        hue="#5b8def"
        active={false}
        detail={detail}
        limit={100}
        pinned={false}
        onHover={() => {}}
        onPick={() => {}}
      />
    ))
    const card = container.querySelector<HTMLButtonElement>(".oc-fleet-card")!
    assert.ok(card.querySelector(".oc-fleet-card-meta")?.textContent?.includes("300%"))
    assert.equal(card.querySelector<HTMLElement>(".oc-fleet-bar i")?.style.width, "100%")
    dispose()
  })

  test("uses the prompt and reply fallback when the composition is empty", () => {
    const node = fleetNode({ id: "ses_f", prompt: 30, output: 10 })
    const detail = fleetHead({ composition: compositionOf(0, {}) })
    const { container, dispose } = mount(() => (
      <FleetCard
        node={node}
        point={defaultPoint}
        width={160}
        hue="#5b8def"
        active={false}
        detail={detail}
        limit={0}
        pinned={false}
        onHover={() => {}}
        onPick={() => {}}
      />
    ))
    const card = container.querySelector<HTMLButtonElement>(".oc-fleet-card")!
    const bars = [...card.querySelectorAll<HTMLElement>(".oc-fleet-bar i")]
    assert.equal(bars.length, 2)
    assert.equal(bars[0].style.width, "75%")
    assert.equal(card.querySelectorAll(".oc-fleet-card-meta span").length, 0)
    dispose()
  })
})
