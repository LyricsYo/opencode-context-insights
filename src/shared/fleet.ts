import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import { buildCost, type PriceBook } from "./cost.ts"
import type { HeaderSummary } from "./header.ts"
import { buildSessionIndex, buildSurface, isDelegationTool, isQuestionTool, userSurface, type StepComposition, type SurfaceEntry } from "./report.ts"

export const LEAD_HUE = "#5b8def"

const SLOT_MAX = 260
const SLOT_MIN = 160
const CARD_H = 112
const CARD_GUTTER = 12
const LEVEL_H = CARD_H + 56
const PAD_Y = 16

export interface FleetNode {
  readonly id: string
  readonly parentID?: string
  readonly title: string
  readonly agent?: string
  readonly provider?: string
  readonly model?: string
  readonly directory: string
  readonly createdAt: number
  readonly updatedAt: number
  readonly running: boolean
  readonly completed: boolean
  readonly outcome?: "succeeded" | "failed" | "interrupted"
  readonly prompt: number
  /** Completion tokens, including reasoning. */
  readonly output: number
  readonly reasoning: number
  readonly cacheRead: number
  readonly cacheWrite: number
  readonly cost: number
  /** Wall span of the last run; cards show cumulative active time from the timeline instead. */
  readonly duration?: number
  readonly idle?: number
  readonly depth: number
  readonly family: number
  readonly isCurrent: boolean
}

export interface FleetEdge {
  readonly from: string
  readonly to: string
}

export interface FleetForest {
  readonly nodes: readonly FleetNode[]
  readonly edges: readonly FleetEdge[]
  readonly rootID: string
  readonly solo: boolean
}

export interface FleetTotals {
  readonly agents: number
  readonly running: number
  readonly prompt: number
  readonly output: number
  readonly cost: number
}

/** The last run's wall span; the UI shows cumulative active time from `fleetActiveOf`. */
export function fleetDurationOf(time: SessionInfo["time"], running: boolean, now: number): number | undefined {
  const end = running ? now : (time.idle ?? time.updated)
  const start = time.busy ?? time.created
  const ms = end - start
  return ms > 0 ? ms : undefined
}

/**
 * The current session's family: its top ancestor and every descendant below it.
 * Siblings of the current session are included because they share the root.
 */
export function buildFleet(
  sessions: readonly SessionInfo[],
  currentID: string,
  runningOf: (id: string) => boolean,
  now = Date.now(),
): FleetForest {
  const byID = new Map(sessions.map((session) => [session.id, session]))
  const current = byID.get(currentID)
  if (current === undefined) return { nodes: [], edges: [], rootID: currentID, solo: true }

  let rootID = currentID
  const chain = new Set([rootID])
  for (;;) {
    const parent = byID.get(rootID)?.parentID
    if (parent === undefined || chain.has(parent) || !byID.has(parent)) break
    chain.add(parent)
    rootID = parent
  }
  const root = byID.get(rootID) as SessionInfo

  const childrenOf = new Map<string, SessionInfo[]>()
  for (const session of sessions) {
    if (session.parentID === undefined) continue
    // Archived siblings stay out, but an archived ancestor of the current session must still lead to it.
    if (session.time.archived !== undefined && !chain.has(session.id)) continue
    const list = childrenOf.get(session.parentID)
    if (list === undefined) childrenOf.set(session.parentID, [session])
    else list.push(session)
  }
  for (const list of childrenOf.values()) {
    // Same-level agents read in creation order; the visit below keeps each child's subtree under it.
    list.sort((left, right) => left.time.created - right.time.created || (left.id < right.id ? -1 : 1))
  }

  const nodes: FleetNode[] = []
  const edges: FleetEdge[] = []
  const seen = new Set<string>()
  const visit = (session: SessionInfo, depth: number, family: number, parentID?: string): void => {
    if (seen.has(session.id)) return
    seen.add(session.id)
    const running = runningOf(session.id)
    const title = session.title?.trim()
    const duration = fleetDurationOf(session.time, running, now)
    nodes.push({
      id: session.id,
      ...(parentID !== undefined ? { parentID } : {}),
      title: title !== undefined && title !== "" && !title.includes("<system-reminder>") ? title : (session.agent ?? session.id),
      ...(session.agent !== undefined ? { agent: session.agent } : {}),
      ...(session.model !== undefined ? { provider: session.model.providerID, model: session.model.id } : {}),
      directory: session.location?.directory ?? "",
      createdAt: session.time.created,
      updatedAt: session.time.updated,
      running,
      completed:
        !running &&
        (session.outcome === "succeeded" || (session.outcome === undefined && session.time.idle !== undefined)),
      ...(session.outcome !== undefined ? { outcome: session.outcome } : {}),
      prompt: session.tokens.input + session.tokens.cache.read + session.tokens.cache.write,
      // Completion total: OpenCode reports reasoning apart from visible output.
      output: session.tokens.output + session.tokens.reasoning,
      reasoning: session.tokens.reasoning,
      cacheRead: session.tokens.cache.read,
      cacheWrite: session.tokens.cache.write,
      cost: session.cost,
      ...(duration !== undefined ? { duration } : {}),
      ...(session.time.idle !== undefined ? { idle: session.time.idle } : {}),
      depth,
      family,
      isCurrent: session.id === currentID,
    })
    if (parentID !== undefined) edges.push({ from: parentID, to: session.id })
    const children = childrenOf.get(session.id) ?? []
    children.forEach((child, index) => visit(child, depth + 1, depth === 0 ? index : family, session.id))
  }
  visit(root, 0, -1)

  return { nodes, edges, rootID, solo: nodes.length === 1 }
}

