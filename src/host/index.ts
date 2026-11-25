import { Plugin } from "@opencode/plugin"
import { loadPriceBook, priceBookVersion } from "../shared/cost.ts"
import { compose } from "../shared/estimate.ts"
import type { HeaderSummary } from "../shared/header.ts"
import { HOST_CONTRACT } from "../shared/host.ts"
import { ContextRpc, HEADERS_MANY_MAX } from "../shared/rpc.ts"
import { HEADER_STORAGE_VERSION } from "./headers/schema.ts"
import { createHeaderStore } from "./headers/store.ts"
import { createSnapshotStore } from "./snapshots.ts"

const HEADERS_MANY_CONCURRENCY = 8

/** Deduped, capped request IDs: a stale client cannot turn one call into unbounded work. */
function wantedIDs(ids: readonly string[]): string[] {
  const seen = new Set<string>()
  const wanted: string[] = []
  for (const id of ids) {
    if (id === "" || seen.has(id)) continue
    seen.add(id)
    wanted.push(id)
    if (wanted.length >= HEADERS_MANY_MAX) break
  }
  return wanted
}

export default Plugin.define({
  id: "opencode-context-insights",
  async setup(ctx) {
    const snapshots = createSnapshotStore()
    const headers = createHeaderStore(ctx.storage)

    await ctx.session.hook("context", async (event) => {
      snapshots.set(event.sessionID, {
        ...compose({ system: event.system, messages: event.messages, tools: event.tools }),
        sessionID: event.sessionID,
        at: Date.now(),
        agent: event.agent,
        model: {
          providerID: event.model.providerID,
          id: event.model.id,
          variant: event.model.variant,
        },
      })
      await headers.record(event).catch(() => {
        // Recording must never block the model request.
      })
    })

    await ctx.rpc.register(ContextRpc, {
      hello: async () => ({
        plugin: "opencode-context-insights",
        contract: HOST_CONTRACT,
        storage: HEADER_STORAGE_VERSION,
        app: ctx.app.name,
        appVersion: ctx.app.version,
        methods: Object.keys(ContextRpc.methods),
      }),
      prices: async () => {
        const book = await loadPriceBook()
        return {
          entries: book?.entries ?? [],
          ready: book !== undefined,
          version: priceBookVersion(),
        }
      },
      snapshot: async (input) => ({
        snapshot: snapshots.get((input as { sessionID: string }).sessionID) ?? null,
      }),
      header: async (input) => {
        const { sessionID, at } = input as { sessionID: string; at: number }
        return { header: await headers.headerOf(sessionID, at) }
      },
      headers: async (input) => ({
        headers: await headers.versionsOf((input as { sessionID: string }).sessionID),
      }),
      headersMany: async (input) => {
        const ids = wantedIDs((input as { sessionIDs: string[] }).sessionIDs)
        const entries: Array<readonly [string, HeaderSummary[]]> = []
        for (let start = 0; start < ids.length; start += HEADERS_MANY_CONCURRENCY) {
          const batch = ids.slice(start, start + HEADERS_MANY_CONCURRENCY)
          const results = await Promise.all(
            batch.map(async (id) => {
              try {
                return [id, await headers.versionsOf(id)] as const
              } catch {
                return [id, [] as HeaderSummary[]] as const
              }
            }),
          )
          entries.push(...results)
        }
        return { headers: Object.fromEntries(entries) }
      },
    })
  },
})
