import { For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { CATEGORY_ORDER } from "../../shared/estimate.ts"
import { clock, fmt, percent, span } from "../../shared/report.ts"
import { TREND_BAR, TREND_GAP, TREND_HEIGHT, TREND_PITCH } from "../styleMetrics.ts"
import { CATEGORY_COLOR, TREND_DURATION_COLOR } from "../colors.ts"
import { Dot, Section, TrendBriefChip, TrendBriefRow, TrendChartBar } from "./common.tsx"
import { createTrendModel } from "../models/trend.ts"
import { createTimingModel } from "../models/timing.ts"
import { createBrowserModel } from "../models/browser.ts"
import { createSessionModel } from "../models/session.ts"
import type { BrowserUi } from "./browserPanel.tsx"

export interface TrendSectionProps {
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

export function TrendSection(props: TrendSectionProps) {
  const ctx = usePlugin()
  const { steps, turnCount } = props.session
  const { trendRows, trendIndexOf, trendRender, trendMissingCount, trendDeltas, trendLegend, trendMaxima, trendDurationLabels, trendWidth, trendSelected, trendActive, trendRowLabel, trendRibbonMarker, trendActiveDelta, trendActiveNet, trendActiveStep, trendCacheRate, trendBrief, trendGroups, trendDurationLines, trendAxisLabels, trendRibbonAxisLabels, trendRibbon } = props.trend
  const { selectStep, hoverTrendRow, measureTrendWindow, focusBrief, setTrendAdaptive, setBrowserRowQuery, setTrendRibbonCat, trendRibbonCat, trendAdaptive, setTrendOverview, granularity, setGranularity, setTrendMode, trendMode, setBrowserFlat, setBrowserOpen, setTrendDuration, trendHover, turnStepCounts, trendDuration, trendOverview, rememberChartScroll } = props.ui
  return (
    <>
        <Section
          title={ctx.t("trend.title")}
          headerActions={
            <>
              <span class="oc-segment">
                <button
                  type="button"
                  class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": trendAdaptive() }}
                  title={ctx.t("trend.adaptiveHint")}
                  onClick={() => {
                    const on = !trendAdaptive()
                    setTrendAdaptive(on)
                    if (on) {
                      setTrendOverview(false)
                      props.refreshTrendWindow()
                    }
                  }}
                >
                  {ctx.t("trend.adaptive")}
                </button>
                <button
                  type="button"
                  class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": trendDuration() }}
                  onClick={() => setTrendDuration((value) => !value)}
                >
                  {ctx.t("trend.duration")}
                </button>
                <button
                  type="button"
                  class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": trendOverview() }}
                  onClick={() => {
                    const on = !trendOverview()
                    setTrendOverview(on)
                    if (on) setTrendAdaptive(false)
                  }}
                >
                  {ctx.t("trend.overview")}
                </button>
              </span>
              <span class="oc-trend-ctl">
                <span class="oc-segment">
                  <button
                    type="button"
                    class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": granularity() === "step" }}
                    onClick={() => setGranularity("step")}
                  >
                    {ctx.t("trend.steps")}
                  </button>
                  <button
                    type="button"
                    class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": granularity() === "turn" }}
                    onClick={() => setGranularity("turn")}
                  >
                    {ctx.t("trend.turns")}
                  </button>
                </span>
                <span class="oc-segment" title={ctx.t("trend.modeHint")}>
                  <button
                    type="button"
                    class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": trendMode() === "total" }}
                    onClick={() => setTrendMode("total")}
                  >
                    {ctx.t("trend.total")}
                  </button>
                  <button
                    type="button"
                    class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": trendMode() === "delta" }}
                    onClick={() => {
                      setTrendMode("delta")
                      if (!trendOverview()) setTrendAdaptive(true)
                    }}
                  >
                    {ctx.t("trend.delta")}
                  </button>
                </span>
              </span>
            </>
          }
        >
          <div class="oc-muted oc-trend-note">
            <span>{ctx.t("trend.counts", { turns: String(turnCount()), steps: String(steps().length) })}</span>
            <span>{ctx.t("trend.hint")}</span>
            <Show when={trendMissingCount() > 0}>
              <span class="oc-text-warn">
                {ctx.t("trend.headerMissingCount", { n: String(trendMissingCount()) })}
              </span>
            </Show>
          </div>
          <Show when={trendRows().length > 0} fallback={<span class="oc-muted">{ctx.t("trend.empty")}</span>}>
            <Show when={trendActive()}>
              {(row) => (
                <div class="oc-trend-detail">
                  <div class="oc-trend-meta">
                    <b>{trendRowLabel(row())}</b>
                    <span class="oc-faint">{clock(row().at)}</span>
                    <span>{ctx.t("trend.estimated", { value: fmt(row().total) })}</span>
                    <Show when={trendMode() === "delta"}>
                      <span classList={{ "oc-text-good": trendActiveNet() >= 0, "oc-text-bad": trendActiveNet() < 0 }}>
                        {trendActiveNet() >= 0 ? "+" : ""}
                        {fmt(trendActiveNet())}
                      </span>
                    </Show>
                    <span class="oc-faint">{span(row().duration)}</span>
                    <Show when={row().wait > 0}>
                      <span class="oc-faint">{ctx.t("timing.questionExcluded", { value: span(row().wait) })}</span>
                    </Show>
                    <Show when={row().delegation > 0}>
                      <span class="oc-faint">{ctx.t("timing.delegationExcluded", { value: span(row().delegation) })}</span>
                    </Show>
                    <Show when={row().headerMissing}>
                      <span class="oc-faint oc-text-warn">{ctx.t("trend.headerMissing")}</span>
                    </Show>
                  </div>
                  <div class="oc-hero">
                    <div class="oc-hero-block">
                      <span class="oc-faint">{ctx.t("trend.input")}</span>
                      <span class="oc-hero-value">{fmt(row().prompt)}</span>
                    </div>
                    <div class="oc-hero-block">
                      <span class="oc-faint">{ctx.t("trend.output")}</span>
                      <span class="oc-hero-value">{fmt(row().output)}</span>
                    </div>
                    <div class="oc-hero-block">
                      <span class="oc-faint">{ctx.t("trend.cacheRate")}</span>
                      <span class="oc-hero-value">{trendCacheRate()}</span>
                      <Show when={trendActiveStep()}>
                        {(step) => (
                          <span class="oc-faint">
                            {ctx.t("trend.cache", { read: fmt(step().cacheRead), write: fmt(step().cacheWrite) })}
                          </span>
                        )}
                      </Show>
                    </div>
                  </div>
                  <Show
                    when={trendMode() === "total"}
                    fallback={
                      <div class="oc-chip-row">
                        <For each={CATEGORY_ORDER.filter((category) => (trendActiveDelta()?.[category] ?? 0) !== 0)}>
                          {(category) => {
                            const value = () => trendActiveDelta()![category]
                            return (
                              <span class="oc-chip">
                                <Dot color={CATEGORY_COLOR[category]} />
                                <span class="oc-chip-name">{ctx.t(`category.${category}`)}</span>
                                <span class="oc-chip-value" classList={{ "oc-text-good": value() > 0, "oc-text-bad": value() <= 0 }}>
                                  {value() > 0 ? "+" : ""}
                                  {fmt(value())}
                                </span>
                              </span>
                            )
                          }}
                        </For>
                      </div>
                    }
                  >
                    <div class="oc-chip-row">
                      <For each={CATEGORY_ORDER.filter((category) => row().byCategory[category] > 0)}>
                        {(category) => (
                          <span class="oc-chip">
                            <Dot color={CATEGORY_COLOR[category]} />
                            <span class="oc-chip-name">{ctx.t(`category.${category}`)}</span>
                            <span class="oc-chip-value">{fmt(row().byCategory[category])}</span>
                            <span class="oc-chip-name">{percent(row().byCategory[category], row().total)}</span>
                          </span>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              )}
            </Show>
            <Show when={!trendOverview()}>
            <div class="oc-row-gap-8">
              <div class="oc-trend-axis">
                <For each={trendAxisLabels()}>{(label) => <span>{label}</span>}</For>
              </div>
              <div
                class="oc-trend-scroll"
                ref={(el) => props.attachTrendScroll(el)}
                onScroll={(event) => {
                  rememberChartScroll("trend", event.currentTarget)
                  measureTrendWindow(event.currentTarget)
                }}
                onMouseLeave={() => hoverTrendRow(undefined)}
              >
                <div class="oc-trend-canvas" style={{ width: `${trendWidth()}px` }}>
                  <div class="oc-trend-grid">
                    <div class="oc-trend-grid-line oc-trend-grid-0" />
                    <div class="oc-trend-grid-line oc-trend-grid-25" />
                    <div class="oc-trend-grid-line oc-trend-grid-50" />
                    <div class="oc-trend-grid-line oc-trend-grid-75" />
                    <div class="oc-trend-grid-line oc-trend-grid-100" />
                  </div>
                  <div class="oc-trend-plot">
                    <Show when={trendRender().from > 0}>
                      <div
                        style={{
                          width: `${trendRender().from * TREND_PITCH - TREND_GAP}px`,
                          "flex-shrink": 0,
                        }}
                      />
                    </Show>
                    <For each={trendRows().slice(trendRender().from, trendRender().to + 1)}>
                      {(row) => {
                        const at = () => trendIndexOf().get(row.id) ?? 0
                        return (
                          <TrendChartBar
                            row={row}
                            label={trendRowLabel(row)}
                            delta={trendDeltas()[at()]}
                            mode={trendMode()}
                            maxTotal={trendMaxima().maxTotal}
                            maxUp={trendMaxima().maxUp}
                            maxDown={trendMaxima().maxDown}
                            selected={trendSelected()?.id === row.id}
                            hovered={trendHover() === row.id}
                            onHover={hoverTrendRow}
                            onSelect={selectStep}
                            onPick={(category) => {
                              selectStep(row.id)
                              setBrowserFlat(false)
                              setBrowserOpen(category)
                              setBrowserRowQuery("")
                              props.scrollToBrowser()
                            }}
                          />
                        )
                      }}
                    </For>
                    <Show when={trendRender().to < trendRows().length - 1}>
                      <div
                        style={{
                          width: `${(trendRows().length - 1 - trendRender().to) * TREND_PITCH - TREND_GAP}px`,
                          "flex-shrink": 0,
                        }}
                      />
                    </Show>
                  </div>
                  <Show when={trendDuration() && trendDurationLines().length > 0}>
                    <svg
                      class="oc-trend-overlay"
                      style={{ width: `${trendWidth()}px`, height: `${TREND_HEIGHT}px` }}
                      viewBox={`0 0 ${trendWidth()} ${TREND_HEIGHT}`}
                      preserveAspectRatio="none"
                    >
                      <For each={trendDurationLines()}>
                        {(points) => (
                          <>
                            <polyline
                              points={points}
                              fill="none"
                              stroke="color-mix(in srgb, currentColor 55%, transparent)"
                              stroke-width="4.5"
                              opacity="0.35"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            />
                            <polyline
                              points={points}
                              fill="none"
                              stroke={TREND_DURATION_COLOR}
                              stroke-width="2.2"
                              opacity="0.95"
                              stroke-linecap="round"
                              stroke-linejoin="round"
                            />
                          </>
                        )}
                      </For>
                    </svg>
                  </Show>
                  <div class="oc-trend-turns" style={{ width: `${trendWidth()}px` }} onMouseLeave={() => hoverTrendRow(undefined)}>
                    <For each={trendGroups()}>
                      {(group) => (
                        <button
                          type="button"
                          class="oc-ctx-hover oc-trend-turn"
                          classList={{ "oc-trend-turn-active": trendActive()?.turn === group.turn }} style={{ width: `${group.count * (TREND_BAR + TREND_GAP) - TREND_GAP}px` }}
                          title={ctx.t("trend.turnLabel", {
                            turn: String(group.turn),
                            steps: String(turnStepCounts().get(group.turn) ?? group.count),
                          })}
                          onMouseEnter={() => hoverTrendRow(group.id)}
                          onClick={() => selectStep(group.id)}
                        >
                          T{group.turn}
                        </button>
                      )}
                    </For>
                  </div>
                </div>
              </div>
              <Show when={trendDuration()}>
                <div class="oc-trend-axis oc-trend-axis-left">
                  <For each={trendDurationLabels()}>{(label) => <span>{label}</span>}</For>
                </div>
              </Show>
            </div>
            </Show>
            <Show when={trendOverview()}>
              <div class="oc-row-gap-8">
                <div class="oc-trend-axis oc-trend-axis-flush">
                  <For each={trendRibbonAxisLabels()}>{(label) => <span>{label}</span>}</For>
                </div>
                <svg
                  viewBox={`0 0 1000 ${TREND_HEIGHT}`}
                  preserveAspectRatio="none"
                  class="oc-trend-chart-box"
                  onMouseMove={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
                    const index = Math.round(ratio * Math.max(0, trendRows().length - 1))
                    hoverTrendRow(trendRows()[index]?.id)
                  }}
                  onMouseLeave={() => {
                    hoverTrendRow(undefined)
                    setTrendRibbonCat(undefined)
                  }}
                  onClick={(event) => {
                    const rect = event.currentTarget.getBoundingClientRect()
                    const ratio = (event.clientX - rect.left) / Math.max(1, rect.width)
                    const index = Math.round(ratio * Math.max(0, trendRows().length - 1))
                    const row = trendRows()[index]
                    if (row) selectStep(row.id)
                  }}
                >
                  <For each={trendRibbon().polygons}>
                    {(polygon) => (
                      <polygon
                        points={polygon.points}
                        fill={CATEGORY_COLOR[polygon.category]}
                        opacity={trendRibbonCat() === undefined || trendRibbonCat() === polygon.category ? 0.85 : 0.25}
                        onMouseEnter={() => setTrendRibbonCat(polygon.category)}
                        onMouseLeave={() => setTrendRibbonCat(undefined)}
                      />
                    )}
                  </For>
                  <line
                    x1={trendRibbonMarker() ?? 0}
                    x2={trendRibbonMarker() ?? 0}
                    y1={0}
                    y2={TREND_HEIGHT}
                    stroke="currentColor"
                    opacity="0.4"
                    stroke-width="1"
                  />
                  <For each={trendRows().map((row, index) => ({ row, index })).filter((item) => item.row.afterCompaction)}>
                    {(item) => {
                      const count = trendRows().length
                      const x = count <= 1 ? 500 : (item.index / (count - 1)) * 1000
                      return <line x1={x} x2={x} y1={0} y2={TREND_HEIGHT} stroke="#c9a227" opacity="0.6" stroke-width="1" />
                    }}
                  </For>
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
              <div class="oc-muted">
                {ctx.t("trend.overviewNote", { count: String(trendRows().length), max: fmt(trendRibbon().max) })}
              </div>
            </Show>
          </Show>
          <Show when={trendLegend().length > 0 || trendDuration()}>
            <div class="oc-legend">
              <For each={trendLegend()}>
                {(category) => (
                  <div class="oc-legend-item">
                    <Dot color={CATEGORY_COLOR[category]} />
                    <span class="oc-legend-label">{ctx.t(`category.${category}`)}</span>
                  </div>
                )}
              </For>
              <Show when={trendDuration()}>
                <div class="oc-legend-item">
                  <span
                    style={{
                      width: "14px",
                      height: "2px",
                      "border-radius": "1px",
                      background: TREND_DURATION_COLOR,
                      "flex-shrink": 0,
                    }}
                  />
                  <span class="oc-legend-label">{ctx.t("trend.duration")}</span>
                </div>
              </Show>
            </div>
          </Show>
          <Show when={trendBrief()}>
            {(brief) => (
              <div class="oc-trend-brief">
                <TrendBriefRow label={ctx.t("trend.brief.user")}>
                  <Show when={brief().opener} fallback={<span class="oc-faint">{ctx.t("trend.brief.none")}</span>}>
                    {(entry) => (
                      <TrendBriefChip entry={entry()} onClick={() => focusBrief(entry(), trendActive()!.id, false)} />
                    )}
                  </Show>
                </TrendBriefRow>
                <TrendBriefRow label={ctx.t("trend.brief.in")}>
                  <Show when={brief().inputs.length > 0} fallback={<span class="oc-faint">{ctx.t("trend.brief.noInputs")}</span>}>
                    <For each={brief().inputs.slice(0, 6)}>
                      {(entry) => <TrendBriefChip entry={entry} onClick={() => focusBrief(entry, trendActive()!.id, false)} />}
                    </For>
                    <Show when={brief().inputs.length > 6}>
                      <span class="oc-faint">+{brief().inputs.length - 6}</span>
                    </Show>
                  </Show>
                </TrendBriefRow>
                <TrendBriefRow label={ctx.t("trend.brief.response")}>
                  <Show when={brief().response.length > 0} fallback={<span class="oc-faint">{ctx.t("trend.brief.noResponse")}</span>}>
                    <For each={brief().response.slice(0, 6)}>
                      {(entry) => <TrendBriefChip entry={entry} onClick={() => focusBrief(entry, trendActive()!.id, true)} />}
                    </For>
                    <Show when={brief().response.length > 6}>
                      <span class="oc-faint">+{brief().response.length - 6}</span>
                    </Show>
                  </Show>
                </TrendBriefRow>
              </div>
            )}
          </Show>
        </Section>
    </>
  )
}
