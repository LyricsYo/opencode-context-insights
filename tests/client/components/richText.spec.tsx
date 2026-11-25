import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { bytesLabel, extensionOf, RichTextBlock, schemaParams } from "../../../src/client/components/richText.tsx"
import { mount } from "../helpers/mount.tsx"

function click(container: HTMLElement, label: string): void {
  const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label)
  assert.ok(button, `button ${label}`)
  button.dispatchEvent(new MouseEvent("click", { bubbles: true }))
}

describe("RichTextBlock", () => {
  test("starts raw and switches to Markdown", () => {
    const { container, dispose } = mount(() => <RichTextBlock text="hello **world**" label="Reply" />)

    assert.equal(container.querySelector(".oc-field-label")?.textContent, "Reply")
    assert.equal(container.querySelector(".oc-pre")?.textContent, "hello **world**")
    assert.deepEqual(
      [...container.querySelectorAll("button")].map((button) => button.textContent),
      ["Raw", "Markdown"],
    )

    click(container, "Markdown")
    assert.equal(container.querySelector(".md-body")?.textContent, "hello **world**")
    assert.equal(container.querySelector(".oc-pre"), null)
    dispose()
  })

  test("offers JSON only for parseable payloads and renders it as code", () => {
    const { container, dispose } = mount(() => <RichTextBlock text='{"a":1}' />)
    assert.deepEqual(
      [...container.querySelectorAll("button")].map((button) => button.textContent),
      ["Raw", "Markdown", "JSON"],
    )

    click(container, "JSON")
    assert.equal(container.querySelector(".code-body")?.textContent, '{"a":1}')
    assert.equal(container.querySelector(".code-body")?.getAttribute("class"), "code-body")
    dispose()
  })

  test("keeps the scroll key per mode", () => {
    const { container, dispose } = mount(() => <RichTextBlock text="text" scrollKey="browser:a1:text" />)
    assert.equal(container.querySelector(".oc-pre")?.getAttribute("data-scroll-key"), "browser:a1:text:raw")
    click(container, "Markdown")
    assert.equal(container.querySelector(".oc-md")?.getAttribute("data-scroll-key"), "browser:a1:text:md")
    dispose()
  })

  test("hides the JSON view for text that only looks like JSON", () => {
    const { container, dispose } = mount(() => <RichTextBlock text="{not json" />)
    assert.deepEqual(
      [...container.querySelectorAll("button")].map((button) => button.textContent),
      ["Raw", "Markdown"],
    )
    assert.equal(container.querySelector(".oc-pre")?.textContent, "{not json")
    dispose()
  })

  test("offers JSON for a top-level array", () => {
    const { container, dispose } = mount(() => <RichTextBlock text="[1,2]" />)
    assert.deepEqual(
      [...container.querySelectorAll("button")].map((button) => button.textContent),
      ["Raw", "Markdown", "JSON"],
    )
    dispose()
  })

  test("shows the meta hint when one is passed", () => {
    const { container, dispose } = mount(() => <RichTextBlock text="body" label="Result" meta="3 lines" />)
    assert.equal(container.querySelector(".oc-field-label")?.textContent, "Result")
    assert.equal(container.querySelector(".oc-faint")?.textContent, "3 lines")
    dispose()
  })
})

describe("bytesLabel", () => {
  test("splits at the binary thresholds", () => {
    assert.equal(bytesLabel(undefined), undefined)
    assert.equal(bytesLabel(512), "512 B")
    assert.equal(bytesLabel(2048), "2 KB")
    assert.equal(bytesLabel(3.5 * 1024 * 1024), "3.5 MB")
  })
})

describe("extensionOf", () => {
  test("keeps short extensions and falls back to file", () => {
    assert.equal(extensionOf("shot.png"), "png")
    assert.equal(extensionOf("archive.tar.gz"), "gz")
    assert.equal(extensionOf("README"), "file")
    assert.equal(extensionOf("weird.longextension"), "file")
  })
})

describe("schemaParams", () => {
  test("lists properties with type, required flag and description", () => {
    const params = schemaParams(
      JSON.stringify({
        properties: {
          path: { type: "string", description: "file to read" },
          limit: { type: "number" },
        },
        required: ["path"],
      }),
    )
    assert.deepEqual(params, [
      { name: "path", type: "string", required: true, description: "file to read" },
      { name: "limit", type: "number", required: false, description: undefined },
    ])
  })

  test("returns nothing for missing, malformed or property-less schemas", () => {
    assert.deepEqual(schemaParams(undefined), [])
    assert.deepEqual(schemaParams("not json"), [])
    assert.deepEqual(schemaParams('{"required":["x"]}'), [])
  })

  test("treats non-object properties, missing arrays and untyped entries as defaults", () => {
    assert.deepEqual(schemaParams('{"properties":{"a":null,"b":5,"c":{"description":"d"}},"required":"a"}'), [
      { name: "a", type: "any", required: false, description: undefined },
      { name: "b", type: "any", required: false, description: undefined },
      { name: "c", type: "any", required: false, description: "d" },
    ])
  })
})
