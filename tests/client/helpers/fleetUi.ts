import { createMemo, createSignal } from "solid-js"
import type { Category } from "../../../src/shared/estimate.ts"
import {
  layoutFleet,
  type FleetDelegation,
  type FleetDetail,
  type FleetEdge,
  type FleetForest,
  type FleetHead,
  type FleetLink,
  type FleetNode,
  type FleetPoint,
  type FleetRow,
  type FleetTimeline,
  type FleetTimelineRow,
} from "../../../src/shared/fleet.ts"

export const FLEET_T0 = Date.UTC(2026, 10, 16, 8, 0)

/** A plain fleet node with the fields the card, inspector and timeline read. */
export function fleetNode(overrides: Partial<FleetNode> & { id: string }): FleetNode {
  return {
    title: overrides.id,
    directory: "",
    createdAt: FLEET_T0,
    updatedAt: FLEET_T0 + 60_000,
    running: false,
    completed: true,
    prompt: 100,
    output: 20,
    reasoning: 0,
    cacheRead: 0,
    cacheWrite: 0,
    cost: 0.01,
    depth: 0,
    family: -1,
    isCurrent: false,
    ...overrides,
  }
}

export function fleetForest(nodes: readonly FleetNode[], edges: readonly FleetEdge[] = []): FleetForest {
  return { nodes, edges, rootID: nodes[0]?.id ?? "", solo: nodes.length === 1 }
}

export function fleetTimelineRow(
  node: FleetNode,
  spans: readonly { start: number; end: number }[] = [],
): FleetTimelineRow {
  return {
    node,
    spans,
    start: spans[0]?.start ?? node.createdAt,
    end: spans[spans.length - 1]?.end ?? node.createdAt,
  }
}

/** A self-consistent timeline; callers override the pieces a scenario turns on. */
export function fleetTimelineOf(
  rows: readonly FleetTimelineRow[],
  overrides: Partial<FleetTimeline> = {},
): FleetTimeline {
  const start = rows.length > 0 ? Math.min(...rows.map((row) => row.start)) : FLEET_T0
  const end = rows.length > 0 ? Math.max(...rows.map((row) => row.end), start + 60_000) : start + 60_000
  const activeSum = rows.reduce(
    (sum, row) => sum + row.spans.reduce((rowSum, span) => rowSum + (span.end - span.start), 0),
    0,
  )
  return {
    rows,
    start,
    end,
    now: end,
    ticks: [],
    buckets: [],
    peak: 1,
    links: [],
    segments: [{ start, end, from: 0, to: 1, gap: 0 }],
    active: end - start,
    activeSum,
    ...overrides,
  }
}

export function fleetRow(index: number, overrides: Partial<FleetRow> = {}): FleetRow {
  return {
    id: `row-${index}`,
    messageID: `msg-${index}`,
    at: FLEET_T0 + index * 1_000,
    kind: "reply",
    name: "assistant",
    text: `message ${index}`,
    ...overrides,
  }
}

export function fleetHead(overrides: Partial<FleetHead> = {}): FleetHead {
  return { steps: 0, ...overrides }
}

export function fleetDetail(rows: readonly FleetRow[], overrides: Partial<FleetDetail> = {}): FleetDetail {
  return { steps: rows.length > 0 ? 1 : 0, rows, ...overrides }
}

export function fleetDelegation(
  overrides: Partial<FleetDelegation> & { parentID: string; at: number; description: string },
): FleetDelegation {
  return { exact: false, ...overrides }
}

