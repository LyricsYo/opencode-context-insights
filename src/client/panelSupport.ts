import { type Category } from "../shared/estimate.ts"
import { buildCost } from "../shared/cost.ts"
import type { HeaderDetail } from "../shared/header.ts"
import { buildChildren, buildTokenScan, buildToolScan, EVENT_KINDS, SLOW_COMMAND_MS, type CommandFilter, type CommandSort, type CommandStatus, type CompactionRow, type EventKind, type EventRow, type FileOpKind, type SessionIndex, type StepTimingRow, type TimingStats, type TokenStepRow, type TokenTurnRow } from "../shared/report.ts"
import { type FleetDelegation, type FleetForest, type FleetHead, type FleetTimeline } from "../shared/fleet.ts"
import { LIST_PAGE } from "./paging.ts"
import { TREND_BAR, TREND_GAP, TREND_HEIGHT } from "./styleMetrics.ts"

export const TOOL_SORTS = ["size", "calls", "name"] as const

export type FileFilterKind = "all" | FileOpKind | "image"
export type FileSortKind = "count" | "lines" | "latest" | "path" | "name"
export const FILE_FILTERS: readonly FileFilterKind[] = ["all", "read", "write", "search", "image"]
export const FILE_SORTS: readonly FileSortKind[] = ["count", "lines", "latest", "path", "name"]
export const COMMAND_FILTERS: readonly CommandFilter[] = ["all", "failed", "slow", "background"]
export const COMMAND_GLYPH: Record<CommandStatus, { glyph: string; color: string; label: string }> = {
  running: { glyph: "●", color: "#c9a227", label: "cmds.status.running" },
  completed: { glyph: "✓", color: "#22a06b", label: "cmds.status.completed" },
  failed: { glyph: "✕", color: "#d64545", label: "cmds.status.failed" },
  killed: { glyph: "■", color: "#d64545", label: "cmds.status.killed" },
}

export const TIMING_COLOR = {
  ttft: "#3b82f6",
  reasoning: "#8b5cf6",
  text: "#ec4899",
  toolArg: "#f59e0b",
  tools: "#14b8a6",
  question: "#f97316",
  other: "#94a3b8",
} as const

export function commandDurationColor(ms: number): string | undefined {
  if (ms >= 60_000) return "#d64545"
  if (ms >= SLOW_COMMAND_MS) return "#c9a227"
  return undefined
}

export const isImagePath = (path: string): boolean => /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(path)

export const FILE_GLYPHS: ReadonlyArray<{ test: RegExp; label: string; color: string }> = [
  { test: /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i, label: "IMG", color: "#8b5cf6" },
  { test: /\.(ts|tsx)$/i, label: "TS", color: "#3b82f6" },
  { test: /\.(js|jsx|mjs|cjs)$/i, label: "JS", color: "#eab308" },
  { test: /\.json$/i, label: "{}", color: "#eab308" },
  { test: /\.(md|mdx)$/i, label: "MD", color: "#94a3b8" },
  { test: /\.(css|scss|less)$/i, label: "#", color: "#38bdf8" },
  { test: /\.(html?|vue|svelte)$/i, label: "<>", color: "#f97316" },
  { test: /\.py$/i, label: "PY", color: "#22c55e" },
  { test: /\.go$/i, label: "GO", color: "#22d3ee" },
  { test: /\.rs$/i, label: "RS", color: "#f59e0b" },
  { test: /\.(sh|ps1|bat|cmd)$/i, label: "$", color: "#a3e635" },
]

export function fileGlyphOf(path: string): { label: string; color: string } {
  for (const glyph of FILE_GLYPHS) if (glyph.test.test(path)) return { label: glyph.label, color: glyph.color }
  return { label: "·", color: "#94a3b8" }
}

export function splitFilePath(path: string): { dir: string; base: string } {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return cut >= 0 ? { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) } : { dir: "", base: path }
}

/** Extensions the Desktop file link handler can preview instead of launching an external app. */
export const PREVIEW_EXTENSIONS = new Set([
  "txt", "text", "log", "md", "markdown", "mdx", "html", "htm",
  "json", "jsonc", "yaml", "yml", "toml", "ini", "cfg", "conf", "csv", "tsv",
  "xml", "svg", "css", "scss", "sass", "less",
  "js", "mjs", "cjs", "ts", "mts", "cts", "jsx", "tsx", "vue", "svelte",
  "py", "rb", "go", "rs", "java", "kt", "c", "h", "cc", "cpp", "hpp", "cs", "php",
  "sh", "bash", "zsh", "ps1", "bat", "cmd", "sql", "graphql", "gql",
  "png", "jpg", "jpeg", "jfif", "gif", "webp", "bmp", "ico", "avif", "tif", "tiff",
])

