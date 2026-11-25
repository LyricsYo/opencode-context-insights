import { Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { EVENT_COLOR, EVENT_GLYPH } from "../colors.ts"
import { clock, fmt, type EventRow } from "../../shared/report.ts"

export function EventRowView(props: { event: EventRow; label: string; at?: string; onClick?: () => void }) {
  const ctx = usePlugin()
  const body = () => (
    <>
      <span class="oc-event-icon" style={{ color: EVENT_COLOR[props.event.kind] }}>{EVENT_GLYPH[props.event.kind]}</span>
      <span
        class="oc-event-kind" style={{ color: EVENT_COLOR[props.event.kind], background: `color-mix(in srgb, ${EVENT_COLOR[props.event.kind]} 14%, transparent)` }}
      >
        {ctx.t(`event.kind.${props.event.kind}`)}
      </span>
      <span class="oc-event-label" title={props.label}>
        {props.label}
      </span>
      <Show when={props.at !== undefined}>
        <span class="oc-event-at">{props.at}</span>
      </Show>
      <Show when={props.event.tokens !== undefined && props.event.tokens > 0 ? props.event.tokens : undefined} keyed>
        {(tokens) => (
          <span
            class="oc-event-tokens" style={{ color: props.event.kind === "compaction" ? "#d64545" : "#22a06b" }}
            title={
              props.event.kind === "compaction" && props.event.grossTokens !== undefined
                ? ctx.t("ev.compactionGross", { gross: fmt(props.event.grossTokens), net: fmt(tokens) })
                : undefined
            }
          >
            {props.event.kind === "compaction" ? "−" : "+"}
            {fmt(tokens)}
          </span>
        )}
      </Show>
      <span class="oc-event-time">{clock(props.event.at)}</span>
    </>
  )
  return props.onClick === undefined ? (
    <div class="oc-event-row">{body()}</div>
  ) : (
    <button
      type="button"
      class="oc-event-jump oc-event-row"
      onClick={() => props.onClick?.()}
    >
      {body()}
    </button>
  )
}


