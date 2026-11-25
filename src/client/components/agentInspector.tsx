import { For, Show, createEffect, createSignal } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { CATEGORY_ORDER, clip } from "../../shared/estimate.ts"
import { MESSAGE_PAGE, growOnScroll } from "../paging.ts"
import { CATEGORY_COLOR } from "../colors.ts"
import { clock, fmt, percent, span } from "../../shared/report.ts"
import { type FleetDelegation, type FleetDetail, type FleetNode } from "../../shared/fleet.ts"
import { fleetDelegationMark, fleetHue, fleetKindColor, fleetKindLabel, fleetStatusColor } from "../fleetModel.ts"
import { Dot } from "./section.tsx"
import { FleetAvatar } from "./fleetAvatar.tsx"

export function FleetInspector(props: {
  node: FleetNode
  detail: FleetDetail | undefined
  /** Cumulative active time across every turn, excluding user and subagent waits. */
  activeMs?: number
  limit?: number
  pinned: boolean
  incoming?: { parent: FleetNode; delegation: FleetDelegation }
  delegations: readonly FleetDelegation[]
  onPick: (id: string) => void
  onOpen: () => void
  onUnpin: () => void
}) {
  const ctx = usePlugin()
  const [expanded, setExpanded] = createSignal(false)
  const [expandedRows, setExpandedRows] = createSignal<ReadonlySet<string>>(new Set<string>())
  const [messageLimit, setMessageLimit] = createSignal(MESSAGE_PAGE)
  const [delegationLimit, setDelegationLimit] = createSignal(MESSAGE_PAGE)
  let messageScrollEl: HTMLDivElement | undefined
  let delegationScrollEl: HTMLDivElement | undefined
  createEffect(() => {
    props.node.id
    setExpanded(false)
    setExpandedRows(new Set<string>())
    setMessageLimit(MESSAGE_PAGE)
    setDelegationLimit(MESSAGE_PAGE)
    if (messageScrollEl !== undefined) messageScrollEl.scrollTop = 0
    if (delegationScrollEl !== undefined) delegationScrollEl.scrollTop = 0
  })
  const composition = () => props.detail?.composition
  const rows = () => props.detail?.rows ?? []
  const total = () => composition()?.total ?? 0
  const cost = () => props.detail?.cost ?? props.node.cost
  const pct = () => {
    const limit = props.limit
    if (limit === undefined || limit <= 0 || total() <= 0) return undefined
    return Math.round((total() / limit) * 100)
  }
  return (
    <div class="oc-fleet-inspector">
      <div class="oc-current-head">
        <FleetAvatar title={props.node.title} hue={fleetHue(props.node)} />
        <Dot color={fleetStatusColor(props.node)} />
        <b>{props.node.title}</b>
        <Show when={props.node.isCurrent}>
          <span class="oc-fleet-badge">{ctx.t("fleet.self")}</span>
        </Show>
        <Show when={props.node.running}>
          <span class="oc-fleet-badge">{ctx.t("fleet.running")}</span>
        </Show>
        <Show when={!props.node.running ? props.node.outcome : undefined}>
          {(outcome) => <span class="oc-fleet-badge">{ctx.t(`fleet.outcome.${outcome()}`)}</span>}
        </Show>
        <span class="oc-inline-end oc-inline-gap-4">
          <Show when={props.pinned}>
            <button type="button" class="oc-toggle" onClick={props.onUnpin}>
              {ctx.t("fleet.unpin")}
            </button>
          </Show>
          <Show when={!props.node.isCurrent}>
            <button type="button" class="oc-toggle" onClick={props.onOpen}>
              {ctx.t("fleet.open")}
            </button>
          </Show>
        </span>
      </div>

      <div class="oc-chip-row">
        <span class="oc-chip">
          <span class="oc-chip-name">{ctx.t("fleet.tokens")}</span>
          <span class="oc-chip-value">
            ↑{fmt(props.node.prompt)} ↓{fmt(props.node.output)}
          </span>
        </span>
        <Show when={props.node.reasoning > 0}>
          <span class="oc-chip">{ctx.t("fleet.reasoning", { value: fmt(props.node.reasoning) })}</span>
        </Show>
        <Show when={props.node.cacheRead > 0 || props.node.cacheWrite > 0}>
          <span class="oc-chip">
            {ctx.t("fleet.cache", { read: fmt(props.node.cacheRead), write: fmt(props.node.cacheWrite) })}
          </span>
        </Show>
        <span class="oc-chip">
          <span class="oc-chip-name">{ctx.t("fleet.cost")}</span>
          <span class="oc-chip-value">${cost().toFixed(4)}</span>
        </span>
        <Show when={props.activeMs}>
          {(value) => <span class="oc-chip">{span(value())}</span>}
        </Show>
        <Show when={props.detail?.steps}>
          {(steps) => <span class="oc-chip">{ctx.t("fleet.steps", { n: String(steps()) })}</span>}
        </Show>
        <Show when={pct() !== undefined}>
          <span class="oc-chip">{pct()}%</span>
        </Show>
      </div>

      <Show when={props.incoming}>
        {(incoming) => (
          <div class="oc-fleet-note">
            <div class="oc-field-label">{ctx.t("fleet.delegatedBy")}</div>
            <div class="oc-fleet-msg">
              <FleetAvatar title={incoming().parent.title} hue={fleetHue(incoming().parent)} />
              <button type="button" class="oc-toggle" onClick={() => props.onPick(incoming().parent.id)}>
                {incoming().parent.title}
              </button>
              <span class="oc-faint">{clock(incoming().delegation.at)}</span>
            </div>
            <Show when={incoming().delegation.description !== ""}>
              <div class="oc-muted">{incoming().delegation.description}</div>
            </Show>
          </div>
        )}
      </Show>

      <div class="oc-field-label">{ctx.t("fleet.config")}</div>
      <div class="oc-muted">
        {props.node.agent ?? "agent"}
        {props.node.provider !== undefined && props.node.model !== undefined
          ? ` · ${props.node.provider}/${props.node.model}`
          : props.node.model !== undefined
            ? ` · ${props.node.model}`
            : ""}
      </div>
      <div class="oc-faint oc-mono">{props.node.id}</div>

      <Show when={composition()}>
        {(value) => (
          <Show when={value().total > 0}>
            <>
              <div class="oc-field-label">{ctx.t("fleet.composition")}</div>
              <div class="oc-legend">
                <For each={CATEGORY_ORDER.filter((category) => value().byCategory[category] > 0)}>
                  {(category) => (
                    <div class="oc-legend-item">
                      <Dot color={CATEGORY_COLOR[category]} />
                      <span class="oc-legend-label">{ctx.t(`category.${category}`)}</span>
                      <span class="oc-legend-value">
                        ≈{fmt(value().byCategory[category])} · {percent(value().byCategory[category], value().total)}
                      </span>
                    </div>
                  )}
                </For>
              </div>
            </>
          </Show>
        )}
      </Show>

      <Show when={props.detail?.prompt}>
        {(prompt) => (
          <>
            <div class="oc-field-label-row">
              <span class="oc-field-label">{ctx.t("fleet.prompt")}</span>
              <span class="oc-faint">{clock(prompt().at)}</span>
            </div>
            <pre class="oc-pre" style={{ "max-height": expanded() ? "320px" : "96px" }}>{prompt().text}</pre>
            <Show when={prompt().text.length > 300}>
              <button type="button" class="oc-toggle" onClick={() => setExpanded((value) => !value)}>
                {expanded() ? ctx.t("fleet.collapse") : ctx.t("fleet.expand")}
              </button>
            </Show>
          </>
        )}
      </Show>

      <Show when={rows().length > 0}>
        <div class="oc-field-label-row">
          <span class="oc-field-label">{ctx.t("fleet.messages")}</span>
          <span class="oc-faint">
            {ctx.t("fleet.messageCount", {
              shown: String(Math.min(messageLimit(), rows().length)),
              total: String(rows().length),
            })}
          </span>
        </div>
        <div
          ref={(el) => (messageScrollEl = el)}
          class="oc-fleet-msg-scroll"
          onScroll={(event) => {
            const el = event.currentTarget
            if (el.scrollTop + el.clientHeight < el.scrollHeight - 24) return
            const total = rows().length
            if (messageLimit() >= total) return
            setMessageLimit(Math.min(total, messageLimit() + MESSAGE_PAGE))
          }}
        >
          <div class="oc-table oc-fleet-msg-list">
            <For each={rows().slice().reverse().slice(0, messageLimit())}>
              {(row) => {
                const open = () => expandedRows().has(row.id)
                return (
                  <div class="oc-fleet-msg-button">
                    <button
                      type="button"
                      class="oc-ctx-hover oc-fleet-msg-head"
                      classList={{ "oc-fleet-msg-head-open": open() }}
                      title={open() ? undefined : row.text}
                      onClick={() =>
                        setExpandedRows((current) => {
                          const next = new Set(current)
                          if (next.has(row.id)) next.delete(row.id)
                          else next.add(row.id)
                          return next
                        })
                      }
                    >
                      <span class="oc-fleet-chevron">{open() ? "▾" : "▸"}</span>
                      <span
                        class="oc-fleet-badge"
                        style={{
                          color: fleetKindColor(row.kind),
                          background: `color-mix(in srgb, ${fleetKindColor(row.kind)} 14%, transparent)`,
                        }}
                      >
                        {fleetKindLabel((key) => ctx.t(key), row.kind)}
                      </span>
                      <span class="oc-fleet-msg-text">{clip(row.text, 140)}</span>
                      <span class="oc-faint oc-fleet-msg-time">{clock(row.at)}</span>
                    </button>
                    <Show when={open()}>
                      <div class="oc-md">
                        <ctx.ui.Markdown text={row.text} />
                      </div>
                    </Show>
                  </div>
                )
              }}
            </For>
          </div>
        </div>
      </Show>

      <Show when={props.delegations.length > 0}>
        <div class="oc-field-label-row">
          <span class="oc-field-label">{ctx.t("fleet.delegations")}</span>
          <span class="oc-faint">
            {ctx.t("fleet.delegationCount", {
              shown: String(Math.min(delegationLimit(), props.delegations.length)),
              total: String(props.delegations.length),
            })}
          </span>
        </div>
        <div
          ref={(el) => (delegationScrollEl = el)}
          class="oc-fleet-msg-scroll"
          onScroll={(event) => growOnScroll(event, delegationLimit(), props.delegations.length, setDelegationLimit)}
        >
          <div class="oc-table oc-fleet-msg-list">
            <For each={props.delegations.slice(0, delegationLimit())}>
              {(row) => {
                const linkable = () => row.childID !== undefined
                const mark = () => fleetDelegationMark(row.status)
                return (
                  <button
                    type="button"
                    class="oc-ctx-hover oc-fleet-delegation-row"
                    classList={{ "oc-fleet-delegation-row-flat": !(linkable()), "oc-fleet-delegation-link": linkable() }}
                    aria-disabled={!linkable()}
                    title={row.result ?? row.prompt ?? row.description}
                    onClick={() => {
                      if (row.childID !== undefined) props.onPick(row.childID)
                    }}
                  >
                    <span
                      class="oc-fleet-delegation-glyph"
                      style={{ color: mark().color, background: `color-mix(in srgb, ${mark().color} 16%, transparent)` }}
                    >
                      {mark().glyph}
                    </span>
                    <span class="oc-fleet-badge">{row.agent ?? ctx.t("fleet.subagent")}</span>
                    <span class="oc-fleet-delegation-text">{row.childTitle ?? row.description}</span>
                    <Show when={!row.exact}>
                      <span class="oc-faint" title={ctx.t("fleet.guessed")}>
                        ≈
                      </span>
                    </Show>
                    <span class="oc-faint oc-fleet-msg-time">{clock(row.at)}</span>
                  </button>
                )
              }}
            </For>
          </div>
        </div>
      </Show>
    </div>
  )
}

