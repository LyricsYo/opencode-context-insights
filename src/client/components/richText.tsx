import { For, Match, Show, Switch, createSignal } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"

export function bytesLabel(bytes: number | undefined): string | undefined {
  if (bytes === undefined) return undefined
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

export function extensionOf(name: string): string {
  const part = name.split(".").at(-1)
  return part && part.length <= 4 ? part : "file"
}

export function schemaParams(schema: string | undefined): ReadonlyArray<{ name: string; type: string; required: boolean; description?: string }> {
  if (!schema) return []
  try {
    const value = JSON.parse(schema) as { properties?: unknown; required?: unknown }
    const properties = value.properties
    if (typeof properties !== "object" || properties === null) return []
    const required = new Set(Array.isArray(value.required) ? value.required.filter((item): item is string => typeof item === "string") : [])
    return Object.entries(properties as Record<string, unknown>).map(([name, raw]) => {
      const item = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {}
      return {
        name,
        type: typeof item.type === "string" ? item.type : "any",
        required: required.has(name),
        description: typeof item.description === "string" ? item.description : undefined,
      }
    })
  } catch {
    return []
  }
}

export function RichTextBlock(props: { text: string; label?: string; meta?: string; scrollKey?: string }) {
  const ctx = usePlugin()
  const [mode, setMode] = createSignal<"raw" | "md" | "json">("raw")
  const scrollKey = () => (props.scrollKey === undefined ? undefined : `${props.scrollKey}:${mode()}`)
  const isJson = () => {
    const text = props.text.trim()
    if (!text.startsWith("{") && !text.startsWith("[")) return false
    try {
      JSON.parse(text)
      return true
    } catch {
      return false
    }
  }
  return (
    <>
      <div class="oc-field-label-row">
        <span class="oc-field-label">{props.label ?? ctx.t("browser.content")}</span>
        <span class="oc-inline-center">
          <Show when={props.meta}>
            <span class="oc-faint">{props.meta}</span>
          </Show>
          <span class="oc-segment">
            <For each={["raw", "md", "json"] as const}>
              {(pick) => (
                <Show when={pick !== "json" || isJson()}>
                  <button
                    type="button"
                    class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": mode() === pick }}
                    onClick={() => setMode(pick)}
                  >
                    {pick === "raw"
                      ? ctx.t("browser.rawText")
                      : pick === "md"
                        ? ctx.t("browser.markdown")
                        : ctx.t("browser.json")}
                  </button>
                </Show>
              )}
            </For>
          </span>
        </span>
      </div>
      <Switch fallback={<pre class="oc-pre" data-scroll-key={scrollKey()}>{props.text}</pre>}>
        <Match when={mode() === "md"}>
          <div class="oc-md" data-scroll-key={scrollKey()}>
            <ctx.ui.Markdown text={props.text} />
          </div>
        </Match>
        <Match when={mode() === "json" && isJson()}>
          <div class="oc-md" data-scroll-key={scrollKey()}>
            <ctx.ui.Code content={props.text} language="json" />
          </div>
        </Match>
      </Switch>
    </>
  )
}

