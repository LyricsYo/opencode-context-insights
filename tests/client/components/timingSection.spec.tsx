import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { TimingCategorySlice, TimingSectionProps } from "../../../src/client/components/timingSection.tsx"
import { TimingSection } from "../../../src/client/components/timingSection.tsx"
import type { TimingStats, ToolRow } from "../../../src/shared/report.ts"
import { mount } from "../helpers/mount.tsx"

function stats(patch: Partial<TimingStats> = {}): TimingStats {
  return {
    gen: 3000,
    reasoning: 800,
    text: 1600,
    toolArgs: 600,
    split: true,
    genLeftover: 0,
    reasoningBlocks: 1,
    textBlocks: 2,
    toolArgBlocks: 1,
    tool: 1000,
    toolCalls: 3,
    question: 0,
    delegation: 0,
    overhead: 1000,
    wall: 5000,
    ttftSteps: 3,
    steps: 4,
    output: 200,
    decoded: 200,
    rate: 100,
    ...patch,
  }
}

function category(patch: Partial<TimingCategorySlice> = {}): TimingCategorySlice {
  return { key: "gen", label: "LLM Gen", ms: 3000, color: "#111111", ...patch }
}

function tool(patch: Partial<ToolRow> = {}): ToolRow {
  return { name: "bash", calls: 2, failed: 0, unfinished: 0, p50: 700, total: 1500, ...patch }
}

function setup(props: Partial<TimingSectionProps> = {}) {
  const full: TimingSectionProps = {
    timing: () => stats(),
    activeTiming: () => 4000,
    categories: () => [],
    share: (value) => `${value}ms`,
    sessionSpan: () => 0,
    topTools: () => [],
    ...props,
  }
  const mounted = mount(() => <TimingSection {...full} />)
  return mounted
}

describe("TimingSection", () => {
  test("renders active time, speed, TTFT coverage, distribution and tools", () => {
    const categories = [
      category({ key: "gen", label: "LLM Gen", ms: 3000, color: "#111111", count: "4 calls" }),
      category({ key: "tools", label: "Tool runs", ms: 1000, color: "#222222" }),
    ]
    const tools = [
      tool({ name: "bash", calls: 2, failed: 1, p50: 700, total: 1500 }),
      tool({ name: "read", calls: 1, failed: 0, unfinished: 1, p50: undefined, total: 400 }),
    ]
    const view = setup({
      timing: () => stats({ question: 500, delegation: 500, ttftAvg: 250, wall: 6000, rate: 80, output: 240, decoded: 240 }),
      activeTiming: () => 5000,
      categories: () => categories,
      share: (value) => `${Math.round((value / 6000) * 100)}%`,
      sessionSpan: () => 9000,
      topTools: () => tools,
    })
    const { container, dispose } = view

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "Timing Stats")
    assert.equal(container.querySelector(".oc-hero-block")?.textContent, "Active time5.0sexcludes 500ms user waitexcludes 500ms subagent wait")
    assert.equal(container.querySelectorAll(".oc-hero-value")[1]?.textContent, "80 tok/s")
    assert.match(container.textContent ?? "", /240 output/)
    assert.equal(container.querySelectorAll(".oc-hero-value")[2]?.textContent, "250ms")
    assert.match(container.textContent ?? "", /3\/4 steps/)

    const segments = [...container.querySelectorAll<HTMLElement>(".oc-segments > div")]
    assert.equal(segments.length, 2)
    assert.equal(segments[0].title, "LLM Gen 3.0s")
    assert.equal(segments[0].style.width, "50%")
    assert.equal(segments[1].style.backgroundColor, "rgb(34, 34, 34)")

    const statNodes = [...container.querySelectorAll(".oc-stat")]
    assert.equal(statNodes.length, 2)
    assert.match(statNodes[0].textContent ?? "", /LLM Gen3\.0s50% · 4 calls/)
    assert.match(statNodes[1].textContent ?? "", /Tool runs1\.0s17%/)
    assert.doesNotMatch(statNodes[1].textContent ?? "", /·/)

    assert.match(container.textContent ?? "", /Session span 9\.0s includes time between turns/)

    const rows = [...container.querySelectorAll(".oc-table-row")]
    assert.equal(rows.length, 2)
    assert.match(rows[0].textContent ?? "", /bash2× · 1\.5s · p50 700ms · 1 failed/)
    assert.match(rows[1].textContent ?? "", /read1× · 400ms · p50 —/)
    assert.doesNotMatch(rows[1].textContent ?? "", /failed/)
    dispose()
  })

  test("treats a null TTFT average like a missing one", () => {
    const broken = { ...stats({ ttftSteps: 1 }), ttftAvg: null } as unknown as TimingStats
    const { container, dispose } = setup({ timing: () => broken })

    assert.equal(container.querySelectorAll(".oc-hero-value")[2]?.textContent, "0ms")
    dispose()
  })

  test("falls back to dashes and empty hints", () => {
    const view = setup({
      timing: () => stats({ question: 0, ttftAvg: undefined, steps: 0, ttftSteps: 0, wall: 0, rate: 0, output: 0 }),
      activeTiming: () => 0,
      sessionSpan: () => 0,
    })
    const { container, dispose } = view

    assert.equal(container.querySelectorAll(".oc-hero-value")[0]?.textContent, "0ms")
    assert.equal(container.querySelectorAll(".oc-hero-value")[1]?.textContent, "0 tok/s")
    assert.equal(container.querySelectorAll(".oc-hero-value")[2]?.textContent, "—")
    assert.match(container.textContent ?? "", /0\/0 steps/)
    assert.equal(container.querySelector(".oc-hero-block")?.textContent, "Active time0ms")
    assert.equal(container.querySelectorAll(".oc-segments > div").length, 0)
    assert.equal(container.querySelectorAll(".oc-stat").length, 0)
    assert.match(container.textContent ?? "", /No tool timings\./)
    assert.match(container.textContent ?? "", /Session span — includes time between turns/)
    dispose()
  })
})
