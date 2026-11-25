import { For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { CATEGORY_ORDER } from "../../shared/estimate.ts"
import { CATEGORY_COLOR } from "../colors.ts"
import { fmt, span } from "../../shared/report.ts"
import { type FleetHead, type FleetNode, type FleetPoint } from "../../shared/fleet.ts"
import { fleetStatusColor } from "../fleetModel.ts"
import { Dot } from "./section.tsx"
import { FleetAvatar } from "./fleetAvatar.tsx"

export function FleetCard(props: {
  node: FleetNode
  point: FleetPoint
  width: number
  hue: string
  active: boolean
  /** Cumulative active time across every turn, excluding user and subagent waits. */
  activeMs?: number
  lit?: boolean
  detail: FleetHead | undefined
  limit?: number
  pinned: boolean
  onHover: (id: string | null) => void
  onPick: (id: string) => void
}) {
  const ctx = usePlugin()
  const segments = () => {
    const composition = props.detail?.composition
    if (composition !== undefined && composition.total > 0) {
      return CATEGORY_ORDER.filter((category) => composition.byCategory[category] > 0).map((category) => ({
        key: category,
        value: composition.byCategory[category],
        color: CATEGORY_COLOR[category],
      }))
    }
    const prompt = props.node.prompt
    const output = props.node.output
    if (prompt + output <= 0) return []
    return [
      { key: "in", value: prompt, color: "#5b8def" },
      { key: "out", value: output, color: "#22a06b" },
    ]
  }
  const total = () => segments().reduce((sum, segment) => sum + segment.value, 0)
  const cost = () => props.detail?.cost ?? props.node.cost
  const occupancy = () => {
    const value = pct()
    return value === undefined ? 1 : Math.min(100, Math.max(0, value)) / 100
  }
  const pct = () => {
    const composition = props.detail?.composition
    const limit = props.limit
    if (composition === undefined || limit === undefined || limit <= 0 || composition.total <= 0) return undefined
    return Math.round((composition.total / limit) * 100)
  }
  return (
    <button
      type="button"
      class="oc-fleet-card"
      classList={{ "oc-fleet-card-active": props.active }}
      style={{
        left: `${props.point.x - props.width / 2}px`,
        top: `${props.point.y}px`,
        width: `${props.width}px`,
        "box-shadow": `inset 2px 0 0 ${props.hue}`,
        ...(props.active ? { "border-color": props.hue } : {}),
        opacity: props.lit === undefined || props.lit ? 1 : 0.34,
      }}
      title={props.node.title}
      data-fleet-id={props.node.id}
      aria-pressed={props.pinned}
      onMouseEnter={() => props.onHover(props.node.id)}
      onMouseLeave={() => props.onHover(null)}
      onFocus={() => props.onHover(props.node.id)}
      onBlur={() => props.onHover(null)}
      onClick={() => props.onPick(props.node.id)}
    >
      <div class="oc-fleet-card-head">
        <FleetAvatar title={props.node.title} hue={props.hue} />
        <Dot color={fleetStatusColor(props.node)} />
        <span class="oc-fleet-card-name">{props.node.title}</span>
        <Show when={props.node.isCurrent}>
          <span class="oc-fleet-badge">{ctx.t("fleet.self")}</span>
        </Show>
      </div>
      <div class="oc-fleet-card-duty">
        {props.node.agent ?? "agent"}
        {props.node.model !== undefined ? ` · ${props.node.model}` : ""}
      </div>
      <div class="oc-fleet-card-metric">
        ↑{fmt(props.node.prompt)} ↓{fmt(props.node.output)} · ${cost().toFixed(3)}
      </div>
      <div class="oc-fleet-bar">
        <Show when={total() > 0}>
          <For each={segments()}>
            {(segment) => (
              <i
                style={{
                  height: "100%",
                  width: `${(segment.value / total()) * 100 * occupancy()}%`,
                  background: segment.color,
                }}
              />
            )}
          </For>
        </Show>
      </div>
      <div class="oc-fleet-card-meta">
        <Show when={props.activeMs}>{(value) => <span>{span(value())}</span>}</Show>
        <Show when={props.detail?.steps}>
          {(steps) => <span>{ctx.t("fleet.steps", { n: String(steps()) })}</span>}
        </Show>
        <Show when={pct() !== undefined}>
          <span>{pct()}%</span>
        </Show>
      </div>
    </button>
  )
}

