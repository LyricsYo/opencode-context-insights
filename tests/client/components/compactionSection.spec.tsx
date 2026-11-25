import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { CompactionRow } from "../../../src/shared/report.ts"
import type { CompactionSectionProps } from "../../../src/client/components/compactionSection.tsx"
import { CompactionSection } from "../../../src/client/components/compactionSection.tsx"
import { makeBrowserPanelProps, makeSessionModel } from "../helpers/browserUi.ts"
import { mount } from "../helpers/mount.tsx"
import { panelNow } from "../helpers/session.ts"

const compaction = (patch: Partial<CompactionRow> = {}): CompactionRow =>
  ({ id: "c1", at: panelNow, reason: "auto", summary: 100, ...patch }) as CompactionRow

function setup(rows: readonly CompactionRow[], onFocus: (row: CompactionRow) => void = () => {}): CompactionSectionProps {
  return makeBrowserPanelProps({
    session: makeSessionModel({ compactions: () => rows }),
    ui: { focusCompaction: onFocus },
  }) as unknown as CompactionSectionProps
}

describe("CompactionSection", () => {
  test("renders the section with the empty hint when nothing compacted", () => {
    const { container, dispose } = mount(() => <CompactionSection {...setup([])} />)

    assert.equal(container.querySelector(".oc-section-title")?.textContent, "Compactions")
    assert.equal(container.querySelector(".oc-hint")?.textContent, "click a row to open it in the browser")
    assert.equal(container.querySelector(".oc-muted")?.textContent, "No compaction yet.")
    assert.equal(container.querySelectorAll(".oc-compaction-row").length, 0)
    dispose()
  })

  test("renders auto and manual rows with totals, reclaimed space and jumps on click", () => {
    const focused: CompactionRow[] = []
    const rows = [
      compaction({ id: "c1", reason: "auto", before: 1500, after: 400, reclaimed: 1100 }),
      compaction({ id: "c2", reason: "manual", reclaimed: -5 }),
      compaction({ id: "c3", reason: "manual", before: 10, reclaimed: 0 }),
      compaction({ id: "c4", reason: "manual", before: 7, after: 3 }),
    ]
    const { container, dispose } = mount(() => <CompactionSection {...setup(rows, (row) => focused.push(row))} />)

    const buttons = [...container.querySelectorAll<HTMLButtonElement>(".oc-compaction-row")]
    assert.equal(buttons.length, 4)
    assert.equal(buttons[0].querySelector(".oc-cell-name")?.textContent, "auto")
    assert.match(buttons[0].querySelector(".oc-cell-tail")?.textContent ?? "", /1\.5k → 400 · -1\.1k/)
    assert.ok(buttons[0].querySelector(".oc-text-good"))
    assert.equal(buttons[1].querySelector(".oc-cell-name")?.textContent, "manual")
    assert.match(buttons[1].querySelector(".oc-cell-tail")?.textContent ?? "", /\? → \? · \+5/)
    assert.equal(buttons[1].querySelector(".oc-text-good"), null)
    assert.match(buttons[2].querySelector(".oc-cell-tail")?.textContent ?? "", /10 → \? · \+0/)
    // Without a reclaimed delta the row shows only the before and after sizes.
    assert.equal(buttons[3].querySelector(".oc-cell-tail")?.textContent?.trim(), "7 → 3")
    assert.equal(buttons[0].getAttribute("title"), "Locate this compaction in the context browser")
    assert.match(buttons[0].querySelector(".oc-compaction-stamp")?.textContent ?? "", /^2026-11-\d{2} \d{2}:\d{2}:\d{2}$/)

    buttons[0].dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.deepEqual(focused, [rows[0]])
    dispose()
  })

  test("renders a zero reclaimed delta and hides positive styling", () => {
    const row = { id: "c4", at: panelNow, reason: "auto", summary: 100, reclaimed: 0 } as CompactionRow
    const { container, dispose } = mount(() => <CompactionSection {...setup([row])} />)

    const tail = container.querySelector(".oc-cell-tail")
    assert.match(tail?.textContent ?? "", /\? → \? · \+0/)
    assert.equal(container.querySelector(".oc-text-good"), null)
    dispose()
  })
})
