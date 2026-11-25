import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client"
import { buildBrowserGroups, fmt, groupDeltas, type BrowserGroup, type StepRow } from "../../shared/report.ts"
import type { HeaderDetail } from "../../shared/header.ts"
import { BROWSER_LIVE_MS, type PanelView } from "../panelSupport.ts"

export interface BrowserModelParams {
  readonly view: Accessor<PanelView>
  readonly browserStep: Accessor<StepRow | undefined>
  readonly browserLive: Accessor<boolean>
  readonly trendPreview: Accessor<string | undefined>
  readonly trendPreviewStep: Accessor<StepRow | undefined>
  readonly header: Accessor<HeaderDetail | null | undefined>
  readonly messages: Accessor<SessionMessageInfo[]>
  readonly structureTick: Accessor<number>
  readonly settleTick: Accessor<number>
  readonly browserDelta: Accessor<'off' | 'step' | 'turn'>
  readonly steps: Accessor<StepRow[]>
  readonly latestDone: Accessor<StepRow | undefined>
  readonly selectedStep: Accessor<StepRow | undefined>
  readonly browserOpen: Accessor<string | undefined>
  readonly browserAll: Accessor<boolean>
  readonly browserFlat: Accessor<boolean>
  readonly browserRowQuery: Accessor<string>
  readonly browserQuery: Accessor<string>
  readonly toolSort: Accessor<'size' | 'calls' | 'name'>
}

export function createBrowserModel(params: BrowserModelParams) {
  const { view, browserStep, browserLive, trendPreview, trendPreviewStep, header, messages, structureTick, settleTick, browserDelta, steps, latestDone, selectedStep, browserOpen, browserAll, browserFlat, browserRowQuery, browserQuery, toolSort } = params
  const browserGroupCache = new Map<string, BrowserGroup[]>()
  const browserGroupsFor = (stepID: string | undefined, live: boolean): BrowserGroup[] => {
    const detail = header()
    const list = messages()
    if (stepID === undefined || live) {
      return buildBrowserGroups(list, detail, stepID, live)
    }
    const tail = list.at(-1)
    // A previewed step may still be streaming: its row text grows without the list length changing.
    const tailText =
      tail !== undefined && tail.type === "assistant" && tail.id === stepID
        ? tail.content.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0)
        : 0
    const headerKey = detail == null ? "-" : `${detail.summary.systemHash}:${detail.summary.toolsHash}`
    const key = [stepID, String(list.length), headerKey, String(tailText)].join("|")
    const cached = browserGroupCache.get(key)
    if (cached !== undefined) return cached
    const groups = buildBrowserGroups(list, detail, stepID, live)
    browserGroupCache.set(key, groups)
    if (browserGroupCache.size > 24) browserGroupCache.delete(browserGroupCache.keys().next().value as string)
    return groups
  }
  /** Live grouping scans the whole request; throttle it while text streams. */
  const [browserLiveTick, setBrowserLiveTick] = createSignal(0)
  let browserLiveTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(() => {
    if (view() !== "browser" || !browserLive()) return
    settleTick()
    if (browserLiveTimer !== undefined) return
    browserLiveTimer = setTimeout(() => {
      browserLiveTimer = undefined
      setBrowserLiveTick((value) => value + 1)
    }, BROWSER_LIVE_MS)
  })
  onCleanup(() => {
    if (browserLiveTimer !== undefined) clearTimeout(browserLiveTimer)
  })
  const browserGroups = createMemo(() => {
    if (view() !== "browser") return []
    const stepID = browserStep()?.id
    const live = browserLive() && trendPreview() === undefined
    header()
    if (live) {
      structureTick()
      browserLiveTick()
    } else {
      settleTick()
    }
    return untrack(() => browserGroupsFor(stepID, live))
  })
  const browserTotal = createMemo(() => browserGroups().reduce((sum, group) => sum + group.tokens, 0))
  const browserProvider = createMemo(() =>
    trendPreview() ? trendPreviewStep()?.prompt : browserLive() ? latestDone()?.prompt : selectedStep()?.prompt,
  )
  const browserDeltaBase = createMemo(() => {
    const mode = browserDelta()
    if (mode === "off" || browserLive()) return undefined
    const current = browserStep()
    if (current === undefined) return undefined
    const rows = steps()
    const index = rows.findIndex((row) => row.id === current.id)
    if (index <= 0) return undefined
    if (mode === "step") return rows[index - 1]
    for (let at = index - 1; at >= 0; at--) {
      if (rows[at].turn < current.turn) return rows[at]
    }
    return undefined
  })
  const browserDeltaGroups = createMemo(() => {
    const base = browserDeltaBase()
    return base === undefined ? undefined : browserGroupsFor(base.id, false)
  })
  const browserDeltas = createMemo(() => groupDeltas(browserGroups(), browserDeltaGroups()))
  const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt(Math.abs(value))}`
  const browserRowsOf = (group: BrowserGroup) => {
    const needle = browserRowQuery().trim().toLowerCase()
    let rows = group.rows
    if (needle !== "") {
      rows = rows.filter((row) =>
        `${row.name} ${row.preview} ${row.text ?? ""} ${row.input ?? ""} ${row.output ?? ""} ${row.description ?? ""} ${row.schema ?? ""} ${row.files?.map((file) => file.name).join(" ") ?? ""}`
          .toLowerCase()
          .includes(needle),
      )
    }
    if (group.key === "tools") {
      const sort = toolSort()
      rows = [...rows].sort((left, right) =>
        sort === "calls"
          ? (right.calls ?? 0) - (left.calls ?? 0) || left.name.localeCompare(right.name)
          : sort === "size"
            ? right.tokens - left.tokens || left.name.localeCompare(right.name)
            : left.name.localeCompare(right.name),
      )
    }
    return rows
  }
  const browserOpenGroup = createMemo(() => browserGroups().find((group) => group.key === browserOpen()))
  const browserOpenRows = createMemo(() => {
    const group = browserOpenGroup()
    return group ? browserRowsOf(group) : []
  })
  const browserOpenTokens = createMemo(() => browserOpenRows().reduce((sum, row) => sum + row.tokens, 0))
  const browserFlatRows = createMemo(() => {
    if (!browserFlat()) return []
    const needle = browserQuery().trim().toLowerCase()
    const rows = browserGroups().flatMap((group) => group.rows.map((row) => ({ row, category: group.key })))
    const matched =
      needle === ""
        ? rows
        : rows.filter(({ row }) =>
            `${row.name} ${row.preview} ${row.text ?? ""} ${row.input ?? ""} ${row.output ?? ""} ${row.description ?? ""} ${row.schema ?? ""}`
              .toLowerCase()
              .includes(needle),
          )
    return matched.sort((left, right) =>
      Number(left.row.tail === true) - Number(right.row.tail === true) ||
      (right.row.position ?? 0) - (left.row.position ?? 0) ||
      right.row.at - left.row.at,
    )
  })
  const browserFlatTokens = createMemo(() => browserFlatRows().reduce((sum, { row }) => sum + row.tokens, 0))
  const browserOpenShown = createMemo(() => (browserAll() ? browserOpenRows() : browserOpenRows().slice(0, 200)))
  const browserFlatShown = createMemo(() => (browserAll() ? browserFlatRows() : browserFlatRows().slice(0, 200)))
  return {
    browserGroups, browserTotal, browserProvider, browserDeltaBase, browserDeltaGroups,
    browserDeltas, signed, browserRowsOf, browserOpenGroup, browserOpenRows, browserOpenTokens,
    browserFlatRows, browserFlatTokens, browserOpenShown, browserFlatShown,
  }
}