export function fleetTotals(nodes: readonly FleetNode[]): FleetTotals {
  let running = 0
  let prompt = 0
  let output = 0
  let cost = 0
  for (const node of nodes) {
    if (node.running) running += 1
    prompt += node.prompt
    output += node.output
    cost += node.cost
  }
  return { agents: nodes.length, running, prompt, output, cost }
}

export interface FleetPoint {
  readonly id: string
  readonly x: number
  readonly y: number
  readonly depth: number
}

export interface FleetLink {
  readonly from: string
  readonly to: string
  readonly running: boolean
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}

export interface FleetLayout {
  readonly width: number
  readonly height: number
  readonly cardWidth: number
  readonly points: readonly FleetPoint[]
  readonly links: readonly FleetLink[]
  readonly banded: boolean
}

/** A tidy tree: leaves share the width, parents centre above their children; wide families wrap into bands. */
export function layoutFleet(forest: FleetForest, stageWidth = 0): FleetLayout {
  const childrenOf = new Map<string, FleetNode[]>()
  for (const node of forest.nodes) {
    if (node.parentID === undefined) continue
    const list = childrenOf.get(node.parentID)
    if (list === undefined) childrenOf.set(node.parentID, [node])
    else list.push(node)
  }

  const slotOf = new Map<string, number>()
  let leafSlots = 0
  const place = (node: FleetNode): number => {
    const children = childrenOf.get(node.id) ?? []
    if (children.length === 0) {
      const slot = leafSlots
      leafSlots += 1
      slotOf.set(node.id, slot)
      return slot
    }
    let first = 0
    let last = 0
    children.forEach((child, index) => {
      const slot = place(child)
      if (index === 0) first = slot
      last = slot
    })
    const slot = (first + last) / 2
    slotOf.set(node.id, slot)
    return slot
  }
  const root = forest.nodes[0]
  if (root !== undefined) place(root)

  const perLevel = stageWidth > 0 ? Math.max(1, Math.floor(stageWidth / SLOT_MIN)) : 0
  if (perLevel > 0 && leafSlots > perLevel && root !== undefined) {
    const bandSlot = Math.min(SLOT_MAX, stageWidth / perLevel)
    const width = perLevel * bandSlot
    const points: FleetPoint[] = []
    let row = 0
    const emitBand = (band: readonly FleetNode[], depth: number): void => {
      const inset = (width - band.length * bandSlot) / 2
      band.forEach((node, index) => {
        points.push({ id: node.id, x: inset + (index + 0.5) * bandSlot, y: PAD_Y + row * LEVEL_H, depth })
      })
      row += 1
      let next: FleetNode[] = []
      const flush = (): void => {
        if (next.length === 0) return
        const packed = next
        next = []
        emitBand(packed, depth + 1)
      }
      for (const node of band) {
        const children = childrenOf.get(node.id) ?? []
        for (let start = 0; start < children.length; start += perLevel) {
          const group = children.slice(start, start + perLevel)
          if (next.length + group.length > perLevel) flush()
          next.push(...group)
          if (next.length === perLevel) flush()
        }
      }
      flush()
    }
    emitBand([root], 0)
    return {
      width,
      height: PAD_Y + (row - 1) * LEVEL_H + CARD_H + 24,
      cardWidth: bandSlot - CARD_GUTTER,
      points,
      links: linksOf(forest, points),
      banded: true,
    }
  }

  const slot = stageWidth > 0 && leafSlots > 1 ? Math.min(SLOT_MAX, stageWidth / leafSlots) : SLOT_MAX
  const points = forest.nodes.map((node) => ({
    id: node.id,
    x: (slotOf.get(node.id) ?? 0) * slot + slot / 2,
    y: PAD_Y + node.depth * LEVEL_H,
    depth: node.depth,
  }))
  const maxDepth = points.reduce((max, point) => Math.max(max, point.depth), 0)
  return {
    width: leafSlots * slot,
    height: PAD_Y + maxDepth * LEVEL_H + CARD_H + 24,
    cardWidth: slot - CARD_GUTTER,
    points,
    links: linksOf(forest, points),
    banded: false,
  }
}

