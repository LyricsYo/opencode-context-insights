import { For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { fmt, stamp } from "../../shared/report.ts"
import { Section } from "./common.tsx"
import { createTrendModel } from "../models/trend.ts"
import { createTimingModel } from "../models/timing.ts"
import { createBrowserModel } from "../models/browser.ts"
import { createSessionModel } from "../models/session.ts"
import type { BrowserUi } from "./browserPanel.tsx"

export interface CompactionSectionProps {
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

export function CompactionSection(props: CompactionSectionProps) {
  const ctx = usePlugin()
  const { compactions } = props.session
  const { focusCompaction } = props.ui
  return (
    <>
        <Section
          title={ctx.t("compaction.title")}
          hint={ctx.t("compaction.hint")}
          scroll
        >
          <Show when={compactions().length > 0} fallback={<span class="oc-muted">{ctx.t("compaction.empty")}</span>}>
            <div class="oc-table">
              <For each={compactions()}>
                {(row) => {
                  const reclaimed = row.reclaimed
                  return (
                  <button
                    type="button"
                    class="oc-compaction-row"
                    title={ctx.t("compaction.jump")}
                    onClick={() => focusCompaction(row)}
                  >
                    <span class="oc-compaction-stamp">{stamp(row.at)}</span>
                    <span class="oc-cell-name">
                      {row.reason === "auto" ? ctx.t("event.reason.auto") : ctx.t("event.reason.manual")}
                    </span>
                    <span class="oc-cell-tail">
                      {row.before !== undefined ? fmt(row.before) : "?"} →{" "}
                      {row.after !== undefined ? fmt(row.after) : "?"}
                      {reclaimed !== undefined ? (
                        <>
                          {" · "}
                          <span classList={{ "oc-text-good": reclaimed > 0 }}>
                            {reclaimed > 0 ? "-" : "+"}
                            {fmt(Math.abs(reclaimed))}
                          </span>
                        </>
                      ) : undefined}
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
