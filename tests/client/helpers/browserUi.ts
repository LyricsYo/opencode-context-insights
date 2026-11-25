import type { BrowserPanelProps, BrowserUi } from "../../../src/client/components/browserPanel.tsx"
import type { createBrowserModel } from "../../../src/client/models/browser.ts"
import type { createSessionModel } from "../../../src/client/models/session.ts"
import type { createTimingModel } from "../../../src/client/models/timing.ts"
import type { createTrendModel } from "../../../src/client/models/trend.ts"

const kindCount = () => ({ files: 0, ops: 0 })

/**
 * BrowserUi accessors used by the detail sections. Anything not listed here is
 * still callable (returning undefined), so a section can read an accessor this
 * test does not care about without crashing.
 */
export function makeBrowserUi(overrides: Record<string, unknown> = {}): BrowserUi {
  const defaults: Record<string, unknown> = {
    commandSummary: () => ({ runs: 0, failed: 0, totalMs: 0, background: 0, programs: [] }),
    commandShown: () => [],
    commandAttention: () => [],
    commandCounts: () => ({ all: 0, failed: 0, slow: 0, background: 0 }),
    commands: () => [],
    fileKindCounts: () => ({
      all: kindCount(),
      read: kindCount(),
      write: kindCount(),
      search: kindCount(),
      image: kindCount(),
    }),
    fileGroups: () => [],
    shownFiles: () => [],
    fileMissing: () => new Map<string, boolean>(),
    stepStampByID: () => new Map(),
    eventKinds: () => [],
    eventCounts: () => ({}),
    filteredEvents: () => [],
    trendRibbonCat: () => undefined,
    header: () => null,
  }
  const values = { ...defaults, ...overrides }
  return new Proxy(values, {
    get: (target, key) => (key in target ? target[key as string] : () => undefined),
  }) as unknown as BrowserUi
}

export function makeSessionModel(overrides: Record<string, unknown> = {}): ReturnType<typeof createSessionModel> {
  return {
    steps: () => [],
    turnCount: () => 0,
    events: () => [],
    compactions: () => [],
    ...overrides,
  } as never
}

export function makeTrendModel(overrides: Record<string, unknown> = {}): ReturnType<typeof createTrendModel> {
  return {
    trendRows: () => [],
    trendLegend: () => [],
    trendMissingCount: () => 0,
    trendDuration: () => false,
    trendActive: () => undefined,
    trendBrief: () => undefined,
    ...overrides,
  } as never
}

export function makeTimingModel(overrides: Record<string, unknown> = {}): ReturnType<typeof createTimingModel> {
  return {
    timingTrendRows: () => [],
    timingWall: () => 0,
    timingTrendActive: () => undefined,
    ...overrides,
  } as never
}

export function makeBrowserModel(overrides: Record<string, unknown> = {}): ReturnType<typeof createBrowserModel> {
  return {
    browserGroups: () => [],
    browserTotal: () => 0,
    browserProvider: () => undefined,
    browserDeltas: () => ({}),
    signed: (value: number) => (value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : ""),
    browserOpenRows: () => [],
    browserOpenTokens: () => 0,
    browserOpenShown: () => [],
    browserFlatRows: () => [],
    browserFlatTokens: () => 0,
    browserFlatShown: () => [],
    ...overrides,
  } as never
}

/** Props shared by the details panel and its browser section. */
export function makeBrowserPanelProps(overrides: Record<string, unknown> = {}): BrowserPanelProps {
  return {
    session: makeSessionModel(),
    trend: makeTrendModel(),
    timing: makeTimingModel(),
    browser: makeBrowserModel(),
    ui: makeBrowserUi(),
    attachTrendScroll: () => {},
    attachTimingScroll: () => {},
    attachBrowserAnchor: () => {},
    attachBrowserSelect: () => {},
    measureTrendWindow: () => {},
    measureTimingWindow: () => {},
    refreshTrendWindow: () => {},
    refreshTimingWindow: () => {},
    scrollToBrowser: () => {},
    ...overrides,
  } as unknown as BrowserPanelProps
}
