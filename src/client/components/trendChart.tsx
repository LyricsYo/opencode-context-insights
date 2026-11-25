import { For, Show } from "solid-js"
import { CATEGORY_ORDER, type Category } from "../../shared/estimate.ts"
import { TREND_HEIGHT } from "../styleMetrics.ts"
import { CATEGORY_COLOR } from "../colors.ts"
import { fmt, type TokenStepRow, type TokenTurnRow } from "../../shared/report.ts"

export function TrendChartBar(props: {
  row: TokenStepRow | TokenTurnRow
  label: string
  delta: Record<Category, number>
  mode: "total" | "delta"
  maxTotal: number
  maxUp: number
  maxDown: number
  selected: boolean
  hovered: boolean
  onHover: (id: string | undefined) => void
  onSelect: (id: string) => void
  onPick?: (category: Category) => void
}) {
  const totalHeight = (value: number) => Math.max(1, Math.round((value / Math.max(1, props.maxTotal)) * TREND_HEIGHT))
  const half = TREND_HEIGHT / 2
  const upHeight = (value: number) => Math.max(1, Math.round((value / Math.max(1, props.maxUp)) * half))
  const downHeight = (value: number) => Math.max(1, Math.round((value / Math.max(1, props.maxDown)) * half))
  return (
    <div
      class="oc-trend-bar" classList={{ "oc-trend-bar-active": props.hovered || props.selected }}
      title={`${props.label} · ≈${fmt(props.row.total)} tokens`}
      role="button"
      tabIndex={0}
      aria-label={`${props.label} · ≈${fmt(props.row.total)} tokens`}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return
        event.preventDefault()
        props.onSelect(props.row.id)
      }}
      onMouseEnter={() => props.onHover(props.row.id)}
      onClick={() => props.onSelect(props.row.id)}
    >
      <Show when={props.row.afterCompaction}>
        <span class="oc-trend-chart-caption">✂</span>
      </Show>
      <Show when={props.mode === "total"}>
        <div class="oc-trend-chart-up">
          <For each={CATEGORY_ORDER.filter((category) => props.row.byCategory[category] > 0)}>
            {(category) => (
              <div
                class="oc-ctx-hover"
                title={`${category} ${fmt(props.row.byCategory[category])}`}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onPick?.(category)
                }}
                style={{
                  height: `${totalHeight(props.row.byCategory[category])}px`,
                  background: CATEGORY_COLOR[category],
                  "min-height": "1px",
                }}
              />
            )}
          </For>
        </div>
      </Show>
      <Show when={props.mode === "delta"}>
        <div class="oc-trend-chart-upper">
          <For each={CATEGORY_ORDER.filter((category) => props.delta[category] > 0)}>
            {(category) => (
              <div
                class="oc-ctx-hover"
                title={`${category} +${fmt(props.delta[category])}`}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onPick?.(category)
                }}
                style={{
                  height: `${upHeight(props.delta[category])}px`,
                  background: CATEGORY_COLOR[category],
                  "min-height": "1px",
                }}
              />
            )}
          </For>
        </div>
        <div class="oc-trend-chart-lower">
          <For each={CATEGORY_ORDER.filter((category) => props.delta[category] < 0)}>
            {(category) => (
              <div
                class="oc-ctx-hover"
                title={`${category} ${fmt(props.delta[category])}`}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onPick?.(category)
                }}
                style={{
                  height: `${downHeight(-props.delta[category])}px`,
                  background: CATEGORY_COLOR[category],
                  "min-height": "1px",
                }}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

