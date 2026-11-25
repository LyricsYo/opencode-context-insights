import assert from "node:assert/strict"
import { beforeEach, describe, test } from "vitest"
import { Command, MenuItem, Panel } from "@opencode/plugin/gui"
import plugin from "../../src/client/index.tsx"
import { makeTranslate, mount } from "./helpers/mount.tsx"
import { makeSessionProps } from "./helpers/session.ts"

interface PanelEntry {
  id: string
  region: string
  width: number
  mobile: { readonly title: string; order: number; kind: string; icon: string }
  list: (input: { open: string[] }) => Array<{
    id: string
    readonly title: string
    closable: string
    fallback: boolean
    group: string
  }>
  render: (props: never) => unknown
}

interface CommandEntry {
  id: string
  title: string
  group: string
  keywords: string
  section: string
  slash: { name: string }
  run: () => void
}

interface MenuEntry {
  menu: string
  id: string
  title: string
  description: string
  icon: string
  opened: boolean
  run: () => void
}

const added: Array<{ registry: unknown; item: unknown }> = []
const toasts: unknown[] = []
const opens: Array<{ key: string; session: unknown; tab: string }> = []
const closes: Array<{ key: string; session: unknown }> = []
let current: unknown
let layoutState = "closed"

const ctx = {
  id: "opencode-context-insights",
  t: makeTranslate(),
  add: (registry: unknown, item: unknown) => {
    added.push({ registry, item })
    return () => {}
  },
  sessions: { current: () => current },
  layout: {
    open: (key: string, session: unknown, options: { tab: string }) => opens.push({ key, session, tab: options.tab }),
    close: (key: string, session: unknown) => closes.push({ key, session }),
    state: () => layoutState,
  },
  toast: {
    show: (value: unknown) => {
      toasts.push(value)
    },
  },
} as never

const resolve = <T,>(registry: unknown): T => {
  const entry = added.find((item) => item.registry === registry)
  assert.ok(entry, "missing registration")
  return (typeof entry.item === "function" ? entry.item() : entry.item) as T
}

describe("client plugin", () => {
  beforeEach(() => {
    added.length = 0
    toasts.length = 0
    opens.length = 0
    closes.length = 0
    current = undefined
    layoutState = "closed"
    ;(plugin as unknown as { setup: (value: never) => void }).setup(ctx)
  })

  test("registers the panel tab and renders the context view", () => {
    assert.deepEqual(
      added.map((entry) => entry.registry),
      [Panel, Command, MenuItem],
    )
    const panel = resolve<PanelEntry>(Panel)
    assert.equal(panel.id, "context")
    assert.equal(panel.region, "side")
    assert.equal(panel.width, 400)
    assert.equal(panel.mobile.title, "Context")
    assert.equal(panel.mobile.order, 45)
    assert.equal(panel.mobile.kind, "menu")
    assert.equal(panel.mobile.icon, "status")

    const tabs = panel.list({ open: ["context"] })
    assert.equal(tabs.length, 1)
    assert.equal(tabs[0]?.id, "context")
    assert.equal(tabs[0]?.title, "Context")
    assert.equal(tabs[0]?.closable, "compact")
    assert.equal(tabs[0]?.fallback, true)
    assert.equal(tabs[0]?.group, "context")
    assert.deepEqual(panel.list({ open: ["other"] }), [])

    const view = mount(() => panel.render(makeSessionProps() as never) as never)
    assert.ok(view.container.querySelector(".opencode-context-panel.oc-root"))
    view.dispose()
  })

  test("runs the command with and without a mounted session", () => {
    const command = resolve<CommandEntry>(Command)
    assert.equal(command.id, "context")
    assert.equal(command.title, "Open context insights")
    assert.equal(command.section, "session")
    assert.equal(command.slash.name, "context")

    command.run()
    assert.equal(opens.length, 0)
    assert.equal(closes.length, 0)
    assert.equal(toasts.length, 1)

    const session = { id: "ses_test" }
    current = session
    command.run()
    assert.deepEqual(opens, [{ key: "opencode-context-insights:context", session, tab: "select" }])
  })

  test("opens and runs the menu item for the current session", () => {
    let menu = resolve<MenuEntry>(MenuItem)
    assert.equal(menu.menu, "session.panel")
    assert.equal(menu.id, "context")
    assert.equal(menu.opened, false)
    menu.run()
    assert.equal(opens.length, 0)

    const session = { id: "ses_test" }
    current = session
    menu = resolve<MenuEntry>(MenuItem)
    assert.equal(menu.opened, false)

    layoutState = "open"
    menu = resolve<MenuEntry>(MenuItem)
    assert.equal(menu.opened, true)
    menu.run()
    assert.deepEqual(opens, [{ key: "opencode-context-insights:context", session, tab: "select" }])
    assert.equal(closes.length, 0)

    layoutState = "visible"
    menu = resolve<MenuEntry>(MenuItem)
    assert.equal(menu.opened, true)
    menu.run()
    assert.deepEqual(closes, [{ key: "opencode-context-insights:context", session }])
    assert.equal(opens.length, 1)
  })
})
