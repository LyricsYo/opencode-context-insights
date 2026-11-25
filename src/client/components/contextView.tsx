import { Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import { usePlugin, type PanelProps } from "@opencode/plugin/gui"
import { CATEGORY_ORDER, type Category, type Snapshot } from "../../shared/estimate.ts"
import { buildCost, type PriceBook } from "../../shared/cost.ts"
import { headerAt, type HeaderDetail, type HeaderSummary } from "../../shared/header.ts"
import { HOST_CONTRACT, REQUIRED_HOST_METHODS, type HostInfo } from "../../shared/host.ts"
import { buildTokenTurns, clock, compactionTrigger, EVENT_KINDS, fmt, groupFileOps, isQuestionTool, sessionTokenStats, SLOW_COMMAND_MS, span, stepComposition, summarizeCommands, timingOfRows, type CommandFilter, type CommandRow, type CommandSort, type CompactionRow, type EventKind, type EventRow, type FileRow, type StepBriefEntry, type StepTimingRow, type SurfaceKind, type TokenStepRow, type TokenTurnRow, type ToolScan, type TurnTimingRow } from "../../shared/report.ts"
import { ContextRpc } from "../../shared/rpc.ts"
import { LIST_PAGE } from "../paging.ts"
import { OverviewPanel, type OverviewPanelProps } from "./overviewPanel.tsx"
import { BrowserPanel, type BrowserUi } from "./browserPanel.tsx"
import { FleetPanel } from "./fleetPanel.tsx"
import { PanelHeader } from "./panelChrome.tsx"
import { TimingSection } from "./timingSection.tsx"
import { createFleetModel } from "../models/fleet.ts"
import { createTrendModel } from "../models/trend.ts"
import { createTimingModel } from "../models/timing.ts"
import { createBrowserModel } from "../models/browser.ts"
import { createSessionModel } from "../models/session.ts"
import { createFilePreview } from "../models/filePreview.ts"
import { createFleetLoader } from "../models/fleetLoader.ts"
import { loadHostPriceBook } from "../models/prices.ts"
import { PANEL_CSS } from "../panelCss.ts"
import { createScrollMemory } from "../scrollMemory.ts"
import { FileFilterKind, FileSortKind, TIMING_COLOR, isImagePath, splitFilePath, PanelView, panelMemoryOf, STEP_OPTION_MAX, NO_TOOL_SCAN, NO_TOKEN_TURNS, NO_TURN_COUNTS, NO_STEP_OPTIONS, NO_COST_STATS, NO_TIMING_STATS, NO_FILE_COUNTS, visibleWindow, revealScrollIndex, headerCache } from "../panelSupport.ts"

/** A brief chip opens the browser group that holds its entry. */
const BRIEF_CATEGORY: Record<SurfaceKind, Category> = {
  user: "user",
  skill: "skills",
  reply: "assistant",
  reasoning: "reasoning",
  tool: "toolResults",
  compaction: "injected",
  system: "injected",
  synthetic: "injected",
}

export function ContextView(props: PanelProps) {  const ctx = usePlugin()
  const [snapshot, setSnapshot] = createSignal<Snapshot>()
  const [revision, setRevision] = createSignal(0)
  const [loading, setLoading] = createSignal(false)
  const [view, setView] = createSignal<PanelView>(panelMemoryOf(props.session.id).view)
  const [selected, setSelected] = createSignal<string>()
  const [granularity, setGranularity] = createSignal<"step" | "turn">("step")
  const [browserLive, setBrowserLive] = createSignal(true)
  const [browserOpen, setBrowserOpen] = createSignal<Category>()
  const [browserQuery, setBrowserQuery] = createSignal("")
  const [browserRowQuery, setBrowserRowQuery] = createSignal("")
  const [browserFlat, setBrowserFlat] = createSignal(false)
  const [browserAll, setBrowserAll] = createSignal(false)
  const [browserDelta, setBrowserDelta] = createSignal<"off" | "step" | "turn">("off")
  const [browserFocus, setBrowserFocus] = createSignal<string>()
  const [toolSort, setToolSort] = createSignal<"size" | "calls" | "name">("size")
  const [eventLimit, setEventLimit] = createSignal(LIST_PAGE)
  const [fileLimit, setFileLimit] = createSignal(LIST_PAGE)
  const [commandLimit, setCommandLimit] = createSignal(LIST_PAGE)
  const [childrenLimit, setChildrenLimit] = createSignal(LIST_PAGE)
  const [fileFilter, setFileFilter] = createSignal<FileFilterKind>("all")
  const [fileSort, setFileSort] = createSignal<FileSortKind>("count")
  const [fileQuery, setFileQuery] = createSignal("")
  const [fileOpen, setFileOpen] = createSignal<string>()
  const [fileOpsLimit, setFileOpsLimit] = createSignal(LIST_PAGE)
  const [commandFilter, setCommandFilter] = createSignal<CommandFilter>("all")
  const [commandSort, setCommandSort] = createSignal<CommandSort>("latest")
  const [commandQuery, setCommandQuery] = createSignal("")
  const [commandProgram, setCommandProgram] = createSignal<string>()
  const [commandOpen, setCommandOpen] = createSignal<string>()
  const [loadedFor, setLoadedFor] = createSignal<string>()
  const [loadingHistory, setLoadingHistory] = createSignal(false)
  const [header, setHeader] = createSignal<HeaderDetail | null>()
  const [headerLoading, setHeaderLoading] = createSignal(false)
  const [headerError, setHeaderError] = createSignal<string>()
  const [headers, setHeaders] = createSignal<HeaderSummary[]>()
  const [trendMode, setTrendMode] = createSignal<"total" | "delta">("total")
  const [eventKinds, setEventKinds] = createSignal<EventKind[]>([...EVENT_KINDS])
  const [trendHover, setTrendHover] = createSignal<string>()
  const [trendPreview, setTrendPreview] = createSignal<string>()
  const [trendDuration, setTrendDuration] = createSignal(true)
  const [trendOverview, setTrendOverview] = createSignal(false)
  const [trendAdaptive, setTrendAdaptive] = createSignal(true)
  const [trendWindow, setTrendWindow] = createSignal<{ from: number; to: number }>()
  const [trendRibbonCat, setTrendRibbonCat] = createSignal<Category>()
  const [timingGranularity, setTimingGranularity] = createSignal<"step" | "turn">("step")
  const [timingAdaptive, setTimingAdaptive] = createSignal(true)
  const [timingOverview, setTimingOverview] = createSignal(false)
  const [timingWindow, setTimingWindow] = createSignal<{ from: number; to: number }>()
  const [timingHover, setTimingHover] = createSignal<string>()
  const [compactionConfig, setCompactionConfig] = createSignal<{ auto?: boolean; buffer?: string | number }>()
  const [priceBook, setPriceBook] = createSignal<PriceBook>()
  const [hostInfo, setHostInfo] = createSignal<HostInfo>()
  const [hostProbeFailed, setHostProbeFailed] = createSignal(false)

  onMount(() => {
    void props.session.server.client
      .rpc(ContextRpc)
      .hello({}, { location: { directory: props.session.directory } })
      .then((info) => setHostInfo(info as HostInfo))
      .catch(() => setHostProbeFailed(true))
    void loadHostPriceBook(() =>
      props.session.server.client.rpc(ContextRpc).prices({}, { location: { directory: props.session.directory } }),
    ).then((book) => {
      if (book !== undefined) setPriceBook(book)
    })
  })

  const hostStale = createMemo(() => {
    if (hostProbeFailed()) return true
    const info = hostInfo()
    if (info === undefined) return false
    const methods = info.methods
    if (!Array.isArray(methods)) return true
    return info.contract !== HOST_CONTRACT || REQUIRED_HOST_METHODS.some((name) => !methods.includes(name))
  })

  let browserAnchor: HTMLElement | undefined
  let browserSelect: HTMLSelectElement | undefined
  const sessionModel = createSessionModel({ props, view, headers, revision })
  const {
    data,
    info,
    messages,
    settleTick,
    setSettleTick,
    structureTick,
    streamTick,
    fleetLoadedTick,
    childStructureTick,
    bumpStructure,
    flushStructure,
    bumpChildStructure,
    bumpStream,
    bumpFleetLoaded,
    sessionIndex,
    steps,
    turnCount,
    latest,
    events,
    tokenSteps,
    tools,
    generated,
    children,
  } = sessionModel
  const fleetModel = createFleetModel({
    props, view, headers, priceBook, structureTick, childStructureTick, fleetLoadedTick, streamTick,
  })
  const {
    fleetPinned,
    setFleetPinned,
    fleetFocus,
    setFleetFocus,
    setFleetHover,
    fleetMode,
    setFleetMode,
    fleetTimelineFit,
    setFleetTimelineFit,
    setFleetNow,
    setFleetHeaders,
    fleetStageWidth,
    setFleetStageWidth,
    fleet,
    fleetRunning,
    fleetHues,
  } = fleetModel
  const lastAgent = createMemo(() => {
    const list = messages()
    for (let index = list.length - 1; index >= 0; index--) {
      const message = list[index]
      if (message.type === "assistant") return message.agent
    }
    return undefined
  })
  const modelInfo = createMemo(() => {
    const ref = info()?.model
    const location = props.session.location
    if (!ref || !location) return undefined
    return data()
      .location.model.list(location)
      ?.find((model) => model.providerID === ref.providerID && (model.id === ref.id || model.modelID === ref.id))
  })
  const limit = createMemo(() => modelInfo()?.limit.context)
  const outputLimit = createMemo(() => modelInfo()?.limit.output)
  const stepsByID = createMemo(() => new Map(steps().map((row) => [row.id, row])))
  const latestDone = createMemo(() => {
    const byID = stepsByID()
    const list = messages()
    for (let index = list.length - 1; index >= 0; index--) {
      const message = list[index]
      // Only a finished step with provider usage may drive the totals; a streaming request is ignored.
      if (message.type !== "assistant" || !message.tokens || message.time.completed === undefined) continue
      const row = byID.get(message.id)
      if (row) return row
    }
    return undefined
  })
  const tokens = createMemo(() => {
    const value = info()?.tokens
    return {
      input: value?.input ?? 0,
      output: value?.output ?? 0,
      read: value?.cache.read ?? 0,
      write: value?.cache.write ?? 0,
    }
  })
  const costStats = createMemo(() =>
    view() === "overview" ? buildCost(messages(), priceBook()) : NO_COST_STATS,
  )
  const selectedID = createMemo(() => selected() ?? latest()?.id)
  const selectedStep = createMemo(() => {
    const id = selectedID()
    return id === undefined ? undefined : stepsByID().get(id)
  })
  const trendPreviewStep = createMemo(() => steps().find((step) => step.id === trendPreview()))
  const browserStep = createMemo(() => trendPreviewStep() ?? (browserLive() ? undefined : selectedStep()))
  const headerTime = createMemo(() => {
    const preview = trendPreviewStep()
    if (preview) return preview.at
    // Overview shows the last provider-reported step, whatever the browser has selected.
    if (view() === "overview") return latestDone()?.at
    return view() === "browser" && browserLive() ? latest()?.at : selectedStep()?.at
  })
  // settle the hover briefly, like dsh-context, so scrubbing does not rebuild the browser per bar
  createEffect(() => {
    const id = trendHover()
    if (id === undefined) {
      setTrendPreview(undefined)
      return
    }
    const timer = setTimeout(() => setTrendPreview(id), 120)
    onCleanup(() => clearTimeout(timer))
  })
  /** stepComposition rebuilds the whole surface; reuse it while the step, log length and header version hold. */
  const compositionCache = new Map<string, ReturnType<typeof stepComposition>>()
  const tokenView = createMemo(() => {
    structureTick()
    const last = latestDone()
    const head = header()
    if (last === undefined) return undefined
    const headerKey = head === null ? "-" : head === undefined ? "?" : `${head.summary.systemHash}:${head.summary.toolsHash}`
    const key = `${last.id}|${messages().length}|${headerKey}`
    const cached = compositionCache.get(key)
    if (cached !== undefined) return cached
    const value = untrack(() => stepComposition(messages(), last.id, head))
    compositionCache.set(key, value)
    if (compositionCache.size > 8) compositionCache.delete(compositionCache.keys().next().value as string)
    return value
  })
  const currentRunning = createMemo(() => {
    const snap = snapshot()
    const last = latestDone()
    if (!snap || !last) return false
    // latestDone only returns steps whose provider usage is final, so the window is set.
    return snap.at > last.at + (last.duration as number)
  })
  /** Current Context and Token Stats share the last provider-reported step's composition. */
  const currentView = tokenView
  const currentUsed = createMemo(() => latestDone()?.prompt ?? 0)
  const currentScale = createMemo(() => {
    const total = currentView()?.total ?? 0
    return total > 0 && currentUsed() > 0 ? currentUsed() / total : 1
  })
  const currentCategories = createMemo(() =>
    CATEGORY_ORDER.filter((category) => (currentView()?.byCategory[category] ?? 0) > 0),
  )
  const currentFree = createMemo(() => Math.max(0, (limit() ?? 0) - currentUsed()))
  const currentTokens = (value: number) => Math.round(value * currentScale())
  const currentWidth = (tokens: number) => {
    const total = limit() ?? Math.max(1, currentUsed())
    return Math.min(100, ((tokens * currentScale()) / Math.max(1, total)) * 100)
  }
  const trigger = createMemo(() => compactionTrigger(limit(), compactionConfig()))
  const triggerPct = createMemo(() => {
    const value = trigger()
    const max = limit()
    return value && max ? (value.at / max) * 100 : undefined
  })
  const tokenTurns = createMemo(() => (view() === "browser" ? buildTokenTurns(tokenSteps()) : NO_TOKEN_TURNS))
  const turnStepCounts = createMemo(() => {
    if (view() !== "browser") return NO_TURN_COUNTS
    const counts = new Map<number, number>()
    for (const row of tokenSteps()) counts.set(row.turn, (counts.get(row.turn) ?? 0) + 1)
    return counts
  })
  const trendModel = createTrendModel({
    ctx, view, granularity, browserFlat, browserOpen, selectedID, selectedStep,
    tokenSteps, tokenTurns, turnStepCounts, steps, messages,
    trendMode, trendHover, trendWindow, trendAdaptive,
  })
  const { trendRows, trendSelected, clearBriefCache } = trendModel
  let trendScroll: HTMLDivElement | undefined
  let trendObserver: ResizeObserver | undefined
  let trendCount: number | undefined
  const measureTrendWindow = (el: HTMLDivElement) => {
    const next = visibleWindow(el, trendRows().length)
    setTrendWindow((prev) => (prev && next && prev.from === next.from && prev.to === next.to ? prev : next))
  }
  onCleanup(() => trendObserver?.disconnect())
  createEffect(() => {
    // Only a new bar (or a granularity switch) moves the view; a remount restores the saved offset.
    const count = trendRows().length
    queueMicrotask(() => {
      if (!trendScroll) return
      if (trendCount === undefined) {
        trendScroll.scrollLeft = panelMemoryOf(props.session.id).trendLeft ?? trendScroll.scrollWidth
      } else if (count !== trendCount) {
        trendScroll.scrollLeft = trendScroll.scrollWidth
      }
      trendCount = count
      measureTrendWindow(trendScroll)
    })
  })
  const attachTrendScroll = (el: HTMLDivElement) => {
    trendScroll = el
    trendObserver?.disconnect()
    trendObserver = new ResizeObserver(() => measureTrendWindow(el))
    trendObserver.observe(el)
    queueMicrotask(() => {
      if (!el.isConnected) return
      el.scrollLeft = panelMemoryOf(props.session.id).trendLeft ?? el.scrollWidth
      measureTrendWindow(el)
    })
  }
  const timingModel = createTimingModel({
    ctx, view, sessionIndex, timingGranularity, timingWindow, timingAdaptive, timingHover, selectedStep,
  })
  const { stepTiming, timingTrendRows, timingTrendKey, timingSelected } = timingModel
  let timingScroll: HTMLDivElement | undefined
  let timingObserver: ResizeObserver | undefined
  let timingCount: number | undefined
  const measureTimingWindow = (el: HTMLDivElement) => {
    const next = visibleWindow(el, timingTrendRows().length)
    setTimingWindow((prev) => (prev && next && prev.from === next.from && prev.to === next.to ? prev : next))
  }
  onCleanup(() => timingObserver?.disconnect())
  createEffect(() => {
    const count = timingTrendRows().length
    queueMicrotask(() => {
      if (!timingScroll) return
      if (timingCount === undefined) {
        timingScroll.scrollLeft = panelMemoryOf(props.session.id).timingLeft ?? timingScroll.scrollWidth
      } else if (count !== timingCount) {
        timingScroll.scrollLeft = timingScroll.scrollWidth
      }
      timingCount = count
      measureTimingWindow(timingScroll)
    })
  })
  const attachTimingScroll = (el: HTMLDivElement) => {
    timingScroll = el
    timingObserver?.disconnect()
    timingObserver = new ResizeObserver(() => measureTimingWindow(el))
    timingObserver.observe(el)
    queueMicrotask(() => {
      if (!el.isConnected) return
      el.scrollLeft = panelMemoryOf(props.session.id).timingLeft ?? el.scrollWidth
      measureTimingWindow(el)
    })
  }
  const timingKeyOfTrend = (row: TokenStepRow | TokenTurnRow) => {
    if (timingGranularity() === "turn") return `turn:${row.turn}`
    if ("step" in row) {
      return stepTiming().find((entry) => entry.turn === row.turn && entry.step === row.step)?.id
    }
    // A turn row carries its last step's id, which always has a timing row.
    return row.id
  }
  const trendKeyOfTiming = (row: StepTimingRow | TurnTimingRow) => {
    if (granularity() === "turn") return tokenTurns().find((entry) => entry.turn === row.turn)?.id
    if ("id" in row) return row.id
    return tokenTurns().find((entry) => entry.turn === row.turn)?.id
  }
  const revealTrend = (id: string | undefined) => {
    if (id === undefined || trendOverview() || trendScroll === undefined) return
    const rows = trendRows()
    revealScrollIndex(trendScroll, rows.findIndex((row) => row.id === id), rows.length)
  }
  const revealTiming = (key: string | undefined) => {
    if (key === undefined || timingOverview() || timingScroll === undefined) return
    const rows = timingTrendRows()
    revealScrollIndex(timingScroll, rows.findIndex((row) => timingTrendKey(row) === key), rows.length)
  }
  const hoverTrendRow = (id: string | undefined) => {
    setTrendHover(id)
    const row = id === undefined ? undefined : trendRows().find((entry) => entry.id === id)
    const key = row ? timingKeyOfTrend(row) : undefined
    setTimingHover(key)
    revealTiming(key)
  }
  const hoverTimingRow = (key: string | undefined) => {
    setTimingHover(key)
    const row = key === undefined ? undefined : timingTrendRows().find((entry) => timingTrendKey(entry) === key)
    const id = row ? trendKeyOfTiming(row) : undefined
    setTrendHover(id)
    revealTrend(id)
  }
  const selectStep = (id: string) => {
    setBrowserLive(false)
    setSelected(id)
    revealTrend(trendSelected()?.id)
    const timing = timingSelected()
    // A selectable step always has a timing row, so the timing chart can follow the selection.
    revealTiming(timingTrendKey(timing as StepTimingRow | TurnTimingRow))
  }
  const sessionSpan = createMemo(() => {
    const rows = steps()
    if (rows.length === 0) return 0
    const first = rows[0]
    const last = rows[rows.length - 1]
    return Math.max(0, last.at + (last.duration ?? 0) - first.at)
  })
  const topTools = createMemo(() =>
    tools()
      .filter((tool) => !isQuestionTool(tool.name))
      .sort((left, right) => right.total - left.total)
      .slice(0, 5),
  )
  const stepOptions = createMemo(() => {
    if (view() !== "browser") return NO_STEP_OPTIONS
    const rows = steps()
    const option = (step: (typeof rows)[number]) => ({
      id: step.id,
      label: `T${step.turn || "?"} S${step.step} · ${clock(step.at)} · ${fmt(step.prompt)}`,
    })
    if (rows.length <= STEP_OPTION_MAX) return rows.map(option)
    const newest = rows.length - STEP_OPTION_MAX
    const pinned = browserLive() ? undefined : selected()
    const index = pinned === undefined ? -1 : rows.findIndex((step) => step.id === pinned)
    // keep the pinned step inside the list even when it is older than the newest window
    const from = index >= 0 && index < newest ? Math.max(0, index - (STEP_OPTION_MAX >> 1)) : newest
    return rows.slice(from, from + STEP_OPTION_MAX).map(option)
  })
  // Solid applies <select value> before the matching <option> exists; re-apply once the options render.
  createEffect(() => {
    const value = browserLive() ? "live" : (selectedID() ?? "")
    stepOptions()
    queueMicrotask(() => {
      if (browserSelect !== undefined && browserSelect.value !== value) browserSelect.value = value
    })
  })
  const timing = createMemo(() =>
    view() === "overview" ? timingOfRows(sessionIndex().stepTiming as StepTimingRow[]) : NO_TIMING_STATS,
  )
  /** The details page only needs the total wall time for the trend hint; reuse the chart's rows. */
  const timingWall = createMemo(() => {
    if (view() !== "browser") return 0
    let wall = 0
    for (const row of timingTrendRows()) wall += row.wall
    return wall
  })
  /** Commands and file activity come from the same walk over the log. */
  const toolScan = createMemo(() =>
    view() === "fleet" ? NO_TOOL_SCAN : (sessionIndex().toolScan as ToolScan),
  )
  const commands = createMemo(() => toolScan().commands)
  const files = createMemo(() => toolScan().files)
  const modelReplies = createMemo(() =>
    view() === "overview"
      ? messages().filter((message) => message.type === "assistant" && message.content.some((part) => part.type === "text" && part.text.trim() !== "")).length
      : 0,
  )
  const skillLoads = createMemo(() => (view() === "overview" ? sessionIndex().eventCounts.skill : 0))
  const fileCounts = createMemo(() => {
    if (view() !== "overview") return NO_FILE_COUNTS
    const rows = files()
    return {
      read: rows.filter((row) => row.kind === "read").length,
      write: rows.filter((row) => row.kind === "write").length,
      search: rows.filter((row) => row.kind === "search").length,
    }
  })
  const eventCounts = createMemo(() => sessionIndex().eventCounts)
  const filteredEvents = createMemo(() => {
    const picked = eventKinds()
    return picked.length === EVENT_KINDS.length ? events() : events().filter((event) => picked.includes(event.kind))
  })
  const toggleEventKind = (kind: EventKind) => {
    setEventKinds((current) => {
      if (current.length === EVENT_KINDS.length) return [kind]
      if (!current.includes(kind)) return [...current, kind]
      return current.length === 1 ? [...EVENT_KINDS] : current.filter((item) => item !== kind)
    })
  }
  const eventLabelOf = (event: EventRow) => {
    if (event.kind === "compaction") {
      const reason = event.reason === "auto" ? ctx.t("event.reason.auto") : ctx.t("event.reason.manual")
      if (event.status === "completed") return `${reason} · ${ctx.t("ev.compaction", { count: String(event.count as number) })}`
      if (event.status === "failed") return `${reason} · ${ctx.t("ev.compactionFailed")}`
      return `${reason} · ${ctx.t("ev.compactionRunning")}`
    }
    if (event.kind === "inject") {
      return [event.name, event.detail].filter((part) => part !== undefined && part !== "").join(" · ")
    }
    if (event.kind === "skill") return event.name as string
    if (event.kind === "model") return ctx.t("ev.model", { from: event.from ?? "?", to: event.to ?? "?" })
    if (event.kind === "agent") return ctx.t("ev.agent", { from: event.from ?? "?", to: event.to ?? "?" })
    return event.status === "interrupted" ? ctx.t("ev.interrupted") : (event.error ?? ctx.t("ev.failed"))
  }
  const eventAtOf = (event: EventRow) => {
    if (event.turn === undefined || event.step === undefined) return undefined
    if (event.kind === "compaction" && event.fromTurn !== undefined && event.fromStep !== undefined) {
      return event.fromTurn === event.turn
        ? ctx.t("events.range", { t: String(event.turn), a: String(event.fromStep), b: String(event.step) })
        : ctx.t("events.rangeTo", {
            a: String(event.fromTurn),
            as: String(event.fromStep),
            b: String(event.turn),
            bs: String(event.step),
          })
    }
    return ctx.t("events.at", { t: String(event.turn), s: String(event.step) })
  }
  const tokenStats = createMemo(() => sessionTokenStats(tokenView(), info()?.tokens, generated()))
  const tokenCategories = createMemo(() =>
    CATEGORY_ORDER.filter((category) => (tokenStats()?.byCategory[category] ?? 0) > 0),
  )
  /** Hover scrubbing revisits steps; keep their groups until the message list or header changes. */
  const browserModel = createBrowserModel({
    view, browserStep, browserLive, trendPreview, trendPreviewStep, header, messages, structureTick, settleTick,
    browserDelta, steps, latestDone, selectedStep, browserOpen, browserAll, browserFlat, browserRowQuery, browserQuery, toolSort,
  })
  const toggleBrowserGroup = (key: Category) => {
    setBrowserOpen((current) => (current === key ? undefined : key))
    setBrowserRowQuery("")
  }
  const openBrowserGroup = (key: Category) => {
    setBrowserOpen(key)
    setBrowserRowQuery("")
  }
  const focusFileOp = (messageID: string, query: string) => {
    const rows = steps()
    const index = rows.findIndex((step) => step.id === messageID)
    const next = index >= 0 ? rows[index + 1] : undefined
    setBrowserLive(next === undefined)
    setSelected(next?.id)
    setBrowserFlat(false)
    setBrowserOpen("toolResults")
    setBrowserRowQuery(query)
    queueMicrotask(() => browserAnchor?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const focusCommand = (row: CommandRow) => {
    const rows = steps()
    const index = rows.findIndex((step) => step.id === row.messageID)
    const next = index >= 0 ? rows[index + 1] : undefined
    setTrendHover(undefined)
    setTimingHover(undefined)
    setTrendPreview(undefined)
    setBrowserLive(next === undefined)
    setSelected(next?.id)
    setBrowserFlat(false)
    setBrowserOpen("toolResults")
    setBrowserRowQuery("")
    queueMicrotask(() => browserAnchor?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const focusBrief = (entry: StepBriefEntry, stepID: string, response: boolean) => {
    const category: Category = BRIEF_CATEGORY[entry.kind]
    if (response) {
      const rows = steps()
      const index = rows.findIndex((step) => step.id === stepID)
      // The chip always points at a step from this list.
      const next = rows[index + 1]
      setBrowserLive(next === undefined)
      setSelected(next?.id)
    } else {
      setBrowserLive(false)
      setSelected(stepID)
    }
    setBrowserFlat(false)
    setBrowserOpen(category)
    setBrowserRowQuery(entry.kind === "user" || entry.kind === "reply" || entry.kind === "reasoning" ? entry.preview : entry.name)
    queueMicrotask(() => browserAnchor?.scrollIntoView({ behavior: "smooth", block: "start" }))
  }
  const revealBrowserRow = (id: string) => {
    let attempts = 0
    const reveal = () => {
      const target = browserAnchor?.querySelector<HTMLElement>(`[data-browser-row="${id}"]`)
      if (target === null || target === undefined) {
        if (attempts++ < 20) requestAnimationFrame(reveal)
        else browserAnchor?.scrollIntoView({ behavior: "smooth", block: "start" })
        return
      }
      target.scrollIntoView({ behavior: "smooth", block: "center" })
    }
    requestAnimationFrame(reveal)
  }
  const focusEvent = (event: EventRow) => {
    setTrendHover(undefined)
    setTimingHover(undefined)
    setTrendPreview(undefined)
    setBrowserFlat(false)
    setBrowserOpen(event.kind === "skill" ? "skills" : "injected")
    setBrowserRowQuery(event.kind === "compaction" ? "" : (event.name as string))
    setBrowserLive(false)
    setSelected(event.stepID as string)
    setBrowserFocus(event.id)
    revealBrowserRow(event.id)
  }
  const focusCompaction = (row: CompactionRow) => {
    setTrendHover(undefined)
    setTimingHover(undefined)
    setTrendPreview(undefined)
    setBrowserFlat(false)
    setBrowserOpen("injected")
    setBrowserRowQuery("")
    if (row.stepID === undefined) {
      setBrowserLive(true)
      setSelected(undefined)
    } else {
      setBrowserLive(false)
      setSelected(row.stepID)
    }
    setBrowserFocus(row.id)
    revealBrowserRow(row.id)
  }
  const fileGroups = createMemo(() => groupFileOps(files(), props.session.directory))
  const commandSummary = createMemo(() => summarizeCommands(commands()))
  const commandMatched = createMemo(() => {
    const needle = commandQuery().trim().toLowerCase()
    const program = commandProgram()
    return commands().filter((row) => {
      if (program !== undefined && !row.programs.includes(program)) return false
      if (needle === "") return true
      return `${row.command} ${row.description ?? ""} ${row.workdir ?? ""} ${row.programs.join(" ")}`.toLowerCase().includes(needle)
    })
  })
  const commandCounts = createMemo(() => {
    const counts: Record<CommandFilter, number> = { all: 0, failed: 0, slow: 0, background: 0 }
    for (const row of commandMatched()) {
      counts.all += 1
      if (row.status === "failed") counts.failed += 1
      if ((row.duration ?? 0) >= SLOW_COMMAND_MS) counts.slow += 1
      if (row.background) counts.background += 1
    }
    return counts
  })
  const commandShown = createMemo(() => {
    const filter = commandFilter()
    const rows = commandMatched().filter((row) =>
      filter === "failed"
        ? row.status === "failed"
        : filter === "slow"
          ? (row.duration ?? 0) >= SLOW_COMMAND_MS
          : filter === "background"
            ? row.background
            : true,
    )
    return commandSort() === "slowest"
      ? rows.sort((left, right) => (right.duration ?? -1) - (left.duration ?? -1) || right.at - left.at)
      : rows.sort((left, right) => right.at - left.at)
  })
  const commandAttention = createMemo(() => {
    const summary = commandSummary()
    const current = { filter: commandFilter(), sort: commandSort(), query: commandQuery(), program: commandProgram() }
    const chips: Array<{
      key: string
      label: string
      value: string
      count: string
      on: boolean
      apply: () => void
    }> = []
    const push = (
      key: string,
      label: string,
      value: string,
      count: string,
      patch: { filter?: CommandFilter; sort?: CommandSort; query?: string; program?: string },
    ) => {
      const on =
        (patch.filter ?? "all") === current.filter &&
        (patch.sort ?? "latest") === current.sort &&
        (patch.query ?? "") === current.query &&
        (patch.program ?? undefined) === current.program
      chips.push({
        key,
        label,
        value,
        count,
        on,
        apply: () => {
          setCommandFilter(on ? "all" : (patch.filter ?? "all"))
          setCommandSort(on ? "latest" : (patch.sort ?? "latest"))
          setCommandQuery(on ? "" : (patch.query ?? ""))
          setCommandProgram(on ? undefined : patch.program)
        },
      })
    }
    if (summary.slowest !== undefined) {
      push("slowest", ctx.t("cmds.rail.slowest"), summary.slowest.preview, span(summary.slowest.ms), {
        sort: "slowest",
        query: summary.slowest.preview,
      })
    }
    if (summary.failing !== undefined) {
      push("failing", ctx.t("cmds.rail.failing"), summary.failing.program, `×${summary.failing.count}`, {
        filter: "failed",
        program: summary.failing.program,
        query: summary.failing.program,
      })
    }
    if (summary.repeats !== undefined) {
      push("repeats", ctx.t("cmds.rail.repeats"), summary.repeats.preview, `×${summary.repeats.count}`, {
        query: summary.repeats.preview,
      })
    }
    if (summary.background > 0) {
      push("background", ctx.t("cmds.rail.bgRuns"), "", `×${summary.background}`, { filter: "background" })
    }
    return chips
  })
  const searchedFiles = createMemo(() => {
    const needle = fileQuery().trim().toLowerCase()
    const rows = fileGroups()
    return needle === "" ? rows : rows.filter((row) => row.path.toLowerCase().includes(needle))
  })
  const fileKindCounts = createMemo(() => {
    const counts: Record<FileFilterKind, { files: number; ops: number }> = {
      all: { files: 0, ops: 0 },
      read: { files: 0, ops: 0 },
      write: { files: 0, ops: 0 },
      search: { files: 0, ops: 0 },
      image: { files: 0, ops: 0 },
    }
    for (const row of searchedFiles()) {
      counts.all.files += 1
      counts.all.ops += row.ops.length
      if (row.reads > 0) {
        counts.read.files += 1
        counts.read.ops += row.reads
      }
      if (row.writes > 0) {
        counts.write.files += 1
        counts.write.ops += row.writes
      }
      if (row.searches > 0) {
        counts.search.files += 1
        counts.search.ops += row.searches
      }
      if (isImagePath(row.path)) {
        counts.image.files += 1
        counts.image.ops += row.ops.length
      }
    }
    return counts
  })
  const shownFiles = createMemo(() => {
    const filter = fileFilter()
    const matches = (row: FileRow) =>
      filter === "all"
        ? true
        : filter === "image"
          ? isImagePath(row.path)
          : filter === "read"
            ? row.reads > 0
            : filter === "write"
              ? row.writes > 0
              : row.searches > 0
    const countOf = (row: FileRow) =>
      filter === "read" ? row.reads : filter === "write" ? row.writes : filter === "search" ? row.searches : row.ops.length
    const latestOf = (row: FileRow) => row.ops[0].at
    const linesOf = (row: FileRow) => row.additions + row.deletions
    const pathOf = (row: FileRow) => row.path
    const byPath = (left: FileRow, right: FileRow) => (pathOf(left) < pathOf(right) ? -1 : 1)
    const baseOf = (row: FileRow) => splitFilePath(pathOf(row)).base
    const byName = (left: FileRow, right: FileRow) =>
      baseOf(left) !== baseOf(right) ? (baseOf(left) < baseOf(right) ? -1 : 1) : byPath(left, right)
    const byLatest = (left: FileRow, right: FileRow) => latestOf(right) - latestOf(left)
    const comparators: Record<FileSortKind, (left: FileRow, right: FileRow) => number> = {
      count: (left, right) => countOf(right) - countOf(left) || byLatest(left, right),
      lines: (left, right) => linesOf(right) - linesOf(left) || byPath(left, right),
      latest: byLatest,
      path: byPath,
      name: byName,
    }
    return searchedFiles()
      .filter(matches)
      .sort(comparators[fileSort()])
  })
  const filePreview = createFilePreview({ props, view, revision, shownFiles, fileLimit })
  const { previewFile, fileMissing, setFileMissing, clearChecks } = filePreview

  const fileTotals = createMemo(() => {
    let files = 0
    let added = 0
    let removed = 0
    for (const row of shownFiles()) {
      files += 1
      added += row.additions
      removed += row.deletions
    }
    return { files, added, removed }
  })
  const stepStampByID = createMemo(() => {
    const map = new Map<string, { turn: number; step: number }>()
    for (const step of steps()) map.set(step.id, { turn: step.turn, step: step.step })
    return map
  })
  const fileHint = createMemo(() => {
    const totals = fileTotals()
    const base = ctx.t("files.hint", { count: String(totals.files) })
    return totals.added + totals.removed > 0 ? `${base} · +${fmt(totals.added)} −${fmt(totals.removed)}` : base
  })
  const share = (value: number) => `${(value / Math.max(1, timing().wall)) * 100}%`

  const timingCategories = createMemo(() => {
    const value = timing()
    const rows: Array<{ key: string; label: string; ms: number; color: string; count?: string }> = [
      {
        key: "ttft",
        label: ctx.t("timing.ttft"),
        ms: value.ttft ?? 0,
        color: TIMING_COLOR.ttft,
        count: ctx.t("timing.callTimes", { n: fmt(value.ttftSteps) }),
      },
    ]
    if (value.split) {
      rows.push(
        {
          key: "reasoning",
          label: ctx.t("timing.reasoning"),
          ms: value.reasoning,
          color: TIMING_COLOR.reasoning,
          count: value.reasoningBlocks > 0 ? ctx.t("timing.blockTimes", { n: fmt(value.reasoningBlocks) }) : undefined,
        },
        {
          key: "text",
          label: ctx.t("timing.text"),
          ms: value.text,
          color: TIMING_COLOR.text,
          count: value.textBlocks > 0 ? ctx.t("timing.blockTimes", { n: fmt(value.textBlocks) }) : undefined,
        },
        {
          key: "toolArgs",
          label: ctx.t("timing.toolArgs"),
          ms: value.toolArgs,
          color: TIMING_COLOR.toolArg,
          count: value.toolArgBlocks > 0 ? ctx.t("timing.blockTimes", { n: fmt(value.toolArgBlocks) }) : undefined,
        },
      )
    } else {
      rows.push({ key: "gen", label: ctx.t("timing.gen"), ms: value.gen, color: TIMING_COLOR.reasoning })
    }
    rows.push(
      {
        key: "tools",
        label: ctx.t("timing.tools"),
        ms: value.tool,
        color: TIMING_COLOR.tools,
        count: ctx.t("timing.toolTimes", { n: fmt(value.toolCalls) }),
      },
      { key: "question", label: ctx.t("timing.question"), ms: value.question, color: TIMING_COLOR.question },
      { key: "other", label: ctx.t("timing.other"), ms: value.overhead + (value.split ? value.genLeftover : 0), color: TIMING_COLOR.other },
    )
    return rows
  })
  const activeTiming = createMemo(() => Math.max(0, timing().wall - timing().question - timing().delegation))
  createEffect(() => {
    view()
    setTrendHover(undefined)
    setTimingHover(undefined)
    setTrendPreview(undefined)
  })

  const scrollMemory = createScrollMemory({ sessionID: () => props.session.id, view })

  createEffect(() => {
    const memory = panelMemoryOf(props.session.id)
    const ui = memory.ui
    setView(memory.view)
    setSelected(ui.selected)
    setGranularity(ui.granularity)
    setBrowserLive(ui.browserLive)
    setBrowserOpen(ui.browserOpen)
    setBrowserQuery(ui.browserQuery)
    setBrowserRowQuery(ui.browserRowQuery)
    setBrowserFlat(ui.browserFlat)
    setBrowserAll(ui.browserAll)
    setBrowserDelta(ui.browserDelta)
    setBrowserFocus(ui.browserFocus)
    setToolSort(ui.toolSort)
    setFileFilter(ui.fileFilter)
    setFileSort(ui.fileSort)
    setFileQuery(ui.fileQuery)
    setFileOpen(ui.fileOpen)
    setFileMissing(new Map())
    clearChecks()
    setCommandFilter(ui.commandFilter)
    setCommandSort(ui.commandSort)
    setCommandQuery(ui.commandQuery)
    setCommandProgram(ui.commandProgram)
    setCommandOpen(ui.commandOpen)
    setEventKinds([...ui.eventKinds])
    setEventLimit(ui.eventLimit ?? LIST_PAGE)
    setFileLimit(ui.fileLimit ?? LIST_PAGE)
    setFileOpsLimit(ui.fileOpsLimit ?? LIST_PAGE)
    setCommandLimit(ui.commandLimit ?? LIST_PAGE)
    setChildrenLimit(ui.childrenLimit ?? LIST_PAGE)
    setTrendMode(ui.trendMode)
    setTrendDuration(ui.trendDuration)
    setTrendOverview(ui.trendOverview)
    setTrendAdaptive(ui.trendAdaptive)
    setTimingGranularity(ui.timingGranularity)
    setTimingOverview(ui.timingOverview)
    setTimingAdaptive(ui.timingAdaptive)
    setFleetPinned(ui.fleetPinned)
    setFleetMode(ui.fleetMode)
    setFleetTimelineFit(ui.fleetTimelineFit)
    setTrendHover(undefined)
    setTimingHover(undefined)
    setTrendPreview(undefined)
    setFleetHover(undefined)
    setFleetHeaders(new Map())
    setLoadedFor(undefined)
    setHeaders(undefined)
    setCompactionConfig(undefined)
    headerCache.clear()
    clearBriefCache()
    // A restored panel must rescan its message list once.
    flushStructure()
    setSettleTick((value) => value + 1)
    trendCount = undefined
    timingCount = undefined
    queueMicrotask(() => {
      const memory = panelMemoryOf(props.session.id)
      scrollMemory.restoreKeyed()
      if (trendScroll !== undefined) {
        trendScroll.scrollLeft = memory.trendLeft ?? trendScroll.scrollWidth
        measureTrendWindow(trendScroll)
      }
      if (timingScroll !== undefined) {
        timingScroll.scrollLeft = memory.timingLeft ?? timingScroll.scrollWidth
        measureTimingWindow(timingScroll)
      }
    })
  })

  // Keep the panel's UI state across remounts, e.g. after a file preview opens its own side tab.
  createEffect(() => {
    const memory = panelMemoryOf(props.session.id)
    memory.ui = {
      selected: selected(),
      granularity: granularity(),
      browserLive: browserLive(),
      browserOpen: browserOpen(),
      browserQuery: browserQuery(),
      browserRowQuery: browserRowQuery(),
      browserFlat: browserFlat(),
      browserAll: browserAll(),
      browserDelta: browserDelta(),
      browserFocus: browserFocus(),
      toolSort: toolSort(),
      fileFilter: fileFilter(),
      fileSort: fileSort(),
      fileQuery: fileQuery(),
      fileOpen: fileOpen(),
      commandFilter: commandFilter(),
      commandSort: commandSort(),
      commandQuery: commandQuery(),
      commandProgram: commandProgram(),
      commandOpen: commandOpen(),
      trendMode: trendMode(),
      eventKinds: [...eventKinds()],
      trendDuration: trendDuration(),
      trendOverview: trendOverview(),
      trendAdaptive: trendAdaptive(),
      timingGranularity: timingGranularity(),
      timingOverview: timingOverview(),
      timingAdaptive: timingAdaptive(),
      fleetPinned: fleetPinned(),
      fleetMode: fleetMode(),
      fleetTimelineFit: fleetTimelineFit(),
      eventLimit: eventLimit(),
      fileLimit: fileLimit(),
      fileOpsLimit: fileOpsLimit(),
      commandLimit: commandLimit(),
      childrenLimit: childrenLimit(),
    }
  })

  createEffect(() => {
    const session = props.session
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    void session.server.client.config
      .get({ location: { directory: session.directory } })
      .then((entries) => {
        if (cancelled) return
        const merged = entries
          .filter((entry) => entry.type === "document")
          .reduce<{ auto?: boolean; buffer?: string | number }>(
            (acc, entry) => ({ ...acc, ...(entry.info.compaction ?? {}) }),
            {},
          )
        setCompactionConfig(merged)
      })
      .catch(() => {
        if (!cancelled) setCompactionConfig(undefined)
      })
  })

  createEffect(() => {
    const id = props.session.id
    if (loadedFor() === id) return
    setLoadedFor(id)
    setLoadingHistory(true)
    void data()
      .session.message.sync(id)
      .then(() => {
        if (data().session.message.more(id) && !data().session.message.loading(id)) {
          return data().session.message.loadMore(id, { all: true })
        }
        return undefined
      })
      .catch(() => {})
      .finally(() => {
        setLoadingHistory(false)
        flushStructure()
        setSettleTick((value) => value + 1)
        queueMicrotask(scrollMemory.restore)
      })
  })

  createEffect(() => {
    const session = props.session
    const id = session.id
    revision()
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    void session.server.client
      .rpc(ContextRpc)
      .headers({ sessionID: id }, { location: { directory: session.directory } })
      .then((result) => {
        if (!cancelled) setHeaders((result as { headers?: HeaderSummary[] }).headers ?? [])
      })
      .catch(() => {
        if (!cancelled) setHeaders((current) => current ?? [])
      })
  })

  const fleetLoader = createFleetLoader({
    props, view, revision, fleet, setFleetHeaders, bumpStream, bumpFleetLoaded,
    hostMethods: () => hostInfo()?.methods,
  })

  createEffect(() => {
    if (view() !== "fleet") return
    if (!fleetRunning()) return
    setFleetNow(Date.now())
    const timer = setInterval(() => setFleetNow(Date.now()), 15_000)
    onCleanup(() => clearInterval(timer))
  })

  let fleetStageEl: HTMLDivElement | undefined
  createEffect(() => {
    if (view() !== "fleet" || fleetMode() !== "tree") return
    fleet().nodes.length
    const el = fleetStageEl as HTMLDivElement
    const width = el.clientWidth
    if (width > 0 && Math.abs(width - fleetStageWidth()) > 2) setFleetStageWidth(width)
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 0
      if (next > 0 && Math.abs(next - fleetStageWidth()) > 2) setFleetStageWidth(next)
    })
    observer.observe(el)
    onCleanup(() => observer.disconnect())
  })

  // Overview → Fleet jump: bring the picked agent's name to the top of the panel, then release the focus.
  createEffect(() => {
    const id = fleetFocus()
    if (id === undefined || view() !== "fleet" || fleetMode() !== "tree") return
    queueMicrotask(() => {
      fleetStageEl
        ?.querySelector<HTMLElement>(`[data-fleet-id="${id}"]`)
        ?.scrollIntoView({ block: "start", inline: "center" })
      setFleetFocus(undefined)
    })
  })

  createEffect(() => {
    const at = headerTime()
    const versions = headers()
    if (at === undefined) {
      setHeader(undefined)
      setHeaderLoading(false)
      setHeaderError(undefined)
      return
    }
    if (versions === undefined) {
      setHeader(undefined)
      setHeaderLoading(true)
      setHeaderError(undefined)
      return
    }
    const summary = headerAt(versions, at)
    if (summary === undefined) {
      setHeader(null)
      setHeaderLoading(false)
      setHeaderError(undefined)
      return
    }
    const key = `${summary.systemHash}:${summary.toolsHash}`
    const cached = headerCache.get(key)
    if (cached !== undefined) {
      setHeader(cached)
      setHeaderLoading(false)
      setHeaderError(undefined)
      return
    }
    const id = props.session.id
    const directory = props.session.directory
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    setHeader(undefined)
    setHeaderLoading(true)
    setHeaderError(undefined)
    void props.session.server.client
      .rpc(ContextRpc)
      .header({ sessionID: id, at }, { location: { directory } })
      .then((result) => {
        if (cancelled) return
        const detail = (result as { header: HeaderDetail | null }).header
        if (detail !== null) {
          headerCache.set(key, detail)
          if (headerCache.size > 16) headerCache.delete(headerCache.keys().next().value as string)
        }
        setHeader(detail)
      })
      .catch((cause) => {
        if (cancelled) return
        setHeader(null)
        setHeaderError(cause instanceof Error ? cause.message : String(cause))
      })
      .finally(() => {
        if (!cancelled) setHeaderLoading(false)
      })
  })

  createEffect(() => {
    const id = props.session.id
    const stop = data().listen(({ details }) => {
      const type = details.type
      const sessionID = (details as unknown as { data?: { sessionID?: string } }).data?.sessionID
      const mine = !sessionID || sessionID === id
      if (type === "session.text.delta" || type === "session.reasoning.delta" || type === "session.tool.input.delta") {
        // Fleet cards read other sessions' message lists; wake them on a throttle instead of per chunk.
        bumpStream()
      }
      if (
        type === "session.tool.success" ||
        type === "session.tool.failed" ||
        type === "session.shell.started" ||
        type === "session.shell.ended" ||
        type === "session.text.ended" ||
        type === "session.reasoning.ended" ||
        type === "session.tool.input.ended" ||
        type === "session.synthetic" ||
        type === "session.skill.activated" ||
        type === "session.step.streamed"
      ) {
        // Background results can land in a finished step, so settle the heavy scans once per event.
        if (mine) bumpStructure()
        else {
          bumpStream()
          bumpChildStructure()
        }
      }
      if (
        type === "session.step.ended" ||
        type === "session.compaction.ended" ||
        type === "session.execution.succeeded" ||
        type === "session.execution.failed" ||
        type === "session.execution.interrupted"
      ) {
        if (mine) setRevision((value) => value + 1)
        // A child's step end also has to settle the fleet cards at once, not on the next stream tick.
        else {
          bumpStream()
          bumpChildStructure()
        }
      }
    })
    onCleanup(stop)
  })

  createEffect(() => {
    const session = props.session
    const id = session.id
    revision()
    setLoading(true)
    void session.server.client
      .rpc(ContextRpc)
      .snapshot({ sessionID: id }, { location: { directory: session.directory } })
      .then((result) => {
        if (props.session.id !== id) return
        setSnapshot((result as { snapshot: Snapshot | null }).snapshot ?? undefined)
      })
      .catch(() => {
        if (props.session.id !== id) return
        setSnapshot(undefined)
      })
      .finally(() => {
        if (props.session.id === id) setLoading(false)
      })
  })

  const overviewProps: OverviewPanelProps = {
    loading, tokens, costStats, turnCount, steps, modelReplies, skillLoads, tools, commands,
    fileCounts, sessionIndex, eventCounts, tokenStats, tokenCategories, currentUsed, limit,
    currentView, currentCategories, currentTokens, currentWidth, currentFree, trigger, triggerPct,
    modelInfo, info, outputLimit, currentRunning, children, childrenLimit, setChildrenLimit, fleetHues,
    setFleetPinned, setFleetFocus, setView, data, timingSection: () => (
      <TimingSection
        timing={timing}
        activeTiming={activeTiming}
        categories={timingCategories}
        share={share}
        sessionSpan={sessionSpan}
        topTools={topTools}
      />
    ),
  }

  const browserUi: BrowserUi = {
    hoverTimingRow,
    selectStep,
    hoverTrendRow,
    measureTrendWindow,
    measureTimingWindow,
    focusBrief,
    setTrendAdaptive,
    setBrowserRowQuery,
    setTrendRibbonCat,
    trendRibbonCat,
    timingGranularity,
    selectedStep,
    browserStep,
    headerLoading,
    browserOpen,
    filteredEvents,
    shownFiles,
    fileKindCounts,
    commandShown,
    trendAdaptive,
    setTrendOverview,
    granularity,
    setGranularity,
    setTrendMode,
    trendMode,
    setBrowserFlat,
    setBrowserOpen,
    timingAdaptive,
    setTimingAdaptive,
    setTimingOverview,
    setTimingGranularity,
    browserLive,
    setBrowserLive,
    setSelected,
    browserDelta,
    headerError,
    browserFocus,
    browserAll,
    setBrowserAll,
    eventLimit,
    fileLimit,
    setFileOpsLimit,
    fileOpsLimit,
    stepStampByID,
    commandLimit,
    commandProgram,
    setCommandProgram,
    commandAttention,
    focusCommand,
    setTrendDuration,
    trendHover,
    turnStepCounts,
    timingWall,
    timingHover,
    setBrowserFocus,
    stepOptions,
    trendPreviewStep,
    setBrowserDelta,
    loadingHistory,
    openBrowserGroup,
    toggleBrowserGroup,
    browserRowQuery,
    toolSort,
    setToolSort,
    browserQuery,
    setBrowserQuery,
    header,
    eventKinds,
    toggleEventKind,
    eventCounts,
    eventLabelOf,
    eventAtOf,
    focusEvent,
    focusCompaction,
    fileHint,
    fileFilter,
    setFileFilter,
    fileQuery,
    setFileQuery,
    fileSort,
    setFileSort,
    fileGroups,
    fileOpen,
    fileMissing,
    setFileOpen,
    focusFileOp,
    commandFilter,
    setCommandFilter,
    commandCounts,
    commandSort,
    setCommandSort,
    commandQuery,
    setCommandQuery,
    commands,
    commandOpen,
    setCommandOpen,
    setCommandLimit,
    setEventLimit,
    setFileLimit,
    trendKeyOfTiming,
    selectedID,
    trendDuration,
    trendOverview,
    timingOverview,
    browserFlat,
    previewFile,
    commandSummary,
    rememberChartScroll: scrollMemory.rememberChartScroll,
  }

  return (
    <div class="opencode-context-panel oc-root" ref={(el) => scrollMemory.attachRoot(el)}>
      <style>{PANEL_CSS}</style>
      <PanelHeader
        subtitle={() => `${info()?.title || props.session.id} · ${info()?.agent || lastAgent() || "agent"} · ${info()?.model?.id || "model"}`}
        view={view}
        sessionID={props.session.id}
        onView={setView}
        onRefresh={() => {
          clearChecks()
          fleetLoader.clearHeaderCache()
          setRevision((value) => value + 1)
        }}
      />
      <div
        ref={(el) => scrollMemory.attachBody(el)}
        data-panel-scroll
        class="oc-body"
        onScroll={scrollMemory.onBodyScroll}
      >
      <Show when={view() === "overview"}>
        <OverviewPanel {...overviewProps} />
      </Show>

      <Show when={view() === "browser"}>
        <BrowserPanel
          session={sessionModel}
          trend={trendModel}
          timing={timingModel}
          browser={browserModel}
          ui={browserUi}
          attachTrendScroll={attachTrendScroll}
          attachTimingScroll={attachTimingScroll}
          attachBrowserAnchor={(el) => (browserAnchor = el)}
          attachBrowserSelect={(el) => (browserSelect = el)}
          measureTrendWindow={measureTrendWindow}
          measureTimingWindow={measureTimingWindow}
          refreshTrendWindow={() => trendScroll && measureTrendWindow(trendScroll)}
          refreshTimingWindow={() => timingScroll && measureTimingWindow(timingScroll)}
          scrollToBrowser={() => browserAnchor?.scrollIntoView({ behavior: "smooth", block: "start" })}
        />
      </Show>

      <Show when={view() === "fleet"}>
        <FleetPanel
          fleet={fleetModel}
          session={props.session}
          attachFleetStage={(el) => (fleetStageEl = el)}
        />
      </Show>

      <div class="oc-footer">
        {ctx.t("note")}
        <Show when={hostStale()}> · {ctx.t("host.stale")}</Show>
      </div>
      </div>
    </div>
  )
}

