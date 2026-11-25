import { For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { clock, fmt, percent, span, stamp } from "../../shared/report.ts"
import { growOnScroll } from "../paging.ts"
import { Section } from "./common.tsx"
import { createTrendModel } from "../models/trend.ts"
import { createTimingModel } from "../models/timing.ts"
import { createBrowserModel } from "../models/browser.ts"
import { createSessionModel } from "../models/session.ts"
import { COMMAND_FILTERS, COMMAND_GLYPH, commandDurationColor } from "../panelSupport.ts"
import type { BrowserUi } from "./browserPanel.tsx"

export interface CommandsSectionProps {
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

export function CommandsSection(props: CommandsSectionProps) {
  const ctx = usePlugin()
  const { commandShown, stepStampByID, commandLimit, commandProgram, setCommandProgram, commandAttention, focusCommand, commandFilter, setCommandFilter, commandCounts, commandSort, setCommandSort, commandQuery, setCommandQuery, commands, commandOpen, setCommandOpen, setCommandLimit, commandSummary } = props.ui
  return (
    <>
        <Section
          title={ctx.t("commands.title")}
          hint={ctx.t("commands.hint", {
            runs: String(commandSummary().runs),
            time: span(commandSummary().totalMs),
            failed: String(commandSummary().failed),
            rate: percent(commandSummary().failed, Math.max(1, commandSummary().runs)),
          })}
          scroll
          scrollKey="commands"
          onScroll={(event) =>
            growOnScroll(event, commandLimit(), commandShown().length, setCommandLimit)
          }
          toolbar={
            <div class="oc-command-toolbar">
              <div class="oc-toolbar">
                <For each={COMMAND_FILTERS}>
                  {(kind) => (
                    <button
                      type="button"
                      class="oc-ctx-hover oc-toggle" classList={{ "oc-toggle-active": commandFilter() === kind }}
                      onClick={() => setCommandFilter((current) => (current === kind ? "all" : kind))}
                    >
                      {ctx.t(`cmds.filter.${kind}`)}
                      <span class="oc-event-kind-count">{commandCounts()[kind]}</span>
                    </button>
                  )}
                </For>
                <span class="oc-inline-end" />
                <For each={["latest", "slowest"] as const}>
                  {(sort) => (
                    <button
                      type="button"
                      class="oc-ctx-hover oc-toggle" classList={{ "oc-toggle-active": commandSort() === sort }}
                      title={ctx.t("cmds.sortTip")}
                      onClick={() => setCommandSort(sort)}
                    >
                      {ctx.t(`cmds.sort.${sort}`)}
                    </button>
                  )}
                </For>
              </div>
              <div class="oc-toolbar">
                <input
                  class="oc-search"
                  value={commandQuery()}
                  placeholder={ctx.t("cmds.search")}
                  onInput={(event) => {
                    setCommandProgram(undefined)
                    setCommandQuery(event.currentTarget.value)
                  }}
                />
                <select
                  class="oc-select oc-select-narrow"
                  onChange={(event) =>
                    setCommandProgram(event.currentTarget.value === "" ? undefined : event.currentTarget.value)
                  }
                >
                  <option value="" selected={commandProgram() === undefined}>
                    {ctx.t("cmds.allPrograms")}
                  </option>
                  <For each={commandSummary().programs}>
                    {(program) => (
                      <option value={program.name} selected={commandProgram() === program.name}>
                        {`${program.name} ×${program.count}`}
                      </option>
                    )}
                  </For>
                </select>
              </div>
            </div>
          }
        >
          <Show when={commands().length > 0} fallback={<span class="oc-muted">{ctx.t("commands.empty")}</span>}>
            <Show when={commandAttention().length > 0}>
              <div class="oc-command-attention">
                <span class="oc-attention-kind">{ctx.t("cmds.attention")}</span>
                <For each={commandAttention()}>
                  {(chip) => (
                    <button
                      type="button"
                      class="oc-ctx-hover oc-attention-chip"
                      classList={{ "oc-attention-chip-on": chip.on }}
                      title={ctx.t("cmds.attentionTip")}
                      onClick={chip.apply}
                    >
                      <span class="oc-attention-dot" />
                      <span class="oc-attention-kind">{chip.label}</span>
                      <Show when={chip.value !== ""}>
                        <span class="oc-attention-value">{chip.value}</span>
                      </Show>
                      <span class="oc-attention-count">{chip.count}</span>
                    </button>
                  )}
                </For>
              </div>
            </Show>
            <Show when={commandShown().length > 0} fallback={<span class="oc-muted">{ctx.t("commands.noMatch")}</span>}>
              <For each={commandShown().slice(0, commandLimit())}>
                {(row) => {
                  const open = () => commandOpen() === row.id
                  const glyph = COMMAND_GLYPH[row.status]
                  const stamp = stepStampByID().get(row.messageID)
                  const stampText = stamp === undefined ? "" : `T${stamp.turn} S${stamp.step}`
                  return (
                    <div>
                      <div class="oc-command-row" classList={{ "oc-command-row-open": open() }}>
                        <button
                          type="button"
                          class="oc-ctx-hover oc-command-toggle"
                          title={row.description ?? row.command}
                          onClick={() => setCommandOpen(open() ? undefined : row.id)}
                        >
                          <span class="oc-file-chevron">{open() ? "▾" : "▸"}</span>
                          <span class="oc-command-glyph" style={{ color: glyph.color }} title={ctx.t(glyph.label)}>
                            {glyph.glyph}
                          </span>
                          <Show when={row.nested}>
                            <span class="oc-command-tag">{ctx.t("cmds.tool.nested")}</span>
                          </Show>
                          <Show when={row.background}>
                            <span class="oc-command-tag">{ctx.t("cmds.bgBadge")}</span>
                          </Show>
                          <span class="oc-command-preview">{row.preview}</span>
                          <Show when={row.lines > 1}>
                            <span class="oc-command-badge">{ctx.t("cmds.lines", { n: fmt(row.lines) })}</span>
                          </Show>
                          <Show when={row.heredoc}>
                            <span class="oc-command-badge">{ctx.t("cmds.heredoc")}</span>
                          </Show>
                          <Show when={row.inline}>
                            <span class="oc-command-badge">{ctx.t("cmds.inline")}</span>
                          </Show>
                          <span
                            class="oc-command-duration" style={{ color: row.duration !== undefined ? commandDurationColor(row.duration) : "#c9a227" }}
                          >
                            {row.duration === undefined ? ctx.t("cmds.status.running") : span(row.duration)}
                          </span>
                        </button>
                        <button
                          type="button"
                          class="oc-command-time"
                          title={ctx.t("cmds.revealTip")}
                          onClick={() => focusCommand(row)}
                        >
                          {stampText !== "" ? `${stampText} · ` : ""}
                          {clock(row.at)}
                        </button>
                      </div>
                      <Show when={open()}>
                        <div class="oc-command-detail">
                          <div class="oc-command-facts">
                            <span>{ctx.t(glyph.label)}</span>
                            <Show when={row.exit !== undefined}>
                              <span>{ctx.t("cmds.exit", { n: String(row.exit) })}</span>
                            </Show>
                            <Show when={row.duration !== undefined}>
                              <span>{span(row.duration)}</span>
                            </Show>
                            <Show when={row.workdir !== undefined}>
                              <span class="oc-command-cwd" title={row.workdir}>
                                {row.workdir}
                              </span>
                            </Show>
                            <Show when={row.timeoutMs !== undefined}>
                              <span>{ctx.t("cmds.timeoutSet", { t: span(row.timeoutMs) })}</span>
                            </Show>
                            <Show when={row.outChars > 0}>
                              <span>
                                {ctx.t("cmds.output", { n: fmt(row.outChars) })}
                                {row.truncated ? ` · ${ctx.t("cmds.outTruncated")}` : ""}
                              </span>
                            </Show>
                            <Show when={stampText !== ""}>
                              <span>{stampText}</span>
                            </Show>
                            <button type="button" class="oc-ctx-hover oc-command-locate"  onClick={() => focusCommand(row)}>
                              {ctx.t("cmds.reveal")}
                            </button>
                          </div>
                          <pre class="oc-command-code" data-scroll-key={`command:${row.id}:code`}>
                            {row.command}
                          </pre>
                          <Show when={row.output !== ""} fallback={<span class="oc-muted">{ctx.t("cmds.result.empty")}</span>}>
                            <div class="oc-command-output-head">
                              {ctx.t("cmds.lines", { n: fmt(row.outLines) })} ·{" "}
                              {ctx.t("cmds.output", { n: fmt(row.outChars) })}
                            </div>
                            <pre class="oc-command-output" data-scroll-key={`command:${row.id}:output`}>
                              {row.output}
                            </pre>
                          </Show>
                        </div>
                      </Show>
                    </div>
                  )
                }}
              </For>
            </Show>
          </Show>
        </Section>
    </>
  )
}