export function previewableFile(path: string): boolean {
  const name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)
  const cut = name.lastIndexOf(".")
  return cut > 0 && PREVIEW_EXTENSIONS.has(name.slice(cut + 1).toLowerCase())
}

export type PanelView = "overview" | "browser" | "fleet"

/** Panel state that should survive a remount, e.g. after a file preview opens its own side tab. */
export interface PanelUiState {
  selected?: string
  granularity: "step" | "turn"
  browserLive: boolean
  browserOpen?: Category
  browserQuery: string
  browserRowQuery: string
  browserFlat: boolean
  browserAll: boolean
  browserDelta: "off" | "step" | "turn"
  browserFocus?: string
  toolSort: "size" | "calls" | "name"
  fileFilter: FileFilterKind
  fileSort: FileSortKind
  fileQuery: string
  fileOpen?: string
  commandFilter: CommandFilter
  commandSort: CommandSort
  commandQuery: string
  commandProgram?: string
  commandOpen?: string
  trendMode: "total" | "delta"
  eventKinds: EventKind[]
  trendDuration: boolean
  trendOverview: boolean
  trendAdaptive: boolean
  timingGranularity: "step" | "turn"
  timingAdaptive: boolean
  timingOverview: boolean
  fleetPinned?: string
  fleetMode: "timeline" | "tree"
  fleetTimelineFit: "adaptive" | "overview"
  eventLimit: number
  fileLimit: number
  fileOpsLimit: number
  commandLimit: number
  childrenLimit: number
}

export function defaultPanelUi(): PanelUiState {
  return {
    granularity: "step",
    browserLive: true,
    browserQuery: "",
    browserRowQuery: "",
    browserFlat: false,
    browserAll: false,
    browserDelta: "off",
    toolSort: "size",
    fileFilter: "all",
    fileSort: "count",
    fileQuery: "",
    commandFilter: "all",
    commandSort: "latest",
    commandQuery: "",
    trendMode: "total",
    eventKinds: [...EVENT_KINDS],
    trendDuration: true,
    trendOverview: false,
    trendAdaptive: true,
    timingGranularity: "step",
    timingAdaptive: true,
    timingOverview: false,
    fleetMode: "timeline",
    fleetTimelineFit: "adaptive",
    eventLimit: LIST_PAGE,
    fileLimit: LIST_PAGE,
    fileOpsLimit: LIST_PAGE,
    commandLimit: LIST_PAGE,
    childrenLimit: LIST_PAGE,
  }
}

export interface PanelMemory {
  view: PanelView
  scroll: Map<PanelView, number>
  /** Nested scroll containers, keyed by section / expanded row. */
  sections: Map<string, { top: number; left: number }>
  trendLeft?: number
  timingLeft?: number
  ui: PanelUiState
}

/** Survives panel remounts, e.g. when a file preview opens its own side tab and the user comes back. */
export const panelMemory = new Map<string, PanelMemory>()