export interface FleetModelOptions {
  readonly nodes?: readonly FleetNode[]
  readonly edges?: readonly FleetEdge[]
  readonly layout?: {
    width: number
    height: number
    cardWidth: number
    points: readonly FleetPoint[]
    links: readonly FleetLink[]
  }
  readonly heads?: ReadonlyMap<string, FleetHead>
  readonly details?: ReadonlyMap<string, FleetDetail>
  readonly delegations?: ReadonlyMap<string, readonly FleetDelegation[]>
  readonly incoming?: ReadonlyMap<string, { parent: FleetNode; delegation: FleetDelegation }>
  readonly timeline?: FleetTimeline
  readonly categories?: readonly Category[]
  readonly limitOf?: (node: FleetNode) => number | undefined
  readonly mode?: "timeline" | "tree"
  readonly fit?: "adaptive" | "overview"
  readonly focus?: string
  readonly fallbackToCurrent?: boolean
  readonly summary?: { agents: number; running: number; prompt: number; output: number; cost: number }
}

/**
 * A signal-backed stand-in for createFleetModel. Interactions (hover, pick, mode) mutate the
 * same accessors the panel reads, so assertions observe real behaviour rather than spies.
 */
export function makeFleetModel(options: FleetModelOptions = {}) {
  const nodes = options.nodes ?? []
  const edges = options.edges ?? []
  const byID = new Map(nodes.map((node) => [node.id, node]))
  const forest = fleetForest(nodes, edges)
  const layout = options.layout ?? layoutFleet(forest, 420)
  const [pinned, setPinned] = createSignal<string>()
  const [hover, setHover] = createSignal<string>()
  const [mode, setMode] = createSignal<"timeline" | "tree">(options.mode ?? "timeline")
  const [fit, setFit] = createSignal<"adaptive" | "overview">(options.fit ?? "adaptive")
  const [focus, setFocus] = createSignal(options.focus)
  const litOf = (id: string | undefined): ReadonlySet<string> | undefined => {
    if (id === undefined) return undefined
    const lit = new Set([id])
    for (const edge of edges) {
      if (edge.from === id) lit.add(edge.to)
      if (edge.to === id) lit.add(edge.from)
    }
    return lit
  }
  const inspected = createMemo(() => {
    const id = pinned() ?? hover()
    const found = id === undefined ? undefined : byID.get(id)
    return found ?? (options.fallbackToCurrent === true ? nodes[0] : undefined)
  })
  const lit = createMemo(() => litOf(hover() ?? pinned()))
  const heads = options.heads ?? new Map<string, FleetHead>()
  const details = options.details ?? new Map<string, FleetDetail>()
  const delegations = options.delegations ?? new Map<string, readonly FleetDelegation[]>()
  const incoming = options.incoming ?? new Map<string, { parent: FleetNode; delegation: FleetDelegation }>()
  const timeline = options.timeline ?? fleetTimelineOf(nodes.map((node) => fleetTimelineRow(node)))
  return {
    fleetPinned: pinned,
    setFleetPinned: setPinned,
    fleetFocus: focus,
    setFleetFocus: setFocus,
    fleetHover: hover,
    setFleetHover: setHover,
    fleetMode: mode,
    setFleetMode: setMode,
    fleetTimelineFit: fit,
    setFleetTimelineFit: setFit,
    fleet: () => forest,
    fleetByID: () => byID,
    fleetInspected: inspected,
    fleetLayout: () => layout,
    fleetLit: lit,
    fleetLimitOf: options.limitOf ?? (() => undefined),
    fleetHeads: () => heads,
    fleetInspectedDetail: () => {
      const node = inspected()
      return node === undefined ? undefined : details.get(node.id)
    },
    fleetDelegations: () => delegations,
    fleetIncoming: () => incoming,
    fleetChain: lit,
    fleetTimeline: () => timeline,
    fleetActiveOf: () =>
      new Map(
        timeline.rows.map((row) => [
          row.node.id,
          row.spans.reduce((sum, span) => sum + (span.end - span.start), 0),
        ]),
      ),
    fleetSummary: () =>
      options.summary ?? {
        agents: nodes.length,
        running: nodes.filter((node) => node.running).length,
        prompt: nodes.reduce((sum, node) => sum + node.prompt, 0),
        output: nodes.reduce((sum, node) => sum + node.output, 0),
        cost: nodes.reduce((sum, node) => sum + node.cost, 0),
      },
    fleetCategories: () => options.categories ?? [],
  }
}
