import type { Accessor, Setter } from "solid-js"
import { type Category } from "../../shared/estimate.ts"
import { summarizeCommands, type CommandRow } from "../../shared/report.ts"
import { createTrendModel } from "../models/trend.ts"
import { createTimingModel } from "../models/timing.ts"
import { createBrowserModel } from "../models/browser.ts"
import { createSessionModel } from "../models/session.ts"
import { TrendSection } from "./trendSection.tsx"
import { TimingTrendSection } from "./timingTrendSection.tsx"
import { ContextBrowserSection } from "./contextBrowserSection.tsx"
import { EventsSection } from "./eventsSection.tsx"
import { CompactionSection } from "./compactionSection.tsx"
import { FilesSection } from "./filesSection.tsx"
import { CommandsSection } from "./commandsSection.tsx"

export interface BrowserPanelProps {
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

export interface BrowserUi {
  readonly hoverTimingRow: (...args: any[]) => any
  readonly selectStep: (...args: any[]) => any
  readonly hoverTrendRow: (...args: any[]) => any
  readonly measureTrendWindow: (...args: any[]) => any
  readonly measureTimingWindow: (...args: any[]) => any
  readonly focusBrief: (...args: any[]) => any
  readonly setTrendAdaptive: Setter<any>
  readonly setBrowserRowQuery: Setter<any>
  readonly setTrendRibbonCat: Setter<any>
  readonly trendRibbonCat: Accessor<Category | undefined>
  readonly timingGranularity: (...args: any[]) => any
  readonly selectedStep: (...args: any[]) => any
  readonly browserStep: (...args: any[]) => any
  readonly headerLoading: (...args: any[]) => any
  readonly browserOpen: (...args: any[]) => any
  readonly filteredEvents: (...args: any[]) => any
  readonly shownFiles: (...args: any[]) => any
  readonly fileKindCounts: (...args: any[]) => any
  readonly commandShown: Accessor<CommandRow[]>
  readonly trendAdaptive: (...args: any[]) => any
  readonly setTrendOverview: Setter<any>
  readonly granularity: (...args: any[]) => any
  readonly setGranularity: Setter<any>
  readonly setTrendMode: Setter<any>
  readonly trendMode: (...args: any[]) => any
  readonly setBrowserFlat: Setter<any>
  readonly setBrowserOpen: Setter<any>
  readonly timingAdaptive: (...args: any[]) => any
  readonly setTimingAdaptive: Setter<any>
  readonly setTimingOverview: Setter<any>
  readonly setTimingGranularity: Setter<any>
  readonly browserLive: (...args: any[]) => any
  readonly setBrowserLive: Setter<any>
  readonly setSelected: Setter<any>
  readonly browserDelta: (...args: any[]) => any
  readonly headerError: (...args: any[]) => any
  readonly browserFocus: (...args: any[]) => any
  readonly browserAll: (...args: any[]) => any
  readonly setBrowserAll: Setter<any>
  readonly eventLimit: (...args: any[]) => any
  readonly fileLimit: (...args: any[]) => any
  readonly setFileOpsLimit: Setter<any>
  readonly fileOpsLimit: (...args: any[]) => any
  readonly stepStampByID: (...args: any[]) => any
  readonly commandLimit: (...args: any[]) => any
  readonly commandProgram: (...args: any[]) => any
  readonly setCommandProgram: Setter<any>
  readonly commandAttention: (...args: any[]) => any
  readonly focusCommand: (...args: any[]) => any
  readonly setTrendDuration: Setter<any>
  readonly trendHover: (...args: any[]) => any
  readonly turnStepCounts: (...args: any[]) => any
  readonly timingWall: (...args: any[]) => any
  readonly timingHover: (...args: any[]) => any
  readonly setBrowserFocus: Setter<any>
  readonly stepOptions: (...args: any[]) => any
  readonly trendPreviewStep: (...args: any[]) => any
  readonly setBrowserDelta: Setter<any>
  readonly loadingHistory: (...args: any[]) => any
  readonly openBrowserGroup: (...args: any[]) => any
  readonly toggleBrowserGroup: (...args: any[]) => any
  readonly browserRowQuery: (...args: any[]) => any
  readonly toolSort: (...args: any[]) => any
  readonly setToolSort: Setter<any>
  readonly browserQuery: (...args: any[]) => any
  readonly setBrowserQuery: Setter<any>
  readonly header: (...args: any[]) => any
  readonly eventKinds: (...args: any[]) => any
  readonly toggleEventKind: (...args: any[]) => any
  readonly eventCounts: (...args: any[]) => any
  readonly eventLabelOf: (...args: any[]) => any
  readonly eventAtOf: (...args: any[]) => any
  readonly focusEvent: (...args: any[]) => any
  readonly focusCompaction: (...args: any[]) => any
  readonly fileHint: (...args: any[]) => any
  readonly fileFilter: (...args: any[]) => any
  readonly setFileFilter: Setter<any>
  readonly fileQuery: (...args: any[]) => any
  readonly setFileQuery: Setter<any>
  readonly fileSort: (...args: any[]) => any
  readonly setFileSort: Setter<any>
  readonly fileGroups: (...args: any[]) => any
  readonly fileOpen: (...args: any[]) => any
  readonly fileMissing: (...args: any[]) => any
  readonly setFileOpen: Setter<any>
  readonly focusFileOp: (...args: any[]) => any
  readonly commandFilter: (...args: any[]) => any
  readonly setCommandFilter: Setter<any>
  readonly commandCounts: (...args: any[]) => any
  readonly commandSort: (...args: any[]) => any
  readonly setCommandSort: Setter<any>
  readonly commandQuery: (...args: any[]) => any
  readonly setCommandQuery: Setter<any>
  readonly commands: (...args: any[]) => any
  readonly commandOpen: (...args: any[]) => any
  readonly setCommandOpen: Setter<any>
  readonly setCommandLimit: Setter<any>
  readonly setEventLimit: Setter<any>
  readonly setFileLimit: Setter<any>
  readonly trendKeyOfTiming: (...args: any[]) => any
  readonly selectedID: (...args: any[]) => any
  readonly trendDuration: Accessor<boolean>
  readonly trendOverview: Accessor<boolean>
  readonly timingOverview: Accessor<boolean>
  readonly browserFlat: Accessor<boolean>
  readonly previewFile: (path: string) => void
  readonly commandSummary: Accessor<ReturnType<typeof summarizeCommands>>
  readonly rememberChartScroll: (which: "trend" | "timing", el: HTMLDivElement) => void
}

export function BrowserPanel(props: BrowserPanelProps) {
  return (
    <>
      <TrendSection {...props} />
      <TimingTrendSection {...props} />
      <ContextBrowserSection {...props} />
      <EventsSection {...props} />
      <CompactionSection {...props} />
      <FilesSection {...props} />
      <CommandsSection {...props} />
    </>
  )
}