export function panelMemoryOf(sessionID: string): PanelMemory {
  let entry = panelMemory.get(sessionID)
  if (entry === undefined) {
    entry = { view: "overview", scroll: new Map(), sections: new Map(), ui: defaultPanelUi() }
    panelMemory.set(sessionID, entry)
    // shortcut: keep the last 32 sessions; older ones start over after a remount.
    if (panelMemory.size > 32) panelMemory.delete(panelMemory.keys().next().value as string)
  }
  return entry
}
export const STEP_OPTION_MAX = 200
/** Streamed text is published to the heavy scans at most this often. */
export const SETTLE_MS = 250
/** The live context view groups the whole request; one second is enough to feel live. */
export const BROWSER_LIVE_MS = 1_000
/** Tool / step events are coalesced so a burst costs one structural rescan. */
export const STRUCTURE_MS = 150
export const NO_TREND_ROWS: Array<TokenStepRow | TokenTurnRow> = []
export const NO_EVENTS: EventRow[] = []
export const NO_TOKEN_SCAN: ReturnType<typeof buildTokenScan> = {
  steps: [],
  generated: { reasoning: 0, answers: 0, calls: 0 },
  tools: [],
}
export const NO_SESSION_INDEX: SessionIndex = {
  steps: [],
  scan: NO_TOKEN_SCAN,
  turnCount: 0,
  eventCounts: { inject: 0, skill: 0, compaction: 0, model: 0, agent: 0, error: 0 },
  eventTotal: 0,
}
export const NO_TOOL_SCAN: ReturnType<typeof buildToolScan> = { commands: [], files: [] }
export const NO_TOKEN_TURNS: TokenTurnRow[] = []
export const NO_TURN_COUNTS: ReadonlyMap<number, number> = new Map<number, number>()
export const NO_STEP_TIMING: StepTimingRow[] = []
export const NO_STEP_OPTIONS: Array<{ id: string; label: string }> = []
export const NO_COST_STATS: ReturnType<typeof buildCost> = { total: 0, average: 0, steps: 0, estimated: 0, fallback: 0 }
export const NO_TIMING_STATS: TimingStats = {
  gen: 0,
  reasoning: 0,
  text: 0,
  toolArgs: 0,
  split: false,
  genLeftover: 0,
  reasoningBlocks: 0,
  textBlocks: 0,
  toolArgBlocks: 0,
  tool: 0,
  toolCalls: 0,
  question: 0,
  delegation: 0,
  overhead: 0,
  wall: 0,
  ttftSteps: 0,
  steps: 0,
  output: 0,
  decoded: 0,
  rate: 0,
}
export const NO_CHILDREN: ReturnType<typeof buildChildren> = []
export const NO_FILE_COUNTS = { read: 0, write: 0, search: 0 }
export const NO_COMPACTIONS: CompactionRow[] = []
export const NO_FLEET_FOREST: FleetForest = { nodes: [], edges: [], rootID: "", solo: true }
export const NO_FLEET_HUES: ReadonlyMap<string, string> = new Map<string, string>()
export const NO_FLEET_HEADS: ReadonlyMap<string, FleetHead> = new Map<string, FleetHead>()
export const NO_FLEET_DELEGATIONS: ReadonlyMap<string, readonly FleetDelegation[]> = new Map<string, readonly FleetDelegation[]>()
export const NO_FLEET_TIMELINE: FleetTimeline = {
  rows: [],
  start: 0,
  end: 1,
  now: 0,
  ticks: [],
  buckets: [],
  peak: 0,
  links: [],
  segments: [],
  active: 0,
  activeSum: 0,
}
export const visibleWindow = (el: HTMLDivElement, count: number) => {
  if (count === 0 || el.clientWidth <= 0) return undefined
  const pitch = TREND_BAR + TREND_GAP
  const from = Math.max(0, Math.floor(el.scrollLeft / pitch))
  const to = Math.min(count - 1, Math.max(from, Math.floor((el.scrollLeft + el.clientWidth - 1) / pitch)))
  return { from, to }
}

export function revealScrollIndex(el: HTMLDivElement, index: number, count: number) {
  if (index < 0 || index >= count || el.clientWidth <= 0) return
  const pitch = TREND_BAR + TREND_GAP
  const left = index * pitch
  const right = left + TREND_BAR
  const viewLeft = el.scrollLeft
  const viewRight = viewLeft + el.clientWidth
  if (left >= viewLeft && right <= viewRight) return
  const target = Math.max(0, Math.min(el.scrollWidth - el.clientWidth, left - (el.clientWidth - TREND_BAR) / 2))
  el.scrollTo({ left: target, behavior: "smooth" })
}

export function stackedRibbon(
  count: number,
  order: readonly string[],
  max: number,
  valueAt: (index: number, key: string) => number,
  // shortcut: the background ribbon samples at most 320 columns; raise if pixel-accurate edges matter.
  maxPoints = 320,
): Array<{ key: string; points: string }> {
  if (count === 0) return []
  const width = 1000
  const height = TREND_HEIGHT
  const xOf = (index: number) => (index / (count - 1)) * width
  const step = Math.max(1, Math.ceil(count / maxPoints))
  const indices: number[] = []
  for (let index = 0; index < count; index += step) indices.push(index)
  if (indices[indices.length - 1] !== count - 1) indices.push(count - 1)
  const acc = new Array<number>(indices.length).fill(0)
  const polygons: Array<{ key: string; points: string }> = []
  for (const key of order) {
    const lower = acc.slice()
    let band = false
    for (let slot = 0; slot < indices.length; slot++) {
      const value = valueAt(indices[slot], key)
      if (value > 0) band = true
      acc[slot] += value
    }
    if (!band) continue
    if (count === 1) {
      const topY = height - (acc[0] / max) * height
      const bottomY = height - (lower[0] / max) * height
      polygons.push({ key, points: `0,${topY} ${width},${topY} ${width},${bottomY} 0,${bottomY}` })
      continue
    }
    const top: string[] = []
    const bottom: string[] = []
    for (let slot = 0; slot < indices.length; slot++) {
      const x = xOf(indices[slot])
      top.push(`${x},${height - (acc[slot] / max) * height}`)
      bottom.push(`${x},${height - (lower[slot] / max) * height}`)
    }
    polygons.push({ key, points: [...top, ...bottom.reverse()].join(" ") })
  }
  return polygons
}

export const headerCache = new Map<string, HeaderDetail>()
/** Card heads survive tab switches and panel remounts; keys include the node's log signature. */
export const fleetHeadCache = new Map<string, FleetHead>()


