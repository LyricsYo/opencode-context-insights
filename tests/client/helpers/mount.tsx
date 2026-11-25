import type { JSX } from "solid-js"
import { createComponent } from "solid-js"
import { render } from "solid-js/web"
import { PluginContext } from "../../../node_modules/@opencode/plugin/dist/gui/internal.js"
import { i18n } from "../../../src/client/i18n.ts"

export type Translate = (key: string, params?: Record<string, string | number>) => string

export function makeTranslate(active: "en" | "zh" = "en"): Translate {
  const dict: Record<string, string> = i18n[active]
  const fallback: Record<string, string> = i18n.en
  return (key, params) => {
    let text = dict[key] ?? fallback[key] ?? key
    if (params) for (const [name, value] of Object.entries(params)) text = text.replaceAll(`{{${name}}}`, String(value))
    return text
  }
}

/** The host's plugin context, reduced to the fields the panel components read. */
export function makePluginContext(overrides: Record<string, unknown> = {}): never {
  return {
    id: "opencode-context",
    t: makeTranslate(),
    links: {
      open: () => true,
      exists: async () => true,
    },
    system: {
      copy: async () => {},
      openExternal: () => {},
    },
    tabs: { open: () => {} },
    toast: { show: () => {} },
    ui: {
      Button: (props: { class?: string; onClick?: () => void; children?: JSX.Element }) => (
        <button type="button" class={props.class} onClick={props.onClick}>
          {props.children}
        </button>
      ),
      Markdown: (props: { text: string }) => <div class="md-body">{props.text}</div>,
      Code: (props: { content: string; language?: string }) => <pre class="code-body">{props.content}</pre>,
    },
    ...overrides,
  } as never
}

export interface Mounted {
  readonly container: HTMLElement
  dispose(): void
}

/** Mounts a component under the plugin context the panel renders with. */
export function mount(component: () => JSX.Element, ctx: never = makePluginContext()): Mounted {
  const container = document.createElement("div")
  document.body.append(container)
  const dispose = render(
    () => createComponent(PluginContext.Provider, { value: ctx, get children() { return component() } }),
    container,
  )
  return { container, dispose }
}