function linksOf(forest: FleetForest, points: readonly FleetPoint[]): FleetLink[] {
  const pointOf = new Map(points.map((point) => [point.id, point]))
  const nodeOf = new Map(forest.nodes.map((node) => [node.id, node]))
  const links: FleetLink[] = []
  for (const edge of forest.edges) {
    const from = pointOf.get(edge.from)
    const to = pointOf.get(edge.to)
    if (from === undefined || to === undefined) continue
    links.push({
      from: edge.from,
      to: edge.to,
      running: nodeOf.get(edge.to)?.running === true,
      x1: from.x,
      y1: from.y + CARD_H,
      x2: to.x,
      y2: to.y,
    })
  }
  return links
}

export function familyHue(index: number): string {
  return `hsl(${Math.round(index * 137.508) % 360} 58% 52%)`
}

export interface FleetRow {
  readonly id: string
  readonly messageID: string
  readonly at: number
  readonly kind: string
  readonly name: string
  readonly text: string
}

const FLEET_ROW_KINDS = new Set<SurfaceEntry["kind"]>(["user", "reply", "skill", "synthetic", "system"])

function fleetRowOf(entry: SurfaceEntry): FleetRow {
  return {
    id: entry.id,
    messageID: entry.messageID,
    at: entry.at,
    kind: entry.kind,
    name: entry.name,
    text: entry.text,
  }
}

interface FleetRowStamp {
  readonly created: number
  readonly end: number
  readonly parts: number
  readonly text: number
}

const fleetRowCache = new WeakMap<SessionMessageInfo, { stamp: FleetRowStamp; rows: FleetRow[] }>()

/** Cheap fields that change the rows; the host mutates message objects in place. */
function fleetRowStampOf(message: SessionMessageInfo): FleetRowStamp {
  if (message.type === "assistant") {
    let text = 0
    for (const part of message.content) if (part.type === "text") text += part.text.length
    return {
      created: message.time.created,
      end: message.time.completed ?? message.time.streamed ?? 0,
      parts: message.content.length,
      text,
    }
  }
  if (message.type === "compaction") {
    return {
      created: message.time.created,
      end: message.status === "completed" ? 1 : 0,
      parts: 0,
      text: "summary" in message ? message.summary.length : 0,
    }
  }
  return {
    created: message.time.created,
    end: 0,
    parts: 0,
    text: "text" in message ? message.text.length : 0,
  }
}

function sameStamp(left: FleetRowStamp, right: FleetRowStamp): boolean {
  return left.created === right.created && left.end === right.end && left.parts === right.parts && left.text === right.text
}

