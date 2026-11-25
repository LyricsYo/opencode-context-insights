import { For, Show } from "solid-js"
import type { Accessor, JSX, Setter } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { type Category } from "../../shared/estimate.ts"
import { buildCost } from "../../shared/cost.ts"
import { EVENT_KINDS, fmt, percent, percent2, type ChildRow, type CommandRow, type EventKind, type SessionIndex, type SessionTokenStats, type StepComposition, type StepRow, type ToolRow } from "../../shared/report.ts"
import { CATEGORY_COLOR } from "../colors.ts"
import { fleetHue } from "../fleetModel.ts"
import { growOnScroll } from "../paging.ts"
import type { PanelView } from "../panelSupport.ts"
import { Dot, Section, Stat } from "./section.tsx"
import { FleetAvatar } from "./fleetAvatar.tsx"

export interface OverviewPanelProps {
  readonly loading: Accessor<boolean>
  readonly tokens: Accessor<{ input: number; output: number; read: number; write: number }>
  readonly costStats: Accessor<ReturnType<typeof buildCost>>
  readonly turnCount: Accessor<number>
  readonly steps: Accessor<StepRow[]>
  readonly modelReplies: Accessor<number>
  readonly skillLoads: Accessor<number>
  readonly tools: Accessor<ToolRow[]>
  readonly commands: Accessor<CommandRow[]>
  readonly fileCounts: Accessor<{ read: number; write: number; search: number }>
  readonly sessionIndex: Accessor<SessionIndex>
  readonly eventCounts: Accessor<Record<EventKind, number>>
  readonly tokenStats: Accessor<SessionTokenStats | undefined>
  readonly tokenCategories: Accessor<Category[]>
  readonly currentUsed: Accessor<number>
  readonly limit: Accessor<number | undefined>
  readonly currentView: Accessor<StepComposition | undefined>
  readonly currentCategories: Accessor<Category[]>
  readonly currentTokens: (value: number) => number
  readonly currentWidth: (tokens: number) => number
  readonly currentFree: Accessor<number>
  readonly trigger: Accessor<{ auto?: boolean; at: number } | undefined>
  readonly triggerPct: Accessor<number | undefined>
  readonly modelInfo: Accessor<{ name?: string } | undefined>
  readonly info: Accessor<{ model?: { id: string } } | undefined>
  readonly outputLimit: Accessor<number | undefined>
  readonly currentRunning: Accessor<boolean>
  readonly children: Accessor<ChildRow[]>
  readonly childrenLimit: Accessor<number>
  readonly setChildrenLimit: Setter<number>
  /** Session id → the hue its fleet avatar and timeline bar use. */
  readonly fleetHues: Accessor<ReadonlyMap<string, string>>
  readonly setFleetPinned: Setter<string | undefined>
  readonly setFleetFocus: Setter<string | undefined>
  readonly setView: Setter<PanelView>
  readonly data: () => { session: { status(id: string): string } }
  readonly timingSection: () => JSX.Element
}

