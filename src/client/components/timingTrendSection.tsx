import { For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { clock, fmt, percent, span, type StepTimingRow } from "../../shared/report.ts"
import { TREND_BAR, TREND_GAP, TREND_HEIGHT, TREND_PITCH } from "../styleMetrics.ts"
import { Dot, Section } from "./common.tsx"
import { createTrendModel } from "../models/trend.ts"
import { createTimingModel } from "../models/timing.ts"
import { createBrowserModel } from "../models/browser.ts"
import { createSessionModel } from "../models/session.ts"
import type { BrowserUi } from "./browserPanel.tsx"

export interface TimingTrendSectionProps {
  readonly session: ReturnType<typeof createSessionModel>
  readonly trend: ReturnType<typeof createTrendModel>
  readonly timing: ReturnType<typeof createTimingModel>
  readonly browser: ReturnType<typeof createBrowserModel>
  readonly ui: BrowserUi
  readonly attachTrendScroll: (el: HTMLDivElement) => void
  readonly attachTimingScroll: (el: HTMLDivElement) => void
  readonly attachBrowserAnchor: (el: HTMLElement) => void
  readonly attachBrowserSelect: (el: HTMLSelectElement) => void
  readonly measureTrendWindow: (el: HTMLDivElement) => void
  readonly measureTimingWindow: (el: HTMLDivElement) => void
  readonly refreshTrendWindow: () => void
  readonly refreshTimingWindow: () => void
  readonly scrollToBrowser: () => void
}

export function TimingTrendSection(props: TimingTrendSectionProps) {
  const ctx = usePlugin()
  const { steps, turnCount } = props.session
  const { timingTrendRows, timingTrendKey, timingRender, timingTrendMax, timingSegmentsOf, timingTrendLabel, timingRibbon, timingRibbonAxis, timingTrendGroups, timingTrendActive, timingGroupSteps, timingRibbonMarker } = props.timing
  const { hoverTimingRow, selectStep, measureTimingWindow, timingGranularity, selectedStep, timingAdaptive, setTimingAdaptive, setTimingOverview, setTimingGranularity, timingWall, timingHover, trendKeyOfTiming, timingOverview, rememberChartScroll } = props.ui
  return (
    <>
        <Section
          title={ctx.t("timing.trend.title")}
          headerActions={
            <>
              <span class="oc-segment">
                <button
                  type="button"
                  class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": timingAdaptive() }}
                  title={ctx.t("trend.adaptiveHint")}
                  onClick={() => {
                    const on = !timingAdaptive()
                    setTimingAdaptive(on)
                    if (on) {
                      setTimingOverview(false)
                      props.refreshTimingWindow()
                    }
                  }}
                >
                  {ctx.t("trend.adaptive")}
                </button>
                <button
                  type="button"
                  class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": timingOverview() }}
                  onClick={() => {
                    const on = !timingOverview()
                    setTimingOverview(on)
                    if (on) setTimingAdaptive(false)
                  }}
                >
                  {ctx.t("trend.overview")}
                </button>
              </span>
              <span class="oc-trend-ctl">
                <span class="oc-hint">{ctx.t("timing.trend.hint", { value: span(timingWall()) })}</span>
                <span class="oc-segment">
                  <button
                    type="button"
                    class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": timingGranularity() === "step" }}
                    onClick={() => setTimingGranularity("step")}
                  >
                    {ctx.t("trend.steps")}
                  </button>
                  <button
                    type="button"
                    class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": timingGranularity() === "turn" }}
                    onClick={() => setTimingGranularity("turn")}
                  >
                    {ctx.t("trend.turns")}
                  </button>
                </span>
              </span>
            </>
          }
        >
          <div class="oc-muted oc-trend-caption">
            {ctx.t("trend.counts", { turns: String(turnCount()), steps: String(steps().length) })}
          </div>
          <Show when={timingTrendRows().length > 0} fallback={<span class="oc-muted">{ctx.t("timing.trend.empty")}</span>}>
            <Show when={timingTrendActive()}>
              {(row) => (
                <div class="oc-trend-detail">
                  <div class="oc-trend-meta">
                    <b>{timingTrendLabel(row())}</b>
                    <Show when={"id" in row() ? (row() as StepTimingRow).at : undefined}>
                      {(at) => <span class="oc-faint">{clock(at())}</span>}
                    </Show>
                  </div>
                  <div class="oc-hero">
                    <div class="oc-hero-block">
                      <span class="oc-faint">{ctx.t("timing.trend.duration")}</span>
                      <span class="oc-hero-value">{span(Math.max(0, row().wall - row().question - row().delegation))}</span>
                      <Show when={row().question > 0}>
                        <span class="oc-faint">{ctx.t("timing.questionExcluded", { value: span(row().question) })}</span>
                      </Show>
                      <Show when={row().delegation > 0}>
                        <span class="oc-faint">{ctx.t("timing.delegationExcluded", { value: span(row().delegation) })}</span>
                      </Show>
                    </div>
                    <div class="oc-hero-block">
                      <span class="oc-faint">{ctx.t("timing.trend.speed")}</span>
                      <span class="oc-hero-value">{fmt(row().rate)} tok/s</span>
                      <span class="oc-faint">{ctx.t("timing.outputLine", { output: fmt(row().decoded) })}</span>
                    </div>
                  </div>
                  <div class="oc-chip-row">
                    <For each={timingSegmentsOf(row(), true)}>
                      {(segment) => (
                        <span class="oc-chip">
                          <Dot color={segment.color} />
                          <span class="oc-chip-name">{segment.label}</span>
                          <span class="oc-chip-value">{span(segment.ms)}</span>
                          <span class="oc-chip-name">{percent(segment.ms, row().wall)}</span>
                        </span>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </Show>
            <Show when={!timingOverview()}>
            <div class="oc-row-gap-8">
              <div class="oc-trend-axis">
                <For each={[span(timingTrendMax()), span(Math.round(timingTrendMax() / 2)), "0"]}>
                  {(label) => <span>{label}</span>}
                </For>
              </div>
              <div
                class="oc-trend-scroll"
                ref={(el) => props.attachTimingScroll(el)}
                onScroll={(event) => {
                  rememberChartScroll("timing", event.currentTarget)
                  measureTimingWindow(event.currentTarget)
                }}
                onMouseLeave={() => hoverTimingRow(undefined)}
              >
                <div class="oc-trend-canvas" style={{ width: `${timingTrendRows().length * (TREND_BAR + TREND_GAP)}px` }}>
                  <div class="oc-trend-grid">
                    <div class="oc-trend-grid-line oc-trend-grid-0" />
                    <div class="oc-trend-grid-line oc-trend-grid-50" />
                    <div class="oc-trend-grid-line oc-trend-grid-100" />
                  </div>
                  <div class="oc-trend-plot">
                    <Show when={timingRender().from > 0}>
                      <div
                        style={{
                          width: `${timingRender().from * TREND_PITCH - TREND_GAP}px`,
                          "flex-shrink": 0,
                        }}
                      />
                    </Show>
                    <For each={timingTrendRows().slice(timingRender().from, timingRender().to + 1)}>
                      {(row) => {
                        const key = timingTrendKey(row)
                        const selectedBar = () =>
                          "id" in row ? selectedStep()?.id === row.id : selectedStep()?.turn === row.turn
                        return (
                          <button
                            type="button"
                            class="oc-trend-bar oc-trend-bar-stack" classList={{ "oc-trend-bar-active": timingHover() === key || selectedBar() }}
                            title={`${timingTrendLabel(row)} · ${span(Math.max(0, row.wall - row.question - row.delegation))}${row.question > 0 ? ` (${ctx.t("timing.questionExcluded", { value: span(row.question) })})` : ""}${row.delegation > 0 ? ` (${ctx.t("timing.delegationExcluded", { value: span(row.delegation) })})` : ""} · ${fmt(row.rate)} tok/s`}
                            onMouseEnter={() => hoverTimingRow(key)}
                            onClick={() => {
                              hoverTimingRow(key)
                              const id = trendKeyOfTiming(row)
                              if (id !== undefined) selectStep(id)
                            }}
                          >
                            <For each={timingSegmentsOf(row)}>
                              {(segment) => (
                                <div
                                  class="oc-ctx-hover"
                                  style={{
                                    height: `${Math.max(1, (segment.ms / timingTrendMax()) * 100)}%`,
                                    background: segment.color,
                                  }}
                                />
                              )}
                            </For>
                          </button>
                        )
                      }}
                    </For>
                    <Show when={timingRender().to < timingTrendRows().length - 1}>
                      <div
                        style={{
                          width: `${(timingTrendRows().length - 1 - timingRender().to) * TREND_PITCH - TREND_GAP}px`,
                          "flex-shrink": 0,
                        }}
                      />
                    </Show>
                  </div>
                  <div class="oc-trend-turns" onMouseLeave={() => hoverTimingRow(undefined)}>
                    <For each={timingTrendGroups()}>
                      {(group) => (
                        <button
                          type="button"
                          class="oc-ctx-hover oc-trend-turn"
                          classList={{ "oc-trend-turn-active": timingTrendActive()?.turn === group.turn }} style={{ width: `${group.count * (TREND_BAR + TREND_GAP) - TREND_GAP}px` }}
                          title={
                            timingGranularity() === "turn"
                              ? ctx.t("timing.turnLabel", { turn: String(group.turn), steps: String(timingGroupSteps(group)) })
                              : ctx.t("trend.turnLabel", { turn: String(group.turn), steps: String(group.count) })
                          }
                          onMouseEnter={() => hoverTimingRow(group.key)}
                          onClick={() => {
                            const row = timingTrendRows().find((entry) => timingTrendKey(entry) === group.key)
                            const id = row === undefined ? undefined : trendKeyOfTiming(row)
                            if (id !== undefined) selectStep(id)
                          }}
                        >
                          T{group.turn}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>
            </div>
            </Show>
            <Show when={timingOverview()}>
              <div class="oc-row-gap-8">
                <div class="oc-trend-axis oc-trend-axis-flush">
                  <For each={timingRibbonAxis()}>{(label) => <span>{label}</span>}</For>
                </div>
                <svg
                  viewBox={`0 0 1000 ${TREND_HEIGHT}`}
                  preserveAspectRatio="none"
                  class="oc-trend-chart-box"
                  onMouseMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
                    const index = Math.round(ratio * Math.max(0, timingTrendRows().length - 1))
                    const row = timingTrendRows()[index]
                    if (row !== undefined) hoverTimingRow(timingTrendKey(row))
                  }}
                  onMouseLeave={() => hoverTimingRow(undefined)}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
                    const index = Math.round(ratio * Math.max(0, timingTrendRows().length - 1))
                    const row = timingTrendRows()[index]
                    const id = row === undefined ? undefined : trendKeyOfTiming(row)
                    if (id !== undefined) selectStep(id)
                  }}
                >
                  <For each={timingRibbon().polygons}>
                    {(polygon) => <polygon points={polygon.points} fill={polygon.color} opacity="0.85" />}
                  </For>
                  <line
                    x1={timingRibbonMarker() ?? 0}
                    x2={timingRibbonMarker() ?? 0}
                    y1={0}
                    y2={TREND_HEIGHT}
                    stroke="currentColor"
                    opacity="0.4"
                    stroke-width="1"
                  />
                  <For each={[0.25, 0.5, 0.75, 1]}>
                    {(fraction) => (
                      <line
                        x1={fraction * 1000}
                        x2={fraction * 1000}
                        y1={0}
                        y2={TREND_HEIGHT}
                        stroke="currentColor"
                        opacity="0.15"
                        stroke-dasharray="3 3"
                      />
                    )}
                  </For>
                </svg>
              </div>
            </Show>
          </Show>
        </Section>
    </>
  )
}