/** One message's inspector rows, cached until that message's visible fields move. */
export function fleetRowsOfMessage(message: SessionMessageInfo): FleetRow[] {
  const stamp = fleetRowStampOf(message)
  const cached = fleetRowCache.get(message)
  if (cached !== undefined && sameStamp(cached.stamp, stamp)) return cached.rows
  const rows = rowsOfSurface(buildSurface([message], undefined, true, true, FLEET_ROW_KINDS))
  // The streaming tail changes every tick; let it skip the cache until it settles.
  if (message.type !== "assistant" || message.time.completed !== undefined) {
    fleetRowCache.set(message, { stamp, rows })
  }
  return rows
}

/** Every message row in the session, including the history a compaction replaced. */
function rowsOfSurface(surface: readonly SurfaceEntry[]): FleetRow[] {
  return surface.filter((entry) => entry.text.trim() !== "").map(fleetRowOf)
}

export interface FleetText {
  readonly at: number
  readonly text: string
}

/** Aggregates the fleet cards, chips and delegation matching need; no transcript. */
export interface FleetHead {
  readonly prompt?: FleetText
  readonly steps: number
  readonly composition?: StepComposition
  /** models.dev estimate when the book is loaded, else the provider total. */
  readonly cost?: number
}

export interface FleetDetail extends FleetHead {
  readonly reply?: FleetText
  readonly rows: readonly FleetRow[]
}

/** Cheap per-agent summary: steps, context mix, cost and the first prompt. */
export function fleetHeadOf(
  messages: readonly SessionMessageInfo[],
  versions: readonly HeaderSummary[] | undefined,
  book?: PriceBook,
): FleetHead {
  // One walk yields both the step count and the last step's composition; the cards never read items.
  const index = buildSessionIndex(messages, versions ?? [])
  const last = index.scan.steps.at(-1)
  let composition: StepComposition | undefined
  if (last !== undefined) {
    composition = {
      total: last.total,
      byCategory: last.byCategory,
      items: [],
      prompt: last.prompt,
      headerPending: versions === undefined,
      headerMissing: versions !== undefined && last.headerMissing,
    }
  }

  let firstUser: { at: number; text: string } | undefined
  for (const message of messages) {
    if (message.type === "user" && message.text.trim() !== "" && userSurface(message.text).kind === "user") {
      firstUser = { at: message.time.created, text: message.text }
      break
    }
  }

  return {
    ...(firstUser !== undefined ? { prompt: firstUser } : {}),
    steps: index.steps.length,
    ...(composition !== undefined ? { composition } : {}),
    ...(index.steps.length > 0 ? { cost: buildCost(messages, book).total } : {}),
  }
}

/** Prompt, last reply, transcript and context mix from the host's message store. */
export function fleetDetailOf(
  messages: readonly SessionMessageInfo[],
  versions: readonly HeaderSummary[] | undefined,
  book?: PriceBook,
  head: FleetHead = fleetHeadOf(messages, versions, book),
): FleetDetail {
  // The inspector is a transcript, not the current request: keep messages a compaction replaced.
  const rows: FleetRow[] = []
  for (const message of messages) {
    for (const row of fleetRowsOfMessage(message)) rows.push(row)
  }
  let lastReply: { at: number; text: string } | undefined
  for (let index = messages.length - 1; index >= 0 && lastReply === undefined; index--) {
    const message = messages[index]
    if (message.type !== "assistant") continue
    const text = message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim()
    if (text !== "") lastReply = { at: message.time.created, text }
  }
  return {
    ...head,
    ...(lastReply !== undefined ? { reply: lastReply } : {}),
    rows,
  }
}

export interface FleetChildRef {
  readonly id: string
  readonly title: string
  readonly createdAt: number
  /** The child's first user message, used to match older calls without a session id. */
  readonly prompt?: string
}

export interface FleetDelegation {
  readonly parentID: string
  readonly at: number
  readonly description: string
  readonly agent?: string
  readonly prompt?: string
  readonly status?: string
  readonly result?: string
  readonly childID?: string
  readonly childTitle?: string
  /** The child id came from the call's metadata, input or output. */
  readonly exact: boolean
}

