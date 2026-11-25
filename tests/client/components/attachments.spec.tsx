import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { AttachmentCards } from "../../../src/client/components/attachments.tsx"
import { makePluginContext, mount } from "../helpers/mount.tsx"

const image = {
  name: "shot.png",
  mime: "image/png",
  data: "aGk=",
  uri: "file:///shot.png",
  description: "screenshot",
}

const pdf = {
  name: "report.pdf",
  mime: "application/pdf",
  uri: "file:///report.pdf",
}

describe("AttachmentCards", () => {
  test("renders the count label and one card per file", () => {
    const { container, dispose } = mount(() => <AttachmentCards files={[image, pdf]} />)
    assert.equal(container.querySelector(".oc-field-label")?.textContent, "2 attachments")
    assert.equal(container.querySelectorAll(".oc-attach-card").length, 2)
    assert.equal(container.querySelector(".oc-attach-img")?.getAttribute("src"), "data:image/png;base64,aGk=")
    assert.equal(container.querySelector(".oc-attach-glyph")?.textContent, "pdf")
    assert.match(container.textContent ?? "", /image\/png · 3 B/)
    dispose()
  })

  test("opens the link before falling back to the system opener", () => {
    let external = 0
    const opened: string[] = []
    const ctx = makePluginContext({
      links: {
        open: (input: { href: string }) => {
          opened.push(input.href)
          return true
        },
        exists: async () => true,
      },
      system: { copy: async () => {}, openExternal: () => (external += 1) },
    })
    const { container, dispose } = mount(() => <AttachmentCards files={[pdf]} />, ctx)

    container.querySelector<HTMLButtonElement>(".oc-attach-card")!.click()
    assert.deepEqual(opened, ["file:///report.pdf"])
    assert.equal(external, 0)
    dispose()
  })

  test("falls back to the system opener when the host cannot open the link", () => {
    let external: string | undefined
    const ctx = makePluginContext({
      links: {
        open: () => {
          throw new Error("gone")
        },
        exists: async () => false,
      },
      system: { copy: async () => {}, openExternal: (uri: string) => (external = uri) },
    })
    const { container, dispose } = mount(() => <AttachmentCards files={[pdf]} />, ctx)

    container.querySelector<HTMLButtonElement>(".oc-attach-card")!.click()
    assert.equal(external, "file:///report.pdf")
    dispose()
  })

  test("does not offer to open files without a uri", () => {
    const { container, dispose } = mount(() => <AttachmentCards files={[{ name: "note.txt", mime: "text/plain" }]} />)
    const card = container.querySelector(".oc-attach-card")!
    assert.equal(card.getAttribute("aria-disabled"), "true")
    assert.equal(card.getAttribute("style"), "cursor: default;")
    card.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    dispose()
  })

  test("treats an inline data uri as not openable", () => {
    const { container, dispose } = mount(() => (
      <AttachmentCards files={[{ name: "inline.png", mime: "image/png", data: "aGk=", uri: "data:image/png;base64,aGk=" }]} />
    ))
    const card = container.querySelector(".oc-attach-card")!
    assert.equal(card.getAttribute("aria-disabled"), "true")
    assert.equal(card.classList.contains("oc-ctx-hover"), false)
    dispose()
  })

  test("reports the decoded size and the intrinsic image dimensions", () => {
    const { container, dispose } = mount(() => <AttachmentCards files={[image]} />)
    const img = container.querySelector("img.oc-attach-img")!
    assert.match(container.querySelector(".oc-attach-meta")?.textContent ?? "", /image\/png · 3 B/)

    Object.defineProperty(img, "naturalWidth", { value: 640, configurable: true })
    Object.defineProperty(img, "naturalHeight", { value: 480, configurable: true })
    img.dispatchEvent(new Event("load"))
    assert.match(container.querySelector(".oc-attach-meta")?.textContent ?? "", /· 640×480/)
    dispose()
  })

  test("falls back to the system opener when the host cannot take the link", () => {
    let external: string | undefined
    const ctx = makePluginContext({
      links: {
        open: () => false,
        exists: async () => true,
      },
      system: { copy: async () => {}, openExternal: (uri: string) => (external = uri) },
    })
    const { container, dispose } = mount(() => <AttachmentCards files={[pdf]} />, ctx)

    container.querySelector<HTMLButtonElement>(".oc-attach-card")!.click()
    assert.equal(external, "file:///report.pdf")
    dispose()
  })
})
