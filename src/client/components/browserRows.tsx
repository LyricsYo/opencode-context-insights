import { For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { type Category } from "../../shared/estimate.ts"
import { CATEGORY_COLOR } from "../colors.ts"
import { clock, fmt, type BrowserRow } from "../../shared/report.ts"
import { AttachmentCards } from "./attachments.tsx"
import { RichTextBlock, schemaParams } from "./richText.tsx"

export function BrowserRowView(props: { row: BrowserRow; category: Category; showCategory?: boolean; focused?: boolean }) {
  const ctx = usePlugin()
  const failed = () => props.row.status === "error" || props.row.status === "failed"
  const lineCount = (text: string | undefined) => (text ? text.split("\n").length : 0)
  const status = () => {
    const value = props.row.status
    if (value === undefined) return undefined
    if (value === "completed") return ctx.t("browser.status.ok")
    if (value === "error" || value === "failed") return ctx.t("browser.status.error")
    return value
  }
  const params = () => schemaParams(props.row.schema)
  return (
    <details
      class="oc-entry" classList={{ "oc-entry-focus": props.focused }}
      data-browser-row={props.row.id}
      open={props.focused === true ? true : undefined}
    >
      <summary class="oc-entry-head">
        <Show when={failed()}>
          <span class="oc-dot oc-dot-bad" />
        </Show>
        <Show when={props.showCategory}>
          <span class="oc-dot" style={{ background: CATEGORY_COLOR[props.category] }} />
        </Show>
        <span class="oc-row-name">{props.row.name}</span>
        <Show when={props.row.kind === "toolSchema" && props.row.source}>
          <span class="oc-source-chip" title={ctx.t("browser.source")}>
            {props.row.source}
          </span>
        </Show>
        <span class="oc-row-preview">{props.row.preview}</span>
        <Show when={props.row.turn !== undefined || props.row.at !== undefined}>
          <span class="oc-row-stamp">
            {props.row.turn !== undefined ? `T${props.row.turn} S${props.row.step ?? "?"}` : clock(props.row.at!)}
          </span>
        </Show>
        <span class="oc-entry-tokens">≈{fmt(props.row.tokens)}</span>
      </summary>
      <div class="oc-entry-body">
        <Show when={props.row.kind !== "toolSchema" && status()}>
          <span class="oc-faint" classList={{ "oc-text-bad": failed() }}>{status()}</span>
        </Show>
        <Show when={props.row.kind === "toolSchema"}>
          <Show when={props.row.description}>
            <div class="oc-muted">{props.row.description}</div>
          </Show>
          <Show when={params().length > 0} fallback={<div class="oc-faint">{ctx.t("browser.noParams")}</div>}>
            <div class="oc-field-label">{ctx.t("browser.params")}</div>
            <div class="oc-table">
              <For each={params()}>
                {(param) => (
                  <div class="oc-param-row">
                    <span class="oc-param-name">{param.name}</span>
                    <span class="oc-param-type">
                      {param.type}
                      {param.required ? " · required" : ""}
                    </span>
                    <Show when={param.description}>
                      <span class="oc-param-desc">{param.description}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <details class="oc-entry">
            <summary class="oc-entry-head">
              <span class="oc-faint">{ctx.t("browser.raw")}</span>
            </summary>
            <pre class="oc-pre" data-scroll-key={`browser:${props.row.id}:schema`}>{props.row.schema}</pre>
          </details>
        </Show>
        <Show when={props.row.kind !== "toolSchema" && props.row.text}>
          <RichTextBlock text={props.row.text!} scrollKey={`browser:${props.row.id}:text`} />
        </Show>
        <Show when={(props.row.kind === "toolCall" || props.row.kind === "toolResult") && props.row.input !== undefined}>
          <div class="oc-field-label">{ctx.t("browser.args")}</div>
          <pre class="oc-pre" data-scroll-key={`browser:${props.row.id}:input`}>{props.row.input}</pre>
        </Show>
        <Show when={props.row.kind === "toolResult" && props.row.output !== undefined}>
          <RichTextBlock
            text={props.row.output!}
            label={ctx.t("browser.result")}
            meta={ctx.t("browser.lines", { count: String(lineCount(props.row.output)) })}
            scrollKey={`browser:${props.row.id}:output`}
          />
        </Show>
        <Show when={props.row.truncated}>
          <div class="oc-faint oc-text-warn">{ctx.t("browser.truncated")}</div>
        </Show>
        <Show when={props.row.files && props.row.files.length > 0}>
          <AttachmentCards files={props.row.files!} />
        </Show>
      </div>
    </details>
  )
}

