import { createEffect, createMemo, createSignal, onCleanup, untrack, type Accessor } from "solid-js"
import type { PanelProps } from "@opencode/plugin/gui"
import type { HeaderSummary } from "../../shared/header.ts"
import { buildChildren, buildCompactions, buildEvents, buildSessionIndex, generatedOfMessage } from "../../shared/report.ts"
import { NO_CHILDREN, NO_COMPACTIONS, NO_EVENTS, NO_SESSION_INDEX, NO_TOKEN_SCAN, SETTLE_MS, STRUCTURE_MS, type PanelView } from "../panelSupport.ts"

export interface SessionModelParams {
  readonly props: PanelProps
  readonly view: Accessor<PanelView>
  readonly headers: Accessor<HeaderSummary[] | undefined>
  readonly revision: Accessor<number>
}

export function createSessionModel(params: SessionModelParams) {
  const { props, view, headers, revision } = params
  const data = () => props.session.server.data
  const info = createMemo(() => {
    const source = data()
    const id = props.session.id
    return source.session.missing(id) ? undefined : source.session.get(id)
  })
  const messages = createMemo(() => data().session.message.list(props.session.id))
  /**
   * Streamed text rewrites the tail many times a second. Text-only surfaces read `settleTick`;
   * full-log scans read `structureTick`, which only moves on message / tool / step changes.
   */
  const [settleTick, setSettleTick] = createSignal(0)
  const [structureTick, setStructureTick] = createSignal(0)
  const [streamTick, setStreamTick] = createSignal(0)
  /** Wakes fleet cards/timeline when another session's message history finishes loading. */
  const [fleetLoadedTick, setFleetLoadedTick] = createSignal(0)
  /** Other sessions' structural changes; the fleet inspector watches the one it shows. */
  const [childStructureTick, setChildStructureTick] = createSignal(0)
  let settleTimer: ReturnType<typeof setTimeout> | undefined
  let streamTimer: ReturnType<typeof setTimeout> | undefined
  let structureTimer: ReturnType<typeof setTimeout> | undefined
  let childStructureTimer: ReturnType<typeof setTimeout> | undefined
  /** Tool / step bursts coalesce into one structural rescan per window. */
  const bumpStructure = () => {
    if (structureTimer !== undefined) return
    structureTimer = setTimeout(() => {
      structureTimer = undefined
      setStructureTick((value) => value + 1)
    }, STRUCTURE_MS)
  }
  /** Refreshes, restores and loaded history must rescan at once. */
  const flushStructure = () => {
    if (structureTimer !== undefined) {
      clearTimeout(structureTimer)
      structureTimer = undefined
    }
    setStructureTick((value) => value + 1)
  }
  const bumpChildStructure = () => {
    if (childStructureTimer !== undefined) return
    childStructureTimer = setTimeout(() => {
      childStructureTimer = undefined
      setChildStructureTick((value) => value + 1)
    }, STRUCTURE_MS)
  }
  /** Child-session fetches land one by one; coalesce their wakes into one fleet rescan per SETTLE_MS. */
  const bumpStream = () => {
    if (streamTimer !== undefined) return
    streamTimer = setTimeout(() => {
      streamTimer = undefined
      setStreamTick((value) => value + 1)
    }, SETTLE_MS)
  }
  const bumpFleetLoaded = () => setFleetLoadedTick((value) => value + 1)
  let settleCount = messages().length
  let settleRevision = revision()
  createEffect(() => {
    const list = messages()
    const count = list.length
    const rev = revision()
    // Subscribe to the streamed tail so text / reasoning / tool-input deltas reach the timer.
    const tail = list.at(-1)
    if (tail?.type === "assistant") {
      for (const part of tail.content) {
        if (part.type === "text" || part.type === "reasoning") void part.text
        else if (part.type === "tool" && part.state.status === "streaming") void part.state.input
      }
    }
    if (rev !== settleRevision || count !== settleCount) {
      settleRevision = rev
      settleCount = count
      if (settleTimer !== undefined) {
        clearTimeout(settleTimer)
        settleTimer = undefined
      }
      flushStructure()
      setSettleTick((value) => value + 1)
      return
    }
    if (settleTimer !== undefined) return
    settleTimer = setTimeout(() => {
      settleTimer = undefined
      setSettleTick((value) => value + 1)
    }, SETTLE_MS)
  })
  onCleanup(() => {
    if (settleTimer !== undefined) clearTimeout(settleTimer)
    if (streamTimer !== undefined) clearTimeout(streamTimer)
    if (structureTimer !== undefined) clearTimeout(structureTimer)
    if (childStructureTimer !== undefined) clearTimeout(childStructureTimer)
  })
  /** Run a full-session scan when the log structure moves, not on every streamed delta. */
  const scan = <T,>(build: () => T): T => {
    // A different session must rescan at once, even if its message count matches the last one.
    props.session.id
    structureTick()
    return untrack(build)
  }
  /** One structural walk feeds steps, token composition, the generated mix and event counts. */
  const sessionIndex = createMemo(() => {
    if (view() === "fleet") return NO_SESSION_INDEX
    const versions = headers() ?? []
    return scan(() =>
      buildSessionIndex(messages(), versions, {
        tools: true,
        workspace: props.session.directory,
        timing: true,
      }),
    )
  })
  const steps = createMemo(() => sessionIndex().steps)
  const turnCount = createMemo(() => sessionIndex().turnCount)
  const latest = createMemo(() => steps().at(-1))
  /** Full event rows are only rendered in the browser tab; other tabs read the counts below. */
  const events = createMemo(() =>
    view() === "browser" ? scan(() => buildEvents(messages())) : NO_EVENTS,
  )
  const tokenScanBase = createMemo(() => {
    if (view() === "fleet") {
      return { scan: NO_TOKEN_SCAN, tailID: undefined, tail: { reasoning: 0, answers: 0, calls: 0 } }
    }
    const scanValue = sessionIndex().scan
    const tail = untrack(() => messages().at(-1))
    return { scan: scanValue, tailID: tail?.id, tail: generatedOfMessage(tail) }
  })
  const tokenScan = createMemo(() => tokenScanBase().scan)
  const tokenSteps = createMemo(() => tokenScan().steps)
  const tools = createMemo(() => tokenScan().tools)
  /** Grow only the streamed tail's estimate; the history comes from the structural scan. */
  const generated = createMemo(() => {
    settleTick()
    const base = tokenScanBase()
    const tail = untrack(() => messages().at(-1))
    if (tail?.type !== "assistant" || tail.id !== base.tailID) return base.scan.generated
    const live = untrack(() => generatedOfMessage(tail))
    const next = {
      reasoning: base.scan.generated.reasoning - base.tail.reasoning + live.reasoning,
      answers: base.scan.generated.answers - base.tail.answers + live.answers,
      calls: base.scan.generated.calls - base.tail.calls + live.calls,
    }
    const stable =
      next.reasoning === base.scan.generated.reasoning &&
      next.answers === base.scan.generated.answers &&
      next.calls === base.scan.generated.calls
    return stable ? base.scan.generated : next
  })
  const compactions = createMemo(() =>
    view() === "browser" ? scan(() => buildCompactions(messages())) : NO_COMPACTIONS,
  )
  const children = createMemo(() =>
    view() === "overview" ? buildChildren(data().session.list(), props.session.id) : NO_CHILDREN,
  )
  return {
    data, info, messages, settleTick, setSettleTick, structureTick, setStructureTick,
    streamTick, setStreamTick, fleetLoadedTick, setFleetLoadedTick, childStructureTick,
    setChildStructureTick, bumpStructure, flushStructure, bumpChildStructure, bumpStream,
    bumpFleetLoaded, sessionIndex, steps, turnCount, latest, events, tokenScan, tokenSteps,
    tools, generated, compactions, children,
  }
}