const SESSION_ID = /\bses_[A-Za-z0-9]+/g

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function textOfContent(value: unknown): string {
  if (!Array.isArray(value)) return ""
  const texts: string[] = []
  for (const raw of value) {
    const part = objectOf(raw)
    if (part?.type === "text" && typeof part.text === "string") texts.push(part.text)
  }
  return texts.join("\n").trim()
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase()
}

function childFromSessionID(children: readonly FleetChildRef[], id: string | undefined): FleetChildRef | undefined {
  return id === undefined ? undefined : children.find((child) => child.id === id)
}

function matchChild(
  children: readonly FleetChildRef[],
  description: string,
  prompt: string | undefined,
  at: number,
  used: ReadonlySet<string>,
): FleetChildRef | undefined {
  const available = children.filter((child) => !used.has(child.id))
  const label = normalizeText(description)
  const title = available.find((child) => normalizeText(child.title) === label)
  if (title !== undefined) return title

  const wanted = prompt === undefined ? "" : normalizeText(prompt)
  if (wanted !== "") {
    const exact = available.find((child) => child.prompt !== undefined && normalizeText(child.prompt) === wanted)
    if (exact !== undefined) return exact
    const prefix = available.find((child) => {
      if (child.prompt === undefined) return false
      const text = normalizeText(child.prompt)
      return text.startsWith(wanted) || wanted.startsWith(text)
    })
    if (prefix !== undefined) return prefix
  }

  return available
    .filter((child) => Math.abs(child.createdAt - at) <= 5 * 60_000)
    .sort((left, right) => Math.abs(left.createdAt - at) - Math.abs(right.createdAt - at))[0]
}

/**
 * Reads the session's `subagent`/`task` calls and pairs each with the child session it spawned.
 * The tool result carries the child session id; older calls without one fall back to title, prompt
 * and creation time.
 */
export function delegationsOf(
  parentID: string,
  messages: readonly SessionMessageInfo[],
  children: readonly FleetChildRef[],
): FleetDelegation[] {
  const rows: FleetDelegation[] = []
  const used = new Set<string>()
  for (const message of messages) {
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool" || !isDelegationTool(part.name)) continue
      const state = part.state
      if (state.status === "streaming") continue
      const input = objectOf(state.input)
      const metadata = "metadata" in state ? objectOf(state.metadata) : undefined
      const content = "content" in state ? textOfContent(state.content) : ""
      const outputID = [...content.matchAll(SESSION_ID)][0]?.[0]
      const target =
        stringOf(input?.sessionID) ??
        stringOf(input?.task_id) ??
        stringOf(metadata?.sessionID) ??
        stringOf(metadata?.sessionId) ??
        outputID
      const known = childFromSessionID(children, target)
      const description =
        stringOf(input?.description) ?? stringOf(input?.agent) ?? stringOf(input?.subagent_type) ?? "Subagent"
      const agent = stringOf(input?.agent) ?? stringOf(input?.subagent_type)
      const prompt = stringOf(input?.prompt)
      let child = known
      if (child === undefined) {
        child = matchChild(children, description, prompt, part.time.created, used)
        if (child !== undefined) used.add(child.id)
      }
      rows.push({
        parentID,
        at: part.time.created,
        description,
        ...(agent !== undefined ? { agent } : {}),
        ...(prompt !== undefined ? { prompt } : {}),
        status: state.status,
        ...(content !== "" ? { result: content } : {}),
        ...(child !== undefined ? { childID: child.id, childTitle: child.title } : {}),
        exact: known !== undefined,
      })
    }
  }
  return rows
}

export interface FleetSpan {
  readonly start: number
  readonly end: number
}

const TURN_GAP = 30 * 60_000
const MISSING_STEP = 5 * 60_000
const TIMELINE_TICKS = 5
const TIMELINE_BUCKETS = 60

function nextCreatedAt(messages: readonly SessionMessageInfo[], from: number): number | undefined {
  for (let index = from + 1; index < messages.length; index++) return messages[index].time.created
  return undefined
}

