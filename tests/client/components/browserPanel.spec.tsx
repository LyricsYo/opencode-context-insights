import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { BrowserPanel } from "../../../src/client/components/browserPanel.tsx"
import { makeBrowserPanelProps } from "../helpers/browserUi.ts"
import { mount } from "../helpers/mount.tsx"

describe("BrowserPanel", () => {
  test("composes every details section in reading order", () => {
    const props = makeBrowserPanelProps()
    const { container, dispose } = mount(() => <BrowserPanel {...props} />)

    const titles = [...container.querySelectorAll(".oc-section-title")].map((node) => node.textContent)
    assert.deepEqual(titles, [
      "Trend",
      "Timing trend",
      "Context browser",
      "Context events",
      "Compactions",
      "File activity",
      "Commands",
    ])
    dispose()
  })

  test("renders the empty state of every section with no session data", () => {
    const props = makeBrowserPanelProps()
    const { container, dispose } = mount(() => <BrowserPanel {...props} />)

    const text = container.textContent ?? ""
    assert.match(text, /No snapshot for this step/)
    assert.match(text, /No context events yet/)
    assert.match(text, /No compaction yet/)
    assert.match(text, /No file operations\./)
    assert.match(text, /No commands executed in this session/)
    dispose()
  })
})
