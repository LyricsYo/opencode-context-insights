import { For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { clock, fmt } from "../../shared/report.ts"
import { LIST_PAGE, growOnScroll } from "../paging.ts"
import { Section } from "./common.tsx"
import { createTrendModel } from "../models/trend.ts"
import { createTimingModel } from "../models/timing.ts"
import { createBrowserModel } from "../models/browser.ts"
import { createSessionModel } from "../models/session.ts"
import { FILE_FILTERS, FILE_SORTS, fileGlyphOf, splitFilePath, previewableFile } from "../panelSupport.ts"
import type { BrowserUi } from "./browserPanel.tsx"

export interface FilesSectionProps {
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

export function FilesSection(props: FilesSectionProps) {
  const ctx = usePlugin()
  const { shownFiles, fileKindCounts, fileLimit, setFileOpsLimit, fileOpsLimit, stepStampByID, fileHint, fileFilter, setFileFilter, fileQuery, setFileQuery, fileSort, setFileSort, fileGroups, fileOpen, fileMissing, setFileOpen, focusFileOp, setFileLimit, previewFile } = props.ui
  return (
    <>
        <Section
          title={ctx.t("files.title")}
          hint={fileHint()}
          scroll
          scrollKey="files"
          onScroll={(event) =>
            growOnScroll(event, fileLimit(), shownFiles().length, setFileLimit)
          }
          toolbar={
            <div class="oc-file-toolbar">
              <div class="oc-toolbar">
                <For each={FILE_FILTERS}>
                  {(kind) => (
                    <button
                      type="button"
                      class="oc-ctx-hover oc-toggle" classList={{ "oc-toggle-active": fileFilter() === kind }}
                      title={ctx.t("files.chipTip", {
                        files: String(fileKindCounts()[kind].files),
                        ops: String(fileKindCounts()[kind].ops),
                      })}
                      onClick={() => setFileFilter((current) => (current === kind ? "all" : kind))}
                    >
                      {ctx.t(`files.kind.${kind}`)}
                      <span class="oc-event-kind-count">{fileKindCounts()[kind].ops}</span>
                    </button>
                  )}
                </For>
              </div>
              <div class="oc-toolbar">
                <input
                  class="oc-search"
                  value={fileQuery()}
                  placeholder={ctx.t("files.search")}
                  onInput={(event) => setFileQuery(event.currentTarget.value)}
                />
                <For each={FILE_SORTS}>
                  {(sort) => (
                    <button
                      type="button"
                      class="oc-ctx-hover oc-toggle" classList={{ "oc-toggle-active": fileSort() === sort }}
                      onClick={() => setFileSort(sort)}
                    >
                      {ctx.t(`files.sort.${sort}`)}
                    </button>
                  )}
                </For>
              </div>
            </div>
          }
        >
          <Show when={fileGroups().length > 0} fallback={<span class="oc-muted">{ctx.t("files.empty")}</span>}>
            <Show when={shownFiles().length > 0} fallback={<span class="oc-muted">{ctx.t("files.noMatch")}</span>}>
              <For each={shownFiles().slice(0, fileLimit())}>
                {(file) => {
                  const glyph = fileGlyphOf(file.path)
                  const parts = splitFilePath(file.path)
                  const open = () => fileOpen() === file.path
                  const missing = () => fileMissing().get(file.path) === false
                  const previewable = () => !missing() && previewableFile(file.path)
                  return (
                    <div>
                      <button
                        type="button"
                        class="oc-ctx-hover oc-file-jump oc-file-row"
                        classList={{ "oc-file-row-open": open() }}
                        title={file.path}
                        onClick={() => {
                          setFileOpen(open() ? undefined : file.path)
                          setFileOpsLimit(LIST_PAGE)
                        }}
                      >
                        <span class="oc-file-chevron">{open() ? "▾" : "▸"}</span>
                        <span
                          class="oc-file-glyph" style={{ color: glyph.color, background: `color-mix(in srgb, ${glyph.color} 16%, transparent)` }}
                        >
                          {glyph.label}
                        </span>
                        <span class="oc-file-path">
                          <span class="oc-file-dir">{parts.dir}</span>
                          <Show
                            when={previewable()}
                            fallback={
                              <b
                                title={missing() ? ctx.t("files.missing") : undefined}
                                classList={{ "oc-missing": missing() }}
                              >
                                {parts.base}
                              </b>
                            }
                          >
                            <span
                              class="oc-file-link"
                              role="button"
                              tabIndex={0}
                              title={ctx.t("files.preview")}
                              onClick={(event) => {
                                event.stopPropagation()
                                previewFile(file.path)
                              }}
                              onKeyDown={(event) => {
                                if (event.key !== "Enter" && event.key !== " ") return
                                event.preventDefault()
                                event.stopPropagation()
                                previewFile(file.path)
                              }}
                            >
                              <b>{parts.base}</b>
                            </span>
                          </Show>
                        </span>
                        <Show when={file.reads > 0}>
                          <span class="oc-file-badge oc-text-accent" title={ctx.t("files.kind.read")}>
                            R{fmt(file.reads)}
                          </span>
                        </Show>
                        <Show when={file.writes > 0}>
                          <span class="oc-file-badge oc-text-good" title={ctx.t("files.kind.write")}>
                            W{fmt(file.writes)}
                          </span>
                        </Show>
                        <Show when={file.searches > 0}>
                          <span class="oc-file-badge oc-text-warn" title={ctx.t("files.kind.search")}>
                            S{fmt(file.searches)}
                          </span>
                        </Show>
                        <Show when={file.additions + file.deletions > 0}>
                          <span class="oc-file-delta">
                            {file.additions > 0 ? <span class="oc-text-good">+{fmt(file.additions)}</span> : null}
                            {file.deletions > 0 ? <span class="oc-text-bad"> −{fmt(file.deletions)}</span> : null}
                          </span>
                        </Show>
                        <span class="oc-event-time">{clock(file.ops[0]?.at ?? 0)}</span>
                      </button>
                      <Show when={open()}>
                        <div class="oc-file-ops">
                          <For each={file.ops.slice(0, fileOpsLimit())}>
                            {(op) => {
                              const stampRow = stepStampByID().get(op.messageID)
                              const outcome =
                                op.kind === "write"
                                  ? `+${fmt(op.additions)} −${fmt(op.deletions)}`
                                  : op.kind === "read"
                                    ? op.lines !== undefined
                                      ? ctx.t("files.lines", { n: fmt(op.lines) })
                                      : op.status
                                    : op.hits !== undefined
                                      ? ctx.t("files.matches", { n: fmt(op.hits) })
                                      : op.status
                              return (
                                <button
                                  type="button"
                                  class="oc-file-op-row"
                                  title={ctx.t("files.open")}
                                  onClick={() => focusFileOp(op.messageID, op.path)}
                                >
                                  <span class="oc-entry-kind">{ctx.t(`file.${op.kind}`)}</span>
                                  <span class="oc-file-op-tool">{op.tool}</span>
                                  <span class="oc-file-op-detail">{op.detail ?? ""}</span>
                                  <span class="oc-file-op-tail">
                                    <span>{outcome}</span>
                                    <span>{clock(op.at)}</span>
                                    {stampRow !== undefined ? <span>{`T${stampRow.turn} S${stampRow.step}`}</span> : null}
                                  </span>
                                  <Show when={op.status === "failed" || op.status === "error"}>
                                    <span class="oc-file-op-error" />
                                  </Show>
                                </button>
                              )
                            }}
                          </For>
                          <Show when={file.ops.length > fileOpsLimit()}>
                            <button
                              type="button"
                              class="oc-ctx-hover oc-toggle"
                              onClick={() => setFileOpsLimit(file.ops.length)}
                            >
                              {ctx.t("browser.showAll", { count: String(file.ops.length) })}
                            </button>
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
