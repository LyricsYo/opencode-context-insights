import { For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { fmt, percent } from "../../shared/report.ts"
import { CATEGORY_COLOR } from "../colors.ts"
import { BrowserRowView, Section } from "./common.tsx"
import { createTrendModel } from "../models/trend.ts"
import { createTimingModel } from "../models/timing.ts"
import { createBrowserModel } from "../models/browser.ts"
import { createSessionModel } from "../models/session.ts"
import { TOOL_SORTS } from "../panelSupport.ts"
import type { BrowserUi } from "./browserPanel.tsx"

export interface ContextBrowserSectionProps {
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

export function ContextBrowserSection(props: ContextBrowserSectionProps) {
  const ctx = usePlugin()
  const { browserGroups, browserTotal, browserProvider, browserDeltas, signed, browserOpenRows, browserOpenTokens, browserFlatRows, browserFlatTokens, browserOpenShown, browserFlatShown } = props.browser
  const { setBrowserRowQuery, selectedStep, browserStep, headerLoading, browserOpen, setBrowserFlat, setBrowserOpen, browserLive, setBrowserLive, setSelected, browserDelta, headerError, browserFocus, browserAll, setBrowserAll, setBrowserFocus, stepOptions, trendPreviewStep, setBrowserDelta, loadingHistory, openBrowserGroup, toggleBrowserGroup, browserRowQuery, toolSort, setToolSort, browserQuery, setBrowserQuery, header, selectedID, browserFlat } = props.ui
  return (
    <>
        <Section
          ref={props.attachBrowserAnchor}
          title={ctx.t("browser.title")}
          hint={
            browserStep()
              ? ctx.t("browser.stepHint", {
                  step: `T${browserStep()?.turn ?? "?"} S${browserStep()?.step ?? "?"}`,
                  tokens: fmt(browserTotal()),
                })
              : ctx.t("browser.liveHint", { tokens: fmt(browserTotal()) })
          }
          scroll
          scrollKey="browser"
          toolbar={
            <div class="oc-toolbar">
              <select
              ref={props.attachBrowserSelect}
              class="oc-select"
              value={browserLive() ? "live" : (selectedID() ?? "")}
              onChange={(event) => {
                const value = event.currentTarget.value
                if (value === "live") {
                  setBrowserLive(true)
                  setSelected(undefined)
                } else {
                  setBrowserLive(false)
                  setSelected(value)
                }
                setBrowserOpen(undefined)
                setBrowserRowQuery("")
                setBrowserFocus(undefined)
              }}
            >
              <option value="live">{ctx.t("browser.live")}</option>
              <For each={stepOptions()}>{(option) => <option value={option.id}>{option.label}</option>}</For>
            </select>
            <Show when={trendPreviewStep()}>
              {(step) => (
                <span
                  class="oc-chip oc-chip-accent"
                  title={ctx.t("browser.previewHint")}
                >
                  {ctx.t("browser.preview", { step: `T${step().turn} S${step().step}` })}
                </span>
              )}
            </Show>
            <button
              type="button"
              class="oc-ctx-hover oc-toggle" classList={{ "oc-toggle-active": browserFlat() }}
              onClick={() => setBrowserFlat((value) => !value)}
            >
              {ctx.t("browser.flat")}
            </button>
            <Show when={!browserFlat() && !browserLive() && selectedStep()}>
              <span class="oc-segment" title={ctx.t("browser.deltaTip")}>
                <For each={["off", "step", "turn"] as const}>
                  {(mode) => (
                    <button
                      type="button"
                      class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": browserDelta() === mode }}
                      onClick={() => setBrowserDelta(mode)}
                    >
                      {ctx.t(`browser.delta.${mode}`)}
                    </button>
                  )}
                </For>
              </span>
            </Show>
            <Show when={browserProvider() !== undefined && browserProvider()! > 0}>
              <span class="oc-faint">{ctx.t("browser.provider", { tokens: fmt(browserProvider()!) })}</span>
            </Show>
            <Show when={browserTotal() > 0}>
              <span class="oc-faint">{ctx.t("browser.total", { tokens: fmt(browserTotal()) })}</span>
            </Show>
            </div>
          }
        >
          <Show when={loadingHistory()}>
            <div class="oc-muted">{ctx.t("browser.loadingHistory")}</div>
          </Show>
          <Show when={headerLoading()}>
            <div class="oc-muted">{ctx.t("header.loading")}</div>
          </Show>
          <Show when={!headerLoading() && headerError()}>
            <div class="oc-muted oc-text-bad">{ctx.t("header.error")}</div>
          </Show>
          <Show when={!browserFlat()}>
            <div class="oc-bar">
              <For each={browserGroups().filter((group) => group.tokens > 0)}>
                {(group) => (
                  <button
                    type="button"
                    class="oc-ctx-hover oc-bar-seg"
                    title={`${ctx.t(`category.${group.key}`)} ≈${fmt(group.tokens)}`}
                    style={{ width: `${(group.tokens / Math.max(1, browserTotal())) * 100}%`, background: CATEGORY_COLOR[group.key] }}
                    onClick={() => openBrowserGroup(group.key)}
                  />
                )}
              </For>
            </div>
            <div class="oc-table">
              <For each={browserGroups()}>
                {(group) => (
                  <div>
                    <button
                      type="button"
                      class="oc-ctx-hover oc-cat-row"
                      classList={{ "oc-cat-row-active": browserOpen() === group.key }} style={{ opacity: group.rows.length === 0 ? 0.45 : 1, cursor: group.rows.length === 0 ? "default" : "pointer" }}
                      disabled={group.rows.length === 0}
                      onClick={() => toggleBrowserGroup(group.key)}
                    >
                      <span class="oc-cat-chevron">{browserOpen() === group.key ? "▾" : "▸"}</span>
                      <span class="oc-dot" style={{ background: CATEGORY_COLOR[group.key] }} />
                      <span class="oc-entry-name">{ctx.t(`category.${group.key}`)}</span>
                      <span class="oc-row-stamp">{ctx.t("browser.items", { count: String(group.rows.length) })}</span>
                      <span class="oc-entry-tokens">
                        ≈{fmt(group.tokens)} · {percent(group.tokens, browserTotal())}
                      </span>
                      <Show when={browserDelta() !== "off" && browserDeltas()[group.key]}>
                        {(delta) => (
                          <Show when={delta().tokens !== 0 || delta().items !== 0}>
                            <span class="oc-delta-chip" title={ctx.t("browser.deltaTip")}>
                              <Show when={delta().items !== 0}>
                                <span classList={{ "oc-delta-up": delta().items > 0, "oc-delta-down": !(delta().items > 0) }}>
                                  {`${delta().items > 0 ? "+" : "−"}${Math.abs(delta().items)}`}
                                </span>
                              </Show>
                              <span classList={{ "oc-delta-up": delta().tokens > 0, "oc-delta-down": !(delta().tokens > 0) }}>
                                {signed(delta().tokens)}
                              </span>
                            </span>
                          </Show>
                        )}
                      </Show>
                    </button>
                    <Show when={browserOpen() === group.key}>
                      <div class="oc-cat-body">
                        <div class="oc-toolbar">
                          <input
                            class="oc-search"
                            value={browserRowQuery()}
                            placeholder={ctx.t("browser.search.category")}
                            onInput={(event) => setBrowserRowQuery(event.currentTarget.value)}
                          />
                          <span class="oc-faint">
                            {ctx.t("browser.items", { count: String(browserOpenRows().length) })} · ≈{fmt(browserOpenTokens())}
                          </span>
                          <Show when={group.key === "tools"}>
                            <For each={TOOL_SORTS}>
                              {(sort) => (
                                <button
                                  type="button"
                                  class="oc-ctx-hover oc-toggle" classList={{ "oc-toggle-active": toolSort() === sort }}
                                  onClick={() => setToolSort(sort)}
                                >
                                  {ctx.t(`browser.sort.${sort}`)}
                                </button>
                              )}
                            </For>
                          </Show>
                        </div>
                        <Show
                          when={browserOpenRows().length > 0}
                          fallback={<span class="oc-muted">{ctx.t("browser.emptyGroup")}</span>}
                        >
                          <For each={browserOpenShown()}>
                            {(row) => <BrowserRowView row={row} category={group.key} focused={browserFocus() === row.id} />}
                          </For>
                          <Show when={!browserAll() && browserOpenRows().length > browserOpenShown().length}>
                            <button type="button" class="oc-toggle" onClick={() => setBrowserAll(true)}>
                              {ctx.t("browser.showAll", { count: String(browserOpenRows().length) })}
                            </button>
                          </Show>
                        </Show>
                      </div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
          <Show when={browserFlat()}>
            <div class="oc-toolbar">
              <input
                class="oc-search"
                value={browserQuery()}
                placeholder={ctx.t("browser.search.flat")}
                onInput={(event) => setBrowserQuery(event.currentTarget.value)}
              />
              <span class="oc-faint">
                {ctx.t("browser.items", { count: String(browserFlatRows().length) })} · ≈{fmt(browserFlatTokens())}
              </span>
            </div>
            <Show
              when={browserFlatRows().length > 0}
              fallback={<span class="oc-muted">{ctx.t("browser.noMatch")}</span>}
            >
              <div class="oc-table">
                <For each={browserFlatShown()}>
                  {({ row, category }) => <BrowserRowView row={row} category={category} showCategory focused={browserFocus() === row.id} />}
                </For>
              </div>
              <Show when={!browserAll() && browserFlatRows().length > browserFlatShown().length}>
                <button type="button" class="oc-toggle" onClick={() => setBrowserAll(true)}>
                  {ctx.t("browser.showAll", { count: String(browserFlatRows().length) })}
                </button>
              </Show>
            </Show>
          </Show>
          <Show when={!headerLoading() && !headerError() && header() === null && !browserFlat()}>
            <div class="oc-muted">{ctx.t("header.empty")}</div>
          </Show>
          <div class="oc-faint">{ctx.t("browser.note")}</div>
        </Section>
    </>
  )
}