/**
 * Active periods for one agent. Assistant steps in the same turn merge across tool gaps; a user
 * message starts a new period, so idle waits between turns stay empty. Question waits and time
 * spent waiting for a delegated subagent are cut out.
 */
export function fleetSpansOf(
  messages: readonly SessionMessageInfo[],
  node: Pick<FleetNode, "createdAt" | "updatedAt" | "idle" | "running">,
  now: number,
): FleetSpan[] {
  const spans: Array<{ start: number; end: number }> = []
  const cuts: Array<{ start: number; end: number }> = []
  let current: { start: number; end: number } | undefined
  const flush = (): void => {
    if (current !== undefined && current.end > current.start) spans.push(current)
    current = undefined
  }
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    if (message.type === "user") {
      flush()
      continue
    }
    // An idle message ends an execution: the agent waits for background subagents or the user,
    // so the next execution must not merge across that wait.
    if (message.type === "idle") {
      if (current !== undefined) current.end = Math.min(current.end, message.time.created)
      flush()
      continue
    }
    if (message.type !== "assistant") continue
    for (const part of message.content) {
      if (part.type !== "tool") continue
      if (!isQuestionTool(part.name) && !isDelegationTool(part.name)) continue
      // Only cut once the tool actually started; streaming input is still the agent working.
      if (part.time.ran === undefined && part.time.completed === undefined) continue
      const start = part.time.ran ?? part.time.created
      const end =
        part.time.completed ?? (part.state.status === "running" && node.running ? now : undefined)
      if (end !== undefined && end > start) cuts.push({ start, end })
    }
    const start = message.time.created
    let end = message.time.completed ?? message.time.streamed
    if (end === undefined) {
      const next = nextCreatedAt(messages, index)
      end = next === undefined ? start + MISSING_STEP : Math.min(next, start + MISSING_STEP)
    }
    if (end <= start) continue
    if (current === undefined) current = { start, end }
    else if (start - current.end <= TURN_GAP) current.end = Math.max(current.end, end)
    else {
      flush()
      current = { start, end }
    }
  }
  flush()

  if (spans.length === 0) {
    // No assistant step yet: a running agent gets a bar from creation; a finished one gets a tick.
    if (!node.running) return []
    return subtractSpans([{ start: node.createdAt, end: Math.max(now, node.createdAt + 1_000) }], cuts)
  }
  const last = spans[spans.length - 1]
  if (node.running) {
    // A running tail must not extrapolate to the wall clock: a stale running flag would stretch
    // it forever. Use the last observed activity and quantise it to the timeline's 5s resolution,
    // so streamed chunks move the bar in 1px steps instead of re-laying the view out per chunk.
    const observed = Math.max(last.end, node.updatedAt)
    const end = Math.max(last.start + 1, Math.min(now, Math.floor(observed / 5_000) * 5_000))
    spans[spans.length - 1] = { start: last.start, end }
  } else {
    const end = node.idle ?? last.end
    if (end > last.end) spans[spans.length - 1] = { start: last.start, end }
  }
  return subtractSpans(spans, cuts)
}

function subtractSpans(
  spans: readonly { readonly start: number; readonly end: number }[],
  cuts: readonly { readonly start: number; readonly end: number }[],
): FleetSpan[] {
  if (cuts.length === 0) return spans.map((span) => ({ start: span.start, end: span.end }))
  const sorted = [...cuts].sort((left, right) => left.start - right.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const cut of sorted) {
    const previous = merged[merged.length - 1]
    if (previous !== undefined && cut.start <= previous.end) previous.end = Math.max(previous.end, cut.end)
    else merged.push({ start: cut.start, end: cut.end })
  }
  const output: FleetSpan[] = []
  for (const span of spans) {
    let pieces: Array<{ start: number; end: number }> = [{ start: span.start, end: span.end }]
    for (const cut of merged) {
      const next: Array<{ start: number; end: number }> = []
      for (const piece of pieces) {
        if (cut.end <= piece.start || cut.start >= piece.end) {
          next.push(piece)
          continue
        }
        if (cut.start > piece.start) next.push({ start: piece.start, end: cut.start })
        if (cut.end < piece.end) next.push({ start: cut.end, end: piece.end })
      }
      pieces = next
    }
    output.push(...pieces)
  }
  return output.filter((piece) => piece.end > piece.start)
}