export function OverviewPanel(props: OverviewPanelProps) {
  const ctx = usePlugin()
  return (
    <>
      <Section title={ctx.t("stats.title")} hint={ctx.t("stats.hint")}>
        <div class="oc-summary-row">
          <div class="oc-summary-block">
            <span class="oc-faint">{ctx.t("stats.ioTitle")}</span>
            <span class="oc-summary-value">
              {fmt(props.tokens().input + props.tokens().read + props.tokens().write)}{" "}
              <span class="oc-faint">/</span> {fmt(props.tokens().output)}
            </span>
          </div>
          <div class="oc-summary-block">
            <span class="oc-faint">{ctx.t("stats.cacheHit")}</span>
            <span class="oc-summary-value">
              {percent2(
                props.tokens().read,
                props.tokens().input + props.tokens().read + props.tokens().write,
              )}
            </span>
            <span class="oc-faint">
              {ctx.t("stats.cache", { read: fmt(props.tokens().read), write: fmt(props.tokens().write) })}
            </span>
          </div>
          <div class="oc-summary-block">
            <span class="oc-faint">{ctx.t("stats.cost")}</span>
            <span class="oc-summary-value">${props.costStats().total.toFixed(4)}</span>
            <span class="oc-faint">
              {ctx.t("stats.costStep", { value: `$${props.costStats().average.toFixed(4)}` })}
            </span>
            <span class="oc-faint">
              {props.costStats().estimated > 0 ? ctx.t("stats.costNote") : ctx.t("stats.costProvider")}
            </span>
          </div>
        </div>
        <div class="oc-stats4">
          <Stat label={ctx.t("stats.turns")} value={String(props.turnCount())} />
          <Stat label={ctx.t("stats.steps")} value={String(props.steps().length)} />
          <Stat
            label={ctx.t("stats.modelReplies")}
            value={String(props.modelReplies())}
            hint={ctx.t("stats.modelRepliesHint")}
          />
          <Stat label={ctx.t("stats.skills")} value={String(props.skillLoads())} />
        </div>
        <div class="oc-stats4">
          <Stat
            label={ctx.t("stats.toolCalls")}
            value={String(props.tools().reduce((sum, tool) => sum + tool.calls, 0))}
          />
          <Stat label={ctx.t("stats.commands")} value={String(props.commands().length)} />
          <Stat
            label={ctx.t("stats.filesLabel")}
            value={`${props.fileCounts().read} / ${props.fileCounts().write} / ${props.fileCounts().search}`}
            hint={ctx.t("stats.filesHint")}
          />
          <Stat label={ctx.t("stats.eventsLabel")} value={String(props.sessionIndex().eventTotal)} />
        </div>
        <div class="oc-chip-row">
          <For each={props.tools().slice(0, 8)}>
            {(tool) => (
              <span class="oc-chip">
                <span class="oc-chip-name">{tool.name}</span>
                <span class="oc-chip-value">{tool.calls}</span>
              </span>
            )}
          </For>
          <Show when={props.tools().length > 8}>
            <span class="oc-chip">+{props.tools().length - 8}</span>
          </Show>
        </div>
        <div class="oc-chip-row">
          <For each={EVENT_KINDS}>
            {(kind) => (
              <span class="oc-chip">
                <span class="oc-chip-name">{ctx.t(`event.kind.${kind}`)}</span>
                <span class="oc-chip-value">{props.eventCounts()[kind] ?? 0}</span>
              </span>
            )}
          </For>
        </div>
      </Section>

      <Section
        title={ctx.t("tokens.title")}
        hint={
          props.tokenStats()?.cacheHit === undefined
            ? undefined
            : ctx.t("stats.cacheHitValue", { value: props.tokenStats()!.cacheHit!.toFixed(2) })
        }
      >
        <Show when={props.tokenStats()} fallback={<span class="oc-muted">{ctx.t("tokens.empty")}</span>}>
          {(stats) => (
            <>
              <div class="oc-current-head">
                <b class="oc-current-value">{fmt(stats().total)}</b>
                <span class="oc-faint">
                  {" "}
                  {ctx.t("tokens.total")} ·{" "}
                  {ctx.t("tokens.inputOutput", { input: fmt(stats().input), output: fmt(stats().output) })}
                </span>
              </div>
              <div class="oc-bar">
                <For each={props.tokenCategories()}>
                  {(category) => (
                    <div
                      title={`${ctx.t(`category.${category}`)} ≈${fmt(stats().byCategory[category])}`}
                      style={{
                        width: `${(stats().byCategory[category] / Math.max(1, stats().total)) * 100}%`,
                        background: CATEGORY_COLOR[category],
                        "min-width": "2px",
                      }}
                    />
                  )}
                </For>
              </div>
              <div class="oc-legend">
                <For each={props.tokenCategories()}>
                  {(category) => (
                    <div class="oc-legend-item">
                      <Dot color={CATEGORY_COLOR[category]} />
                      <span class="oc-legend-label">{ctx.t(`category.${category}`)}</span>
                      <span class="oc-legend-value">
                        ≈{fmt(stats().byCategory[category])} (
                        {percent(stats().byCategory[category], stats().total)})
                      </span>
                    </div>
                  )}
                </For>
              </div>
              <div class="oc-muted">{ctx.t("tokens.note")}</div>
              <Show when={props.currentView()?.headerMissing}>
                <div class="oc-muted">{ctx.t("tokens.headerMissing")}</div>
              </Show>
            </>
          )}
        </Show>
      </Section>

      {props.timingSection()}

      <Section title={ctx.t("current.title")} hint={props.modelInfo()?.name ?? props.info()?.model?.id}>
        <Show
          when={props.currentUsed() > 0}
          fallback={<span class="oc-muted">{props.loading() ? ctx.t("loading") : ctx.t("current.empty")}</span>}
        >
          <div class="oc-current-head">
            <b class="oc-current-value">{fmt(props.currentUsed())}</b>
            <span class="oc-faint">
              {props.limit()
                ? ` / ${fmt(props.limit()!)} tokens · ${percent(props.currentUsed(), props.limit()!)} ${ctx.t("current.used")}`
                : ` ${ctx.t("current.tokens")}`}
            </span>
          </div>
          <Show
            when={props.currentView()}
            fallback={<div class="oc-muted">{ctx.t("current.noSplit")}</div>}
          >
            {(view) => (
              <>
                <div class="oc-bar-wrap">
                  <div class="oc-bar">
                    <For each={props.currentCategories()}>
                      {(category) => (
                        <div
                          title={`${ctx.t(`category.${category}`)} ≈${fmt(props.currentTokens(view().byCategory[category]))}`}
                          style={{
                            width: `${props.currentWidth(view().byCategory[category])}%`,
                            background: CATEGORY_COLOR[category],
                            "min-width": "2px",
                          }}
                        />
                      )}
                    </For>
                    <Show when={props.limit()}>
                      {(limit) => (
                        <Show when={limit() > props.currentUsed()}>
                          <div
                            title={`${ctx.t("current.free")} ${fmt(props.currentFree())}`}
                            style={{
                              width: `${(props.currentFree() / Math.max(1, limit())) * 100}%`,
                              background: "color-mix(in srgb, currentColor 14%, transparent)",
                              "min-width": "2px",
                            }}
                          />
                        </Show>
                      )}
                    </Show>
                  </div>
                  <Show when={props.trigger()?.auto && props.triggerPct() !== undefined}>
                    <div
                      title={ctx.t("current.triggerTip", {
                        value: fmt(props.trigger()!.at),
                        pct: `${Math.round(props.triggerPct()!)}%`,
                      })}
                      class="oc-trigger" style={{ left: `${props.triggerPct()}%` }}
                    >
                      <span class="oc-trigger-tag">{`${Math.round(props.triggerPct()!)}%`}</span>
                    </div>
                  </Show>
                </div>
                <div class="oc-legend">
                  <For each={props.currentCategories()}>
                    {(category) => (
                      <div class="oc-legend-item">
                        <Dot color={CATEGORY_COLOR[category]} />
                        <span class="oc-legend-label">{ctx.t(`category.${category}`)}</span>
                        <span class="oc-legend-value">
                          ≈{fmt(props.currentTokens(view().byCategory[category]))} (
                          {percent(
                            props.currentTokens(view().byCategory[category]),
                            Math.max(1, props.currentUsed()),
                          )}
                          )
                        </span>
                      </div>
                    )}
                  </For>
                  <Show when={(props.limit() ?? 0) > 0}>
                    <div class="oc-legend-item">
                      <Dot color="color-mix(in srgb, currentColor 24%, transparent)" />
                      <span class="oc-legend-label">{ctx.t("current.free")}</span>
                      <span class="oc-legend-value">{fmt(props.currentFree())}</span>
                    </div>
                  </Show>
                  <Show when={props.trigger()?.auto && (props.limit() ?? 0) > 0}>
                    <div class="oc-legend-item">
                      <Dot color="#d64545" />
                      <span class="oc-legend-label">{ctx.t("current.trigger")}</span>
                      <span class="oc-legend-value">{fmt(props.trigger()!.at)}</span>
                    </div>
                  </Show>
                </div>
                <Show when={view().headerPending}>
                  <div class="oc-muted">{ctx.t("header.loading")}</div>
                </Show>
                <Show when={view().headerMissing}>
                  <div class="oc-muted oc-text-warn">{ctx.t("composition.noHeader")}</div>
                </Show>
              </>
            )}
          </Show>
          <div class="oc-stats">
            <Stat
              label={ctx.t("current.used")}
              value={fmt(props.currentUsed())}
              hint={props.limit() ? percent(props.currentUsed(), props.limit()!) : undefined}
            />
            <Stat
              label={ctx.t("current.free")}
              value={props.limit() ? fmt(props.currentFree()) : "—"}
              hint={props.limit() ? percent(props.currentFree(), props.limit()!) : undefined}
            />
            <Stat
              label={ctx.t("current.output")}
              value={props.outputLimit() ? fmt(props.outputLimit()!) : "—"}
              hint={props.outputLimit() ? ctx.t("current.outputHint") : undefined}
            />
            <Stat
              label={ctx.t("current.trigger")}
              value={props.trigger() ? (props.trigger()!.auto ? fmt(props.trigger()!.at) : ctx.t("current.off")) : "—"}
              hint={props.trigger()?.auto && props.limit() ? percent(props.trigger()!.at, props.limit()!) : undefined}
            />
          </div>
          <Show when={props.trigger()?.auto && props.currentUsed() >= props.trigger()!.at}>
            <div class="oc-muted oc-text-bad">{ctx.t("current.triggerReached")}</div>
          </Show>
          <Show when={props.currentRunning()}>
            <div class="oc-muted">{ctx.t("current.running")}</div>
          </Show>
          <div class="oc-muted">{ctx.t("current.note")}</div>
        </Show>
      </Section>

      <Section
        title={ctx.t("children.title")}
        hint={props.children().length > 0 ? ctx.t("children.hint") : undefined}
      >
        <Show
          when={props.children().length > 0}
          fallback={<span class="oc-muted">{ctx.t("children.empty")}</span>}
        >
          <div
            class="oc-table oc-table-scroll"
            data-scroll-key="children"
            onScroll={(event) =>
              growOnScroll(event, props.childrenLimit(), props.children().length, props.setChildrenLimit)
            }
          >
            <For each={props.children().slice(0, props.childrenLimit())}>
              {(child) => {
                const tone = () => (props.data().session.status(child.id) === "running" ? "#22a06b" : "#7f8c8d")
                // Same component and hue as the fleet card, so an agent keeps one colour everywhere.
                const hue = () => props.fleetHues().get(child.id) ?? fleetHue(undefined)
                return (
                  <button
                    type="button"
                    class="oc-ctx-hover oc-table-button oc-child-row"
                    title={ctx.t("children.jump")}
                    onClick={() => {
                      props.setFleetPinned(child.id)
                      props.setFleetFocus(child.id)
                      props.setView("fleet")
                    }}
                  >
                    <FleetAvatar title={child.title} hue={hue()} />
                    <span class="oc-child-main">
                      <span class="oc-child-title">
                        <Dot color={tone()} />
                        <span class="oc-child-name">{child.title}</span>
                      </span>
                      <span class="oc-child-meta">
                        {child.agent ?? "agent"} · ${child.cost.toFixed(3)}
                      </span>
                    </span>
                    <span class="oc-child-tail">
                      {fmt(child.prompt)} in / {fmt(child.output)} out
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>
      </Section>
    </>
  )
}
