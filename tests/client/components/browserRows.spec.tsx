import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { BrowserRow } from "../../../src/shared/browser.ts"
import { BrowserRowView } from "../../../src/client/components/browserRows.tsx"
import { mount } from "../helpers/mount.tsx"

const row = (patch: Partial<BrowserRow>): BrowserRow =>
  ({
    id: "r1",
    kind: "reply",
    name: "Reply",
    preview: "the answer",
    tokens: 20,
    ...patch,
  }) as BrowserRow

describe("BrowserRowView", () => {
  test("renders a tool schema with its parameters and raw JSON", () => {
    const { container, dispose } = mount(() => (
      <BrowserRowView
        row={row({
          kind: "toolSchema",
          name: "read",
          description: "Read a file",
          source: "core",
          schema: JSON.stringify({ properties: { path: { type: "string" } }, required: ["path"] }),
        })}
        category="tools"
      />
    ))

    assert.equal(container.querySelector(".oc-row-name")?.textContent, "read")
    assert.equal(container.querySelector(".oc-source-chip")?.textContent, "core")
    assert.equal(container.querySelector(".oc-param-name")?.textContent, "path")
    assert.match(container.textContent ?? "", /required/)
    assert.equal(container.querySelector(".oc-entry-tokens")?.textContent, "≈20")
    assert.ok(container.querySelector("pre.oc-pre")?.textContent?.includes('"path"'))
    dispose()
  })

  test("falls back to the empty-parameters hint", () => {
    const { container, dispose } = mount(() => (
      <BrowserRowView row={row({ kind: "toolSchema", schema: "{}" })} category="tools" />
    ))
    assert.match(container.textContent ?? "", /No parameters/)
    dispose()
  })

  test("marks a failed tool result and lists its output", () => {
    const { container, dispose } = mount(() => (
      <BrowserRowView
        row={row({ kind: "toolResult", name: "bash", status: "failed", output: "a\nb", truncated: true })}
        category="toolResults"
      />
    ))

    assert.ok(container.querySelector(".oc-dot-bad"))
    assert.match(container.textContent ?? "", /Error/)
    assert.match(container.textContent ?? "", /truncated/)
    assert.ok(container.querySelector(".oc-pre")?.textContent?.includes("a"))
    dispose()
  })

  test("shows turn and step stamps, or the clock for a header row", () => {
    const step = mount(() => <BrowserRowView row={row({ turn: 2, step: 3 })} category="assistant" />)
    assert.equal(step.container.querySelector(".oc-row-stamp")?.textContent, "T2 S3")
    step.dispose()

    const header = mount(() => (
      <BrowserRowView row={row({ at: Date.UTC(2026, 10, 16, 8, 41) })} category="system" />
    ))
    assert.match(header.container.querySelector(".oc-row-stamp")?.textContent ?? "", /^\d{2}-\d{2} \d{2}:\d{2}$/)
    header.dispose()
  })

  test("uses a placeholder step for a turn without one", () => {
    const { container, dispose } = mount(() => <BrowserRowView row={row({ turn: 4 })} category="assistant" />)
    assert.equal(container.querySelector(".oc-row-stamp")?.textContent, "T4 S?")
    dispose()
  })

  test("labels completed, failed, errored and custom statuses", () => {
    const statuses = ["completed", "failed", "error", "running", undefined].map((status) => {
      const mounted = mount(() => (
        <BrowserRowView row={row({ kind: "toolResult", status, output: "x" })} category="toolResults" />
      ))
      const label = mounted.container.querySelector(".oc-entry-body > .oc-faint")?.textContent
      const bad = mounted.container.querySelector(".oc-text-bad") !== null
      mounted.dispose()
      return { label, bad }
    })

    assert.deepEqual(statuses, [
      { label: "OK", bad: false },
      { label: "Error", bad: true },
      { label: "Error", bad: true },
      { label: "running", bad: false },
      { label: undefined, bad: false },
    ])
  })

  test("lists typed and untyped parameters with optional descriptions", () => {
    const { container, dispose } = mount(() => (
      <BrowserRowView
        row={row({
          kind: "toolSchema",
          name: "grep",
          schema: JSON.stringify({
            properties: {
              pattern: { type: "string", description: "regex to find" },
              plain: {},
            },
            required: ["pattern"],
          }),
        })}
        category="tools"
      />
    ))

    const rows = [...container.querySelectorAll(".oc-param-row")]
    assert.equal(rows.length, 2)
    assert.match(rows[0].textContent ?? "", /patternstring · required/)
    assert.equal(rows[0].querySelector(".oc-param-desc")?.textContent, "regex to find")
    assert.match(rows[1].textContent ?? "", /plainany/)
    assert.doesNotMatch(rows[1].textContent ?? "", /required/)
    assert.equal(rows[1].querySelector(".oc-param-desc"), null)
    dispose()
  })

  test("renders a text body and the call arguments", () => {
    const { container, dispose } = mount(() => (
      <BrowserRowView
        row={row({ kind: "toolCall", name: "read", text: "plain text", input: '{"path":"a"}' })}
        category="toolCalls"
      />
    ))

    assert.equal(container.querySelector(".oc-field-label-row")?.textContent, "ContentRawMarkdown")
    assert.equal(container.querySelector("pre.oc-pre")?.textContent, "plain text")
    const args = [...container.querySelectorAll("pre.oc-pre")].at(-1)
    assert.equal(args?.textContent, '{"path":"a"}')
    assert.equal(args?.getAttribute("data-scroll-key"), "browser:r1:input")
    dispose()
  })

  test("counts the output lines and shows partial-result attachments", () => {
    const { container, dispose } = mount(() => (
      <BrowserRowView
        row={row({
          kind: "toolResult",
          name: "bash",
          output: "a\nb\nc",
          files: [{ name: "shot.png", mime: "image/png", data: "aGk=", uri: "file:///shot.png" }],
        })}
        category="toolResults"
      />
    ))

    assert.equal(container.querySelector(".oc-field-label-row .oc-faint")?.textContent, "3 lines")
    assert.match(container.querySelector(".oc-field-label")?.textContent ?? "", /Result/)
    assert.equal(container.querySelectorAll(".oc-attach-card").length, 1)
    dispose()
  })

  test("skips the attachment row for an empty file list", () => {
    const { container, dispose } = mount(() => (
      <BrowserRowView row={row({ kind: "toolResult", output: "x", files: [] })} category="toolResults" />
    ))
    assert.equal(container.querySelectorAll(".oc-attach-card").length, 0)
    dispose()
  })

  test("treats an empty output as zero lines and omits empty text bodies", () => {
    const { container, dispose } = mount(() => (
      <BrowserRowView row={row({ kind: "toolResult", name: "bash", output: "" })} category="toolResults" />
    ))
    assert.equal(container.querySelector(".oc-field-label-row .oc-faint")?.textContent, "0 lines")
    assert.equal(container.querySelectorAll(".oc-field-label-row").length, 1)
    dispose()
  })

  test("opens, focuses and colour-codes a row that asks for its category dot", () => {
    const { container, dispose } = mount(() => (
      <BrowserRowView row={row({})} category="user" showCategory focused />
    ))

    const entry = container.querySelector<HTMLDetailsElement>(".oc-entry")!
    assert.equal(entry.open, true)
    assert.ok(entry.classList.contains("oc-entry-focus"))
    const dot = entry.querySelector<HTMLElement>(".oc-dot")!
    assert.equal(dot.style.backgroundColor, "rgb(224, 123, 57)")
    dispose()
  })
})
