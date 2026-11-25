import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { TrendBriefChip, TrendBriefRow } from "../../../src/client/components/trendBrief.tsx"
import { briefEntry } from "../helpers/trendUi.ts"
import { mount } from "../helpers/mount.tsx"

describe("TrendBriefRow", () => {
  test("renders its label and body", () => {
    const { container, dispose } = mount(() => (
      <TrendBriefRow label="Inputs">
        <span class="body">two files</span>
      </TrendBriefRow>
    ))

    assert.equal(container.querySelector(".oc-brief-row .oc-brief-label")?.textContent, "Inputs")
    assert.equal(container.querySelector(".oc-brief-body .body")?.textContent, "two files")
    dispose()
  })
})

describe("TrendBriefChip", () => {
  test("renders the entry name and preview", () => {
    const { container, dispose } = mount(() => (
      <TrendBriefChip entry={briefEntry({ name: "src/app.tsx", preview: "export const app = 1" })} onClick={() => {}} />
    ))

    const chip = container.querySelector<HTMLButtonElement>(".oc-brief-chip")
    assert.equal(chip?.tagName, "BUTTON")
    assert.equal(chip?.title, "export const app = 1")
    assert.equal(chip?.querySelector(".oc-brief-tag")?.textContent, "src/app.tsx")
    assert.equal(chip?.querySelector(".oc-brief-text")?.textContent, "export const app = 1")
    dispose()
  })

  test("reports a click", () => {
    let clicks = 0
    const { container, dispose } = mount(() => (
      <TrendBriefChip entry={briefEntry()} onClick={() => (clicks += 1)} />
    ))

    container.querySelector(".oc-brief-chip")!.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.equal(clicks, 1)
    dispose()
  })
})