export interface FleetTimelineRow {
  readonly node: FleetNode
  readonly spans: readonly FleetSpan[]
  /** First span start, or the session's creation time when it has no assistant steps yet. */
  readonly start: number
  readonly end: number
}

export interface FleetTimelineLink {
  readonly parentID: string
  readonly childID: string
  readonly at: number
  readonly childStart: number
  readonly from: number
  readonly to: number
}

export interface FleetTimelineSegment {
  readonly start: number
  readonly end: number
  readonly from: number
  readonly to: number
  /** Real idle gap before this segment, collapsed to zero width. */
  readonly gap: number
}

export interface FleetTimelineTick {
  readonly at: number
  readonly position: number
}

export interface FleetTimeline {
  readonly rows: readonly FleetTimelineRow[]
  readonly start: number
  readonly end: number
  readonly now: number
  readonly ticks: readonly FleetTimelineTick[]
  readonly buckets: readonly number[]
  readonly peak: number
  readonly links: readonly FleetTimelineLink[]
  readonly segments: readonly FleetTimelineSegment[]
  /** Wall time with at least one active agent; idle gaps and question waits are excluded. */
  readonly active: number
  /** Sum of every agent's active time; parallel work counts once per agent. */
  readonly activeSum: number
}

/** Maps a real timestamp to its compressed 0..1 position; idle gaps collapse to one point. */
export function fleetPositionOf(timeline: Pick<FleetTimeline, "segments">, at: number): number {
  const segments = timeline.segments
  if (segments.length === 0) return 0
  let chosen = segments[0]
  for (const segment of segments) {
    if (segment.start <= at) chosen = segment
    else break
  }
  if (at <= chosen.start) return chosen.from
  if (at >= chosen.end) return chosen.to
  return chosen.from + ((at - chosen.start) / (chosen.end - chosen.start)) * (chosen.to - chosen.from)
}

/** Maps a compressed 0..1 position back to a real timestamp. */
export function fleetTimeAt(timeline: Pick<FleetTimeline, "segments">, position: number): number {
  const segments = timeline.segments
  if (segments.length === 0) return 0
  for (const segment of segments) {
    if (position <= segment.from) return segment.start
    if (position <= segment.to) {
      const ratio = (position - segment.from) / (segment.to - segment.from)
      return segment.start + ratio * (segment.end - segment.start)
    }
  }
  return segments[segments.length - 1].end
}

/** One agent's cached spans, reused until its log or the structural version moves. */
export interface FleetSpanCacheEntry {
  readonly key: string
  readonly spans: FleetSpan[]
  readonly start: number
  readonly end: number
}

