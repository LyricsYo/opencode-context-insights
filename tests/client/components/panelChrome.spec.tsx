import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { createSignal } from "solid-js"
import { PanelHeader } from "../../../src/client/components/panelChrome.tsx"
import { makePluginContext, mount } from "../helpers/mount.tsx"
import { settle } from "../helpers/session.ts"

describe("PanelHeader", () => {
  test("shows the title, subtitle and the three tabs with the active one marked", () => {
    const view = createSignal<"overview" | "browser" | "fleet">("overview")
    const { container, dispose } = mount(() => (
      <PanelHeader
        subtitle={() => "ses_1 · build · m"}
        view={view[0]}
        sessionID="ses_1"
        onView={view[1]}
        onRefresh={() => {}}
      />
    ))

    assert.equal(container.querySelector(".oc-title")?.textContent, "Context")
    assert.equal(container.querySelector(".oc-subtitle")?.textContent, "ses_1 · build · m")
    assert.deepEqual(
      [...container.querySelectorAll(".oc-tab")].map((tab) => tab.textContent),
      ["Overview", "Details", "Fleet"],
    )
    assert.equal(container.querySelector(".oc-tab-active")?.textContent, "Overview")
    dispose()
  })

  test("switches the tab and runs refresh", () => {
    const view = createSignal<"overview" | "browser" | "fleet">("overview")
    let refreshed = 0
    const { container, dispose } = mount(() => (
      <PanelHeader
        subtitle={() => ""}
        view={view[0]}
        sessionID="ses_1"
        onView={view[1]}
        onRefresh={() => (refreshed += 1)}
      />
    ))

    container.querySelectorAll(".oc-tab")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.equal(view[0](), "browser")
    container.querySelectorAll(".oc-header-actions button")[0].dispatchEvent(new MouseEvent("click", { bubbles: true }))
    assert.equal(refreshed, 1)
    dispose()
  })

  test("copies the session id and confirms it", async () => {
    const copied: string[] = []
    const toasts: Array<{ title: string; variant: string }> = []
    const ctx = makePluginContext({
      system: { copy: async (value: string) => void copied.push(value), openExternal: () => {} },
      toast: { show: (input: { title: string; variant: string }) => toasts.push(input) },
    })
    const view = createSignal<"overview" | "browser" | "fleet">("browser")
    const { container, dispose } = mount(
      () => (
        <PanelHeader
          subtitle={() => ""}
          view={view[0]}
          sessionID="ses_9"
          onView={view[1]}
          onRefresh={() => {}}
        />
      ),
      ctx,
    )

    const copyButton = [...container.querySelectorAll<HTMLButtonElement>(".oc-header-actions button")][1]
    assert.equal(copyButton.textContent, "Copy session ID")
    copyButton.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await settle()

    assert.deepEqual(copied, ["ses_9"])
    assert.deepEqual(toasts, [{ title: "Session ID copied", variant: "success" }])
    assert.equal(container.querySelector(".oc-tab-active")?.textContent, "Details")
    dispose()
  })

  test("reports a failed copy", async () => {
    const toasts: Array<{ title: string; variant: string }> = []
    const ctx = makePluginContext({
      system: {
        copy: async () => {
          throw new Error("denied")
        },
        openExternal: () => {},
      },
      toast: { show: (input: { title: string; variant: string }) => toasts.push(input) },
    })
    const view = createSignal<"overview" | "browser" | "fleet">("overview")
    const { container, dispose } = mount(
      () => (
        <PanelHeader
          subtitle={() => ""}
          view={view[0]}
          sessionID="ses_9"
          onView={view[1]}
          onRefresh={() => {}}
        />
      ),
      ctx,
    )

    container.querySelectorAll(".oc-header-actions button")[1].dispatchEvent(new MouseEvent("click", { bubbles: true }))
    await settle()
    assert.deepEqual(toasts, [{ title: "Could not copy the session ID", variant: "error" }])
    dispose()
  })
})
