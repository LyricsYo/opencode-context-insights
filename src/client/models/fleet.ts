import { createMemo, createSignal, untrack, type Accessor } from "solid-js"
import type { SessionMessageInfo } from "@opencode/client"
import type { PanelProps } from "@opencode/plugin/gui"
import { CATEGORY_ORDER, type Category } from "../../shared/estimate.ts"
import type { PriceBook } from "../../shared/cost.ts"
import type { HeaderSummary } from "../../shared/header.ts"
import { buildFleet, buildFleetTimeline, delegationsOf, fleetDetailOf, fleetHeadOf, fleetRowsOfMessage, fleetTotals, layoutFleet, type FleetDelegation, type FleetDetail, type FleetHead, type FleetNode, type FleetSpanCacheEntry, type FleetTimeline } from "../../shared/fleet.ts"
import { fleetHeadCache, NO_FLEET_DELEGATIONS, NO_FLEET_FOREST, NO_FLEET_HEADS, NO_FLEET_HUES, NO_FLEET_TIMELINE, type PanelView } from "../panelSupport.ts"
import { fleetHue } from "../fleetModel.ts"

export interface FleetModelParams {
  readonly props: PanelProps
  readonly view: Accessor<PanelView>
  readonly headers: Accessor<HeaderSummary[] | undefined>
  readonly priceBook: Accessor<PriceBook | undefined>
  readonly structureTick: Accessor<number>
  readonly childStructureTick: Accessor<number>
  readonly fleetLoadedTick: Accessor<number>
  readonly streamTick: Accessor<number>
}

/**
 * What the timeline view actually draws. A forest rebuild caused by token / cost churn must
 * not hand the view a new object: that re-renders ticks, gaps and links and looks like jitter.
 */
function timelineSignature(timeline: FleetTimeline): string {
  let signature = `${timeline.now}|${timeline.start}|${timeline.end}|${timeline.active}|${timeline.activeSum}|${timeline.peak}`
  for (const row of timeline.rows) {
    signature += `|${row.node.id}|${row.node.title}|${row.node.running ? 1 : 0}|${row.node.completed ? 1 : 0}|${row.node.outcome ?? ""}|${row.node.family}|${row.node.isCurrent ? 1 : 0}|${row.node.depth}|${row.node.createdAt}`
    for (const span of row.spans) signature += `,${span.start}:${span.end}`
  }
  for (const segment of timeline.segments) {
    signature += `|s${segment.start}:${segment.end}:${segment.from}:${segment.to}:${segment.gap}`
  }
  for (const tick of timeline.ticks) signature += `|t${tick.at}:${tick.position}`
  for (const bucket of timeline.buckets) signature += `|b${bucket}`
  for (const link of timeline.links) {
    signature += `|l${link.parentID}:${link.childID}:${link.at}:${link.childStart}:${link.from}:${link.to}`
  }
  return signature
}