/** The fleet on a shared clock: active spans, parallelism, ticks and delegation arrows. */
export function buildFleetTimeline(
  forest: FleetForest,
  messagesOf: (id: string) => readonly SessionMessageInfo[],
  spawnAt: ReadonlyMap<string, number>,
  now = Date.now(),
  spanCache?: Map<string, FleetSpanCacheEntry>,
  structure = "",
): FleetTimeline {
  const rows = forest.nodes.map((node) => {
    const messages = messagesOf(node.id)
    const tail = messages.at(-1)
    const key = [
      structure,
      String(messages.length),
      tail?.id ?? "",
      String(tail?.time.created ?? 0),
      tail !== undefined && tail.type === "assistant" ? String(tail.time.completed ?? tail.time.streamed ?? 0) : "0",
      String(node.createdAt),
      String(node.idle ?? 0),
      node.running ? `1:${now}` : "0",
    ].join("|")
    const cached = spanCache?.get(node.id)
    if (cached !== undefined && cached.key === key) {
      return { node, spans: cached.spans, start: cached.start, end: cached.end }
    }
    const spans = fleetSpansOf(messages, node, now)
    const start = spans[0]?.start ?? node.createdAt
    const end = spans[spans.length - 1]?.end ?? node.createdAt
    if (spanCache !== undefined) {
      spanCache.set(node.id, { key, spans, start, end })
      if (spanCache.size > 256) spanCache.delete(spanCache.keys().next().value as string)
    }
    return { node, spans, start, end }
  })

  let realStart = Number.POSITIVE_INFINITY
  let realEnd = Number.NEGATIVE_INFINITY
  for (const row of rows) {
    realStart = Math.min(realStart, row.start)
    realEnd = Math.max(realEnd, row.end, row.node.createdAt)
  }
  for (const at of spawnAt.values()) {
    realStart = Math.min(realStart, at)
    realEnd = Math.max(realEnd, at)
  }
  if (!Number.isFinite(realStart) || !Number.isFinite(realEnd)) {
    realStart = now - 60_000
    realEnd = now
  }
  if (realEnd <= realStart) realEnd = realStart + 60_000

  const intervals: Array<{ start: number; end: number }> = []
  for (const row of rows) {
    for (const span of row.spans) intervals.push({ start: span.start, end: span.end })
  }
  intervals.sort((left, right) => left.start - right.start)
  const merged: Array<{ start: number; end: number }> = []
  for (const interval of intervals) {
    const previous = merged[merged.length - 1]
    // Keep gaps up to a few seconds so turns do not fragment into slivers.
    if (previous !== undefined && interval.start - previous.end <= 5_000) {
      previous.end = Math.max(previous.end, interval.end)
    } else {
      merged.push({ start: interval.start, end: interval.end })
    }
  }
  const activeSum = rows.reduce(
    (sum, row) => sum + row.spans.reduce((rowSum, span) => rowSum + (span.end - span.start), 0),
    0,
  )
  const active = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0)

  let segments: FleetTimelineSegment[]
  if (merged.length === 0) {
    segments = [{ start: realStart, end: realEnd, from: 0, to: 1, gap: 0 }]
  } else {
    const total = merged.reduce((sum, interval) => sum + (interval.end - interval.start), 0)
    const pad = 0.015
    let cursor = pad
    segments = merged.map((interval, index) => {
      const from = cursor
      const to =
        index === merged.length - 1
          ? 1 - pad
          : cursor + ((interval.end - interval.start) / total) * (1 - pad * 2)
      cursor = to
      return {
        start: interval.start,
        end: interval.end,
        from,
        to,
        gap: index === 0 ? 0 : Math.max(0, interval.start - merged[index - 1].end),
      }
    })
  }

  const start = segments[0].start
  const end = segments[segments.length - 1].end
  const realSpan = end - start
  const tickCount =
    realSpan < 10 * 60_000 || (realSpan >= 24 * 3600_000 && realSpan < 7 * 24 * 3600_000)
      ? 3
      : TIMELINE_TICKS
  const ticks: FleetTimelineTick[] = Array.from({ length: tickCount }, (_, index) => {
    const position = index / (tickCount - 1)
    return { at: fleetTimeAt({ segments }, position), position }
  })
  const buckets = Array.from({ length: TIMELINE_BUCKETS }, (_, index) => {
    const at = fleetTimeAt({ segments }, (index + 0.5) / TIMELINE_BUCKETS)
    let count = 0
    for (const row of rows) {
      if (row.spans.some((span) => span.start <= at && span.end > at)) count += 1
    }
    return count
  })

  const events: Array<[number, number]> = []
  for (const row of rows) {
    for (const span of row.spans) events.push([span.start, 1], [span.end, -1])
  }
  events.sort((left, right) => left[0] - right[0] || left[1] - right[1])
  let current = 0
  let peak = 0
  for (const [, delta] of events) {
    current += delta
    if (current > peak) peak = current
  }

  const rowOf = new Map(rows.map((row, index) => [row.node.id, index]))
  const links: FleetTimelineLink[] = []
  for (const row of rows) {
    if (row.node.parentID === undefined) continue
    const at = spawnAt.get(row.node.id) ?? row.node.createdAt
    const from = rowOf.get(row.node.parentID)
    const to = rowOf.get(row.node.id)
    if (from === undefined || to === undefined) continue
    links.push({ parentID: row.node.parentID, childID: row.node.id, at, childStart: row.start, from, to })
  }

  return { rows, start, end, now, ticks, buckets, peak, links, segments, active, activeSum }
}
