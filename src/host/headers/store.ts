import { headerAt, summarizeHeader, systemPartsOf, toolsOf, type HeaderDetail, type HeaderPart, type HeaderSummary, type HeaderTool } from "../../shared/header.ts"
import { hashOf } from "../hash.ts"
import { packValue, unpackValue } from "./schema.ts"

export interface HeaderStorage {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  scan(options: { prefix: string; after?: string; limit?: number }): Promise<{
    entries: ReadonlyArray<{ key: string; value: unknown }>
    next?: string
  }>
}

export interface ContextEventLike {
  readonly sessionID: string
  readonly system: Parameters<typeof systemPartsOf>[0]
  readonly tools: Parameters<typeof toolsOf>[0]
}

export interface HeaderStoreOptions {
  /** Sessions whose version lists stay in memory. */
  readonly maxSessions?: number
  /** Entries per storage scan page. */
  readonly pageSize?: number
  /** Blob keys remembered to skip a storage lookup on every request. */
  readonly maxKnownBlobs?: number
}

export interface HeaderStore {
  versionsOf(sessionID: string): Promise<HeaderSummary[]>
  headerOf(sessionID: string, at: number): Promise<HeaderDetail | null>
  record(event: ContextEventLike): Promise<void>
  clear(): void
}

const isSummary = (value: unknown): value is HeaderSummary => {
  if (typeof value !== "object" || value === null) return false
  const summary = value as Partial<HeaderSummary>
  return typeof summary.at === "number" && typeof summary.systemHash === "string" && typeof summary.toolsHash === "string"
}

/** Header versions and their system/tool blobs, persisted under the session's storage prefix. */
export function createHeaderStore(storage: HeaderStorage, options: HeaderStoreOptions = {}): HeaderStore {
  const maxSessions = options.maxSessions ?? 100
  const pageSize = options.pageSize ?? 500
  const maxKnownBlobs = options.maxKnownBlobs ?? 1024

  const versionLists = new Map<string, HeaderSummary[]>()
  const knownBlobs = new Set<string>()

  const rememberSession = (sessionID: string, list: HeaderSummary[]) => {
    versionLists.delete(sessionID)
    versionLists.set(sessionID, list)
    if (versionLists.size > maxSessions) versionLists.delete(versionLists.keys().next().value as string)
  }

  const rememberBlob = (key: string) => {
    knownBlobs.delete(key)
    knownBlobs.add(key)
    if (knownBlobs.size > maxKnownBlobs) knownBlobs.delete(knownBlobs.values().next().value as string)
  }

  const scanVersions = async (sessionID: string): Promise<HeaderSummary[]> => {
    const list: HeaderSummary[] = []
    let after: string | undefined
    for (;;) {
      const page = await storage.scan({ prefix: `ver/${sessionID}/`, after, limit: pageSize })
      for (const entry of page.entries) {
        const summary = unpackValue<unknown>(entry.value)
        if (isSummary(summary)) list.push(summary)
      }
      if (page.next === undefined) break
      after = page.next
    }
    list.sort((left, right) => left.at - right.at)
    return list
  }

  const versionsOf = async (sessionID: string): Promise<HeaderSummary[]> => {
    const cached = versionLists.get(sessionID)
    if (cached !== undefined) {
      rememberSession(sessionID, cached)
      return cached
    }
    const list = await scanVersions(sessionID)
    rememberSession(sessionID, list)
    return list
  }

  const writeBlob = async (key: string, value: HeaderPart[] | HeaderTool[]) => {
    if (knownBlobs.has(key)) return
    if ((await storage.get(key)) !== undefined) {
      rememberBlob(key)
      return
    }
    await storage.set(key, packValue(value))
    rememberBlob(key)
  }

  const record = async (event: ContextEventLike) => {
    const at = Date.now()
    const system = systemPartsOf(event.system)
    const tools = toolsOf(event.tools)
    const systemHash = hashOf(JSON.stringify(system))
    const toolsHash = hashOf(JSON.stringify(tools))
    const versions = await versionsOf(event.sessionID)
    const last = versions.at(-1)
    if (last !== undefined && last.systemHash === systemHash && last.toolsHash === toolsHash) return
    await writeBlob(`sys/${systemHash}`, system)
    await writeBlob(`tools/${toolsHash}`, tools)
    const summary = summarizeHeader(at, systemHash, toolsHash, system, tools)
    await storage.set(`ver/${event.sessionID}/${String(at).padStart(16, "0")}-${systemHash}`, packValue(summary))
    versions.push(summary)
  }

  const headerOf = async (sessionID: string, at: number): Promise<HeaderDetail | null> => {
    const versions = await versionsOf(sessionID)
    const chosen = headerAt(versions, at)
    if (chosen === undefined) return null
    const system = unpackValue<HeaderPart[]>(await storage.get(`sys/${chosen.systemHash}`))
    const tools = unpackValue<HeaderTool[]>(await storage.get(`tools/${chosen.toolsHash}`))
    return {
      summary: chosen,
      system: Array.isArray(system) ? system : [],
      tools: Array.isArray(tools) ? tools : [],
    }
  }

  return {
    versionsOf,
    headerOf,
    record,
    clear: () => {
      versionLists.clear()
      knownBlobs.clear()
    },
  }
}