export function createFleetModel(params: FleetModelParams) {
  const { props, view, headers, priceBook, structureTick, childStructureTick, fleetLoadedTick, streamTick } = params
  const data = () => props.session.server.data
  const [fleetPinned, setFleetPinned] = createSignal<string>()
  const [fleetFocus, setFleetFocus] = createSignal<string>()
  const [fleetHover, setFleetHover] = createSignal<string>()
  const [fleetMode, setFleetMode] = createSignal<"timeline" | "tree">("timeline")
  const [fleetTimelineFit, setFleetTimelineFit] = createSignal<"adaptive" | "overview">("adaptive")
  const [fleetNow, setFleetNow] = createSignal(Date.now())
  const [fleetHeaders, setFleetHeaders] = createSignal<ReadonlyMap<string, readonly HeaderSummary[]>>(new Map())
  const [fleetStageWidth, setFleetStageWidth] = createSignal(420)
  /** Built once for the fleet tab and the overview's subagent circles, so both show the same hues. */
  const fleetForest = createMemo(() => {
    if (view() !== "fleet" && view() !== "overview") return NO_FLEET_FOREST
    return buildFleet(data().session.list(), props.session.id, (id) => data().session.status(id) === "running")
  })
  const fleet = createMemo(() => (view() === "fleet" ? fleetForest() : NO_FLEET_FOREST))
  /** Hue per session id, exactly as the fleet draws it; the overview's circles read the same value. */
  const fleetHues = createMemo(() => {
    if (view() !== "overview") return NO_FLEET_HUES
    const hues = new Map<string, string>()
    for (const node of fleetForest().nodes) hues.set(node.id, fleetHue(node))
    return hues
  })
  const fleetByID = createMemo(() => new Map(fleet().nodes.map((node) => [node.id, node])))
  /** Boolean, so a rebuilt forest with the same running set does not restart the fleet clock. */
  const fleetRunning = createMemo(() => fleet().nodes.some((node) => node.running))
  const fleetCurrent = createMemo(() => fleet().nodes.find((node) => node.isCurrent) ?? fleet().nodes[0])
  const fleetInspected = createMemo(() => {
    const id = fleetPinned() ?? fleetHover()
    return (id === undefined ? undefined : fleetByID().get(id)) ?? fleetCurrent()
  })
  const fleetLayout = createMemo(() => layoutFleet(fleet(), fleetStageWidth()))
  const fleetLit = createMemo(() => {
    const id = fleetHover() ?? fleetPinned()
    if (id === undefined) return undefined
    const lit = new Set([id])
    for (const edge of fleet().edges) {
      if (edge.from === id) lit.add(edge.to)
      if (edge.to === id) lit.add(edge.from)
    }
    return lit
  })
  const fleetModelList = createMemo(() => {
    const location = props.session.location
    return location === undefined ? undefined : data().location.model.list(location)
  })
  const fleetLimitOf = (node: FleetNode): number | undefined => {
    const list = fleetModelList()
    if (list === undefined || node.provider === undefined || node.model === undefined) return undefined
    return list.find(
      (model) => model.providerID === node.provider && (model.id === node.model || model.modelID === node.model),
    )?.limit.context
  }
  /** Rebuild a card's head only when that agent's log or header list moved, not on every fleet wake. */
  const fleetHeadKeyOf = (node: FleetNode, versions: readonly HeaderSummary[] | undefined, book: PriceBook | undefined): string => {
    const list = data().session.message.list(node.id)
    const tail = list.at(-1)
    return [
      node.id,
      String(list.length),
      tail?.id ?? "",
      String(tail?.time.created ?? 0),
      tail !== undefined && tail.type === "assistant" ? String(tail.time.completed ?? tail.time.streamed ?? 0) : "0",
      String(versions?.length ?? -1),
      book === undefined ? "0" : "1",
    ].join("|")
  }
  let fleetHeadsLast: ReadonlyMap<string, FleetHead> | undefined
  const fleetHeads = createMemo(() => {
    if (view() !== "fleet") return NO_FLEET_HEADS
    // Heads do not depend on streamed text: wake on structural moves and finished history loads.
    structureTick()
    childStructureTick()
    fleetLoadedTick()
    const heads = new Map<string, FleetHead>()
    const fetched = fleetHeaders()
    const book = priceBook()
    const own = headers()
    for (const node of fleet().nodes) {
      const versions = node.id === props.session.id ? (own ?? fetched.get(node.id)) : fetched.get(node.id)
      // Read the child log untracked: raw deltas must not rebuild this map, the settled tick does.
      const key = untrack(() => fleetHeadKeyOf(node, versions, book))
      let head = fleetHeadCache.get(key)
      if (head === undefined) {
        head = untrack(() => fleetHeadOf(data().session.message.list(node.id), versions, book))
        fleetHeadCache.set(key, head)
        if (fleetHeadCache.size > 512) fleetHeadCache.delete(fleetHeadCache.keys().next().value as string)
      }
      heads.set(node.id, head)
    }
    const previous = fleetHeadsLast
    if (previous !== undefined && previous.size === heads.size) {
      let same = true
      for (const [id, head] of heads) {
        if (previous.get(id) !== head) {
          same = false
          break
        }
      }
      if (same) return previous
    }
    fleetHeadsLast = heads
    return heads
  })
  const fleetHeadIDs = new WeakMap<FleetHead, number>()
  let fleetHeadID = 0
  const fleetHeadVersion = (head: FleetHead): string => {
    const known = fleetHeadIDs.get(head)
    if (known !== undefined) return String(known)
    fleetHeadID += 1
    fleetHeadIDs.set(head, fleetHeadID)
    return String(fleetHeadID)
  }
  /** The inspector's transcript is built only for the agent it shows, not for every card. */
  const fleetDetailCache = new Map<string, FleetDetail>()
  const fleetDelegationCache = new Map<string, { key: string; rows: readonly FleetDelegation[] }>()
  // shortcut: delegation rows reuse while the parent log length/tail and child metadata hold; a late result that only edits an old tool payload needs a new message or step to invalidate.
  const fleetSpanCache = new Map<string, FleetSpanCacheEntry>()
  /** Replace only the streaming tail's rows; the rest of the transcript is reused. */
  const fleetLiveRows = (detail: FleetDetail, tail: SessionMessageInfo | undefined): FleetDetail => {
    if (tail?.type !== "assistant" || tail.time.completed !== undefined) return detail
    const live = fleetRowsOfMessage(tail)
    const rows = [...detail.rows.filter((row) => row.messageID !== tail.id), ...live]
    if (
      rows.length === detail.rows.length &&
      rows.every((row, index) => {
        const previous = detail.rows[index]
        return previous !== undefined && previous.id === row.id && previous.text === row.text
      })
    ) {
      return detail
    }
    return { ...detail, rows }
  }
  const fleetInspectedDetail = createMemo(() => {
    if (view() !== "fleet") return undefined
    const node = fleetInspected()
    if (node === undefined) return undefined
    // The inspected node comes from the same forest the heads map is built for.
    const head = fleetHeads().get(node.id) as FleetHead
    const fetched = fleetHeaders()
    const versions = node.id === props.session.id ? (headers() ?? fetched.get(node.id)) : fetched.get(node.id)
    // Wake on text and structure; only the log/head signature below decides whether the transcript is rebuilt.
    streamTick()
    structureTick()
    childStructureTick()
    const list = untrack(() => data().session.message.list(node.id))
    const tail = list.at(-1)
    // Reuse the transcript while hover moves between cards: only new or changed messages need a rebuild.
    const key = [
      node.id,
      String(list.length),
      tail?.id ?? "",
      tail?.time.created ?? 0,
      tail !== undefined && tail.type === "assistant" ? (tail.time.completed ?? tail.time.streamed ?? 0) : 0,
      fleetHeadVersion(head),
      String(versions?.length ?? -1),
      priceBook() === undefined ? "0" : "1",
    ].join("|")
    let detail = fleetDetailCache.get(key)
    if (detail === undefined) {
      detail = untrack(() => fleetDetailOf(list, versions, priceBook(), head))
      fleetDetailCache.set(key, detail)
      if (fleetDetailCache.size > 8) fleetDetailCache.delete(fleetDetailCache.keys().next().value as string)
    }
    return untrack(() => fleetLiveRows(detail, tail))
  })
  const fleetDelegations = createMemo(() => {
    if (view() !== "fleet") return NO_FLEET_DELEGATIONS
    const nodes = fleet().nodes
    const heads = fleetHeads()
    const childrenOf = new Map<string, FleetNode[]>()
    for (const node of nodes) {
      if (node.parentID === undefined) continue
      const list = childrenOf.get(node.parentID)
      if (list === undefined) childrenOf.set(node.parentID, [node])
      else list.push(node)
    }
    const delegations = new Map<string, readonly FleetDelegation[]>()
    for (const [parentID, children] of childrenOf) {
      const childRows = children.map((child) => {
        const prompt = heads.get(child.id)?.prompt?.text
        return {
          id: child.id,
          title: child.title,
          createdAt: child.createdAt,
          ...(prompt !== undefined ? { prompt } : {}),
        }
      })
      const messages = untrack(() => data().session.message.list(parentID))
      const tail = messages.at(-1)
      const key = [
        parentID,
        String(messages.length),
        tail?.id ?? "",
        String(tail?.time.created ?? 0),
        tail !== undefined && tail.type === "assistant" ? String(tail.time.completed ?? tail.time.streamed ?? 0) : "0",
        JSON.stringify(childRows),
      ].join("|")
      let entry = fleetDelegationCache.get(parentID)
      if (entry === undefined || entry.key !== key) {
        entry = { key, rows: untrack(() => delegationsOf(parentID, messages, childRows)) }
        fleetDelegationCache.set(parentID, entry)
        if (fleetDelegationCache.size > 64) fleetDelegationCache.delete(fleetDelegationCache.keys().next().value as string)
      }
      if (entry.rows.length > 0) delegations.set(parentID, entry.rows)
    }
    return delegations
  })
  const fleetIncoming = createMemo(() => {
    const map = new Map<string, { parent: FleetNode; delegation: FleetDelegation }>()
    const nodes = fleetByID()
    for (const [parentID, rows] of fleetDelegations()) {
      // Delegations are keyed by a node's parentID, so the parent is always in the same forest.
      const parent = nodes.get(parentID) as FleetNode
      for (const row of rows) {
        if (row.childID === undefined) continue
        const current = map.get(row.childID)
        if (current === undefined || row.at < current.delegation.at) {
          map.set(row.childID, { parent, delegation: row })
        }
      }
    }
    return map
  })
  const fleetChain = createMemo(() => {
    const id = fleetHover() ?? fleetPinned()
    if (id === undefined) return undefined
    const lit = new Set([id])
    let changed = true
    while (changed) {
      changed = false
      for (const edge of fleet().edges) {
        if (lit.has(edge.to) && !lit.has(edge.from)) {
          lit.add(edge.from)
          changed = true
        }
        if (lit.has(edge.from) && !lit.has(edge.to)) {
          lit.add(edge.to)
          changed = true
        }
      }
    }
    return lit
  })
  let fleetTimelineLast: { signature: string; timeline: FleetTimeline } | undefined
  const fleetTimeline = createMemo(() => {
    if (view() !== "fleet") return NO_FLEET_TIMELINE
    // Text deltas only move heads; spans follow structure, loads and the 15s clock.
    fleetLoadedTick()
    const structure = `${structureTick()}:${childStructureTick()}`
    const spawnAt = new Map<string, number>()
    for (const [childID, incoming] of fleetIncoming()) spawnAt.set(childID, incoming.delegation.at)
    const nodes = fleet()
    const now = fleetNow()
    const timeline = untrack(() =>
      buildFleetTimeline(
        nodes,
        (id) => data().session.message.list(id),
        spawnAt,
        now,
        fleetSpanCache,
        structure,
      ),
    )
    const signature = timelineSignature(timeline)
    if (fleetTimelineLast !== undefined && fleetTimelineLast.signature === signature) {
      return fleetTimelineLast.timeline
    }
    fleetTimelineLast = { signature, timeline }
    return timeline
  })
  const fleetActiveOf = createMemo(() => {
    const active = new Map<string, number>()
    for (const row of fleetTimeline().rows) {
      active.set(
        row.node.id,
        row.spans.reduce((sum, span) => sum + (span.end - span.start), 0),
      )
    }
    return active
  })
  const fleetSummary = createMemo(() => {
    const totals = fleetTotals(fleet().nodes)
    const heads = fleetHeads()
    let cost = 0
    for (const node of fleet().nodes) cost += heads.get(node.id)?.cost ?? node.cost
    return { ...totals, cost }
  })
  const fleetCategories = createMemo(() => {
    const present = new Set<Category>()
    for (const head of fleetHeads().values()) {
      const composition = head.composition
      if (composition === undefined) continue
      for (const category of CATEGORY_ORDER) if (composition.byCategory[category] > 0) present.add(category)
    }
    return CATEGORY_ORDER.filter((category) => present.has(category))
  })
  return {
    fleetPinned, setFleetPinned, fleetFocus, setFleetFocus, fleetHover, setFleetHover,
    fleetMode, setFleetMode, fleetTimelineFit, setFleetTimelineFit,
    fleetNow, setFleetNow, fleetHeaders, setFleetHeaders, fleetStageWidth, setFleetStageWidth,
    fleet, fleetByID, fleetCurrent, fleetInspected, fleetLayout, fleetLit, fleetModelList, fleetLimitOf,
    fleetRunning, fleetHues,
    fleetHeads, fleetInspectedDetail, fleetDelegations, fleetIncoming, fleetChain, fleetTimeline,
    fleetActiveOf, fleetSummary, fleetCategories,
  }
}
