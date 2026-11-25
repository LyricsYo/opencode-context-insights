import { Command, MenuItem, Panel, Plugin, type PanelTab } from "@opencode/plugin/gui"
import { i18n } from "./i18n.ts"
import { ContextView } from "./components/contextView.tsx"

export default Plugin.define({
  i18n,
  setup(ctx) {
    const tab: PanelTab = {
      id: "context",
      get title() {
        return ctx.t("panel.title")
      },
      closable: "compact",
      fallback: true,
      // Keep the panel mounted while a file preview takes the preview slot.
      group: "context",
    }
    const key = `${ctx.id}:${tab.id}`
    type PanelSession = Parameters<typeof ctx.layout.open>[1]

    // `toggle` would reuse the preview slot, so a file preview replaces this panel.
    const toggle = (session: PanelSession) => {
      if (ctx.layout.state(key, session) === "visible") {
        ctx.layout.close(key, session)
        return
      }
      ctx.layout.open(key, session, { tab: "select" })
    }

    ctx.add(Panel, {
      id: tab.id,
      region: "side",
      width: 400,
      mobile: {
        get title() {
          return ctx.t("panel.title")
        },
        order: 45,
        kind: "menu",
        icon: "status",
      },
      list: (input) => (input.open.includes(tab.id) ? [tab] : []),
      render: (props) => <ContextView {...props} />,
    })

    ctx.add(Command, (): Command => ({
      id: "context",
      title: ctx.t("command.title"),
      group: ctx.t("command.group"),
      keywords: "context tokens window composition cache tools compaction",
      section: "session",
      slash: { name: "context" },
      run: () => {
        const session = ctx.sessions.current()
        if (!session) {
          ctx.toast.show({ title: ctx.t("command.title"), description: ctx.t("command.noSession") })
          return
        }
        toggle(session)
      },
    }))

    ctx.add(MenuItem, (): MenuItem => {
      const session = ctx.sessions.current()
      return {
        menu: "session.panel",
        id: "context",
        title: ctx.t("panel.title"),
        description: ctx.t("menu.description"),
        icon: "status",
        opened: !!session && ctx.layout.state(key, session) !== "closed",
        run: () => {
          const current = ctx.sessions.current()
          if (current) toggle(current)
        },
      }
    })
  },
})
