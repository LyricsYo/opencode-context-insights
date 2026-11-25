import { createEffect, onCleanup, type Accessor, type Setter } from "solid-js"
import type { PanelProps } from "@opencode/plugin/gui"
import { buildChildren } from "../../shared/report.ts"
import { ContextRpc, HEADERS_MANY_MAX } from "../../shared/rpc.ts"
import type { HeaderSummary } from "../../shared/header.ts"
import type { FleetForest, FleetNode } from "../../shared/fleet.ts"
import type { PanelView } from "../panelSupport.ts"

export interface FleetLoaderParams {
  readonly props: PanelProps
  readonly view: Accessor<PanelView>
  readonly revision: Accessor<number>
  readonly fleet: Accessor<FleetForest>
  readonly setFleetHeaders: Setter<ReadonlyMap<string, readonly HeaderSummary[]>>
  readonly bumpStream: () => void
  readonly bumpFleetLoaded: () => void
  /** Host methods from `hello`; undefined while unknown or on an older host. */
  readonly hostMethods: Accessor<readonly string[] | undefined>
}

/** Data the Fleet tab needs from sessions other than the current one. */
export function createFleetLoader(params: FleetLoaderParams) {
  const { props, view, revision, fleet, setFleetHeaders, bumpStream, bumpFleetLoaded, hostMethods } = params
  const data = () => props.session.server.data

  function syncFleetFamily(parentID: string, depth: number): void {
    if (depth > 3) return
    void data()
      .session.sync(parentID, { children: true })
      .catch(() => {})
      .then(() => {
        for (const child of buildChildren(data().session.list(), parentID)) {
          syncFleetFamily(child.id, depth + 1)
        }
      })
  }

  const synced = new Set<string>()
  createEffect(() => {
    if (view() !== "fleet") return
    const id = props.session.id
    if (synced.has(id)) return
    synced.add(id)
    syncFleetFamily(id, 0)
  })

  const headerRequested = new Set<string>()
  const pendingHeaders = new Map<string, readonly HeaderSummary[]>()
  let headerTimer: ReturnType<typeof setTimeout> | undefined
  const flushHeaders = () => {
    headerTimer = undefined
    if (pendingHeaders.size === 0) return
    const patch = new Map(pendingHeaders)
    pendingHeaders.clear()
    setFleetHeaders((current) => {
      const next = new Map(current)
      for (const [id, headers] of patch) next.set(id, headers)
      return next
    })
  }
  const scheduleHeaders = () => {
    if (headerTimer === undefined) headerTimer = setTimeout(flushHeaders, 100)
  }
  createEffect(() => {
    if (view() !== "fleet") return
    // Re-runs after Refresh; the requested set keeps it from refetching unchanged agents.
    revision()
    const methods = hostMethods()
    const canBatch = methods === undefined || methods.includes("headersMany")
    const session = props.session
    const groups = new Map<string, FleetNode[]>()
    for (const node of fleet().nodes) {
      if (node.id === props.session.id || headerRequested.has(node.id)) continue
      headerRequested.add(node.id)
      const directory = node.directory || session.directory
      const list = groups.get(directory)
      if (list === undefined) groups.set(directory, [node])
      else list.push(node)
    }
    const requestOne = (node: FleetNode) => {
      void session.server.client
        .rpc(ContextRpc)
        .headers({ sessionID: node.id }, { location: { directory: node.directory || session.directory } })
        .then((result) => {
          pendingHeaders.set(node.id, (result as { headers?: HeaderSummary[] }).headers ?? [])
          scheduleHeaders()
        })
        .catch(() => {
          pendingHeaders.set(node.id, [])
          scheduleHeaders()
        })
    }
    for (const [directory, nodes] of groups) {
      if (!canBatch) {
        for (const node of nodes) requestOne(node)
        continue
      }
      // The host caps one request at 64 ids; split larger families before calling.
      for (let start = 0; start < nodes.length; start += HEADERS_MANY_MAX) {
        const slice = nodes.slice(start, start + HEADERS_MANY_MAX)
        const ids = slice.map((node) => node.id)
        void session.server.client
          .rpc(ContextRpc)
          .headersMany({ sessionIDs: ids }, { location: { directory } })
          .then((result) => {
            const headers = (result as { headers?: Record<string, HeaderSummary[]> }).headers ?? {}
            for (const id of ids) pendingHeaders.set(id, headers[id] ?? [])
            scheduleHeaders()
          })
          .catch(() => {
            // Older host builds do not know headersMany yet; degrade to one request per node.
            for (const node of slice) requestOne(node)
          })
      }
    }
  })
  onCleanup(() => {
    if (headerTimer !== undefined) clearTimeout(headerTimer)
  })

  const messageRequested = new Set<string>()
  createEffect(() => {
    if (view() !== "fleet") return
    for (const node of fleet().nodes) {
      if (node.isCurrent || messageRequested.has(node.id)) continue
      messageRequested.add(node.id)
      void data()
        .session.message.sync(node.id)
        .then(() => {
          const source = data()
          if (source.session.message.more(node.id) && !source.session.message.loading(node.id)) {
            return source.session.message.loadMore(node.id, { all: true })
          }
          return undefined
        })
        .then(() => {
          bumpStream()
          bumpFleetLoaded()
        })
        .catch(() => {})
    }
  })

  return { clearHeaderCache: () => headerRequested.clear() }
}
