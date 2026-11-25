import { For, Show, type Accessor } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { fmt, percent, span, type TimingStats, type ToolRow } from "../../shared/report.ts"
import { Section, Stat } from "./section.tsx"

export interface TimingCategorySlice {
  readonly key: string
  readonly label: string
  readonly ms: number
  readonly color: string
  readonly count?: string
}

export interface TimingSectionProps {
  readonly timing: Accessor<TimingStats>
  readonly activeTiming: Accessor<number>
  readonly categories: Accessor<TimingCategorySlice[]>
  readonly share: (value: number) => string
  readonly sessionSpan: Accessor<number>
  readonly topTools: Accessor<ToolRow[]>
}

export function TimingSection(props: TimingSectionProps) {
  const ctx = usePlugin()
  return (
    <Section title={ctx.t("timing.title")}>
      <div class="oc-hero">
        <div class="oc-hero-block">
          <span class="oc-faint">{ctx.t("timing.activeTitle")}</span>
          <span class="oc-hero-value">{span(props.activeTiming())}</span>
          <Show when={props.timing().question > 0}>
            <span class="oc-faint">{ctx.t("timing.questionExcluded", { value: span(props.timing().question) })}</span>
          </Show>
          <Show when={props.timing().delegation > 0}>
            <span class="oc-faint">{ctx.t("timing.delegationExcluded", { value: span(props.timing().delegation) })}</span>
          </Show>
        </div>
        <div class="oc-hero-block">
          <span class="oc-faint">{ctx.t("timing.rateTitle")}</span>
          <span class="oc-hero-value">{fmt(props.timing().rate)} tok/s</span>
          <span class="oc-faint">{ctx.t("timing.outputLine", { output: fmt(props.timing().decoded) })}</span>
        </div>
        <div class="oc-hero-block">
          <span class="oc-faint">{ctx.t("timing.ttftTitle")}</span>
          <span class="oc-hero-value">
            {props.timing().ttftAvg === undefined ? "—" : span(props.timing().ttftAvg ?? 0)}
          </span>
          <span class="oc-faint">
            {ctx.t("timing.ttftCoverage", {
              known: String(props.timing().ttftSteps),
              total: String(props.timing().steps),
            })}
          </span>
        </div>
      </div>
      <div class="oc-muted">{ctx.t("timing.distribution")}</div>
      <div class="oc-segments">
        <For each={props.categories()}>
          {(row) => <div title={`${row.label} ${span(row.ms)}`} style={{ width: props.share(row.ms), background: row.color }} />}
        </For>
      </div>
      <div class="oc-stats">
        <For each={props.categories()}>
          {(row) => (
            <Stat
              label={row.label}
              value={span(row.ms)}
              hint={[percent(row.ms, props.timing().wall), row.count].filter((part) => part !== undefined).join(" · ")}
              color={row.color}
            />
          )}
        </For>
      </div>
      <div class="oc-muted">{ctx.t("timing.ttftNote")}</div>
      <div class="oc-muted">
        {ctx.t("timing.note", { span: props.sessionSpan() > 0 ? span(props.sessionSpan()) : "—" })}
      </div>

      <div class="oc-muted">{ctx.t("timing.toolsTitle")}</div>
      <Show when={props.topTools().length > 0} fallback={<span class="oc-muted">{ctx.t("timing.toolsEmpty")}</span>}>
        <div class="oc-table">
          <For each={props.topTools()}>
            {(tool) => (
              <div class="oc-table-row">
                <span class="oc-cell-name">{tool.name}</span>
                <span class="oc-cell-tail">
                  {tool.calls}× · {span(tool.total)} · p50 {span(tool.p50)}
                  <Show when={tool.failed > 0}>
                    <span class="oc-text-bad"> · {String(tool.failed)} failed</span>
                  </Show>
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </Section>
  )
}
