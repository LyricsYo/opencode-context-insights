import { priceModelId } from "./priceIdentity.ts"

/**
 * Cost estimates from the models.dev list price book.
 *
 * OpenCode already carries models.dev rates for many providers, but gateways
 * such as LiteLLM expose custom model IDs with an empty cost array. This
 * resolver looks the billed (provider, model) pair up in the same book and
 * falls back to the maker's branch, then to any matching listing.
 */



export interface Price {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

export interface PriceEntry {
  readonly provider: string
  readonly model: string
  readonly rate: Price
  readonly canonical?: string
}

interface Branch {
  readonly exact: Map<string, PriceEntry[]>
  readonly normalized: Map<string, PriceEntry[]>
}

export interface PriceBook {
  readonly byProvider: Map<string, Branch>
  readonly byModel: Map<string, PriceEntry[]>
  /** One row per catalogue listing, so another process can rebuild the same book. */
  readonly entries: readonly PriceEntry[]
}

export interface CostTokens {
  readonly input: number
  readonly output: number
  readonly reasoning?: number
  readonly cache: { readonly read: number; readonly write: number }
}

interface CostMessage {
  readonly type: string
  readonly status?: string
  readonly cost?: number | null
  readonly tokens?: CostTokens | null
  readonly model?: { readonly providerID: string; readonly id: string } | null
}

export interface CostStats {
  readonly total: number
  /** Mean cost per priced call, including completed compactions. */
  readonly average: number
  readonly steps: number
  /** Calls priced from models.dev. */
  readonly estimated: number
  /** Calls whose model was not in the book; their provider cost was used. */
  readonly fallback: number
}

const MAKERS: ReadonlyArray<readonly [string, string]> = [
  ["codestral-", "mistral"],
  ["pixtral-", "mistral"],
  ["nemotron-", "nvidia"],
  ["deepseek-", "deepseek"],
  ["minimax-", "minimax"],
  ["mimo-", "xiaomi"],
  ["command-", "cohere"],
  ["gemini-", "google"],
  ["gemma-", "google"],
  ["claude-", "anthropic"],
  ["llama-", "meta"],
  ["mistral-", "mistral"],
  ["grok-", "xai"],
  ["kimi-", "moonshotai"],
  ["glm-", "zhipuai"],
  ["gpt-", "openai"],
  ["o1-", "openai"],
  ["o3-", "openai"],
  ["o4-", "openai"],
  ["qwen", "alibaba"],
]

const PLAN_PROVIDER = /(?:^|-)(?:coding|code|token)-plan(?:-|$)/

function objectOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined
}

function stringOf(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined
}

function numberOf(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined
}

function lower(value: string): string {
  return value.trim().toLowerCase()
}

function bare(value: string): string {
  const cut = value.lastIndexOf("/")
  return cut >= 0 ? value.slice(cut + 1) : value
}

function normalize(value: string): string {
  return lower(value).replace(/[._]/g, "-").replace(/-+/g, "-")
}

/** Every key a model may be listed under: the billed name, the bare name, and both normalised. */
function lookupKeys(modelID: string): string[] {
  const cleaned = priceModelId(modelID)
  const keys = new Set<string>([cleaned, bare(cleaned), modelID, bare(modelID)])
  // A deployment version suffix is not part of the catalogue name; try the family too.
  for (const key of [...keys]) {
    const family = key.replace(/-v\d+(?::\d+)?$/i, "").replace(/@\d{8}$/, "").replace(/-\d{8}$/, "")
    if (family !== key && family !== "") keys.add(family)
  }
  return [...keys].filter((key) => key !== "")
}

function rateOf(value: unknown): Price | undefined {
  const cost = objectOf(value)
  if (cost === undefined) return undefined
  const input = numberOf(cost.input)
  const output = numberOf(cost.output)
  if (input === undefined || output === undefined) return undefined
  return {
    input,
    output,
    cacheRead: numberOf(cost.cache_read) ?? input,
    cacheWrite: numberOf(cost.cache_write) ?? input,
  }
}

function sameRate(left: Price, right: Price): boolean {
  return (
    left.input === right.input &&
    left.output === right.output &&
    left.cacheRead === right.cacheRead &&
    left.cacheWrite === right.cacheWrite
  )
}

/** One rate only when every matching listing agrees; otherwise the price is ambiguous. */
function pickRate(entries: readonly PriceEntry[]): Price | undefined {
  if (entries.length === 0) return undefined
  const first = entries[0].rate
  return entries.every((entry) => sameRate(entry.rate, first)) ? first : undefined
}

function push(map: Map<string, PriceEntry[]>, key: string, entry: PriceEntry): void {
  const list = map.get(key)
  if (list === undefined) map.set(key, [entry])
  else list.push(entry)
}

/** Registers one listing under every name the lookup may use. */
function addEntry(
  byProvider: Map<string, Branch>,
  byModel: Map<string, PriceEntry[]>,
  entry: PriceEntry,
): void {
  const providerKey = lower(entry.provider)
  let branch = byProvider.get(providerKey)
  if (branch === undefined) {
    branch = { exact: new Map(), normalized: new Map() }
    byProvider.set(providerKey, branch)
  }
  const modelID = entry.model
  push(branch.exact, lower(modelID), entry)
  push(branch.exact, lower(bare(modelID)), entry)
  push(branch.normalized, normalize(modelID), entry)
  push(branch.normalized, normalize(bare(modelID)), entry)
  push(byModel, normalize(modelID), entry)
  push(byModel, normalize(bare(modelID)), entry)
  const cleaned = priceModelId(modelID)
  push(branch.exact, lower(cleaned), entry)
  push(branch.exact, lower(bare(cleaned)), entry)
  push(branch.normalized, normalize(cleaned), entry)
  push(branch.normalized, normalize(bare(cleaned)), entry)
  push(byModel, normalize(cleaned), entry)
  push(byModel, normalize(bare(cleaned)), entry)
}

function priceEntryOf(value: unknown): PriceEntry | undefined {
  const entry = objectOf(value)
  const provider = stringOf(entry?.provider)
  const model = stringOf(entry?.model)
  const rate = objectOf(entry?.rate)
  const input = numberOf(rate?.input)
  const output = numberOf(rate?.output)
  if (provider === undefined || model === undefined || input === undefined || output === undefined) {
    return undefined
  }
  const canonical = stringOf(entry?.canonical)
  return {
    provider,
    model,
    rate: {
      input,
      output,
      cacheRead: numberOf(rate?.cacheRead) ?? input,
      cacheWrite: numberOf(rate?.cacheWrite) ?? input,
    },
    ...(canonical === undefined ? {} : { canonical }),
  }
}

/** Rebuilds the lookup maps from the host's compact entry list. */
export function buildPriceBookFromEntries(entries: readonly unknown[]): PriceBook | undefined {
  const byProvider = new Map<string, Branch>()
  const byModel = new Map<string, PriceEntry[]>()
  const kept: PriceEntry[] = []
  for (const value of entries) {
    const entry = priceEntryOf(value)
    if (entry === undefined || PLAN_PROVIDER.test(lower(entry.provider))) continue
    kept.push(entry)
    addEntry(byProvider, byModel, entry)
  }
  return kept.length === 0 ? undefined : { byProvider, byModel, entries: kept }
}

/** A canonical name may carry a version/date suffix; compare the family, never a sibling variant. */
function modelFamily(value: string): string {
  return normalize(bare(value))
    .replace(/-v\d+(?::\d+)?$/i, "")
    .replace(/@\d{8}$/, "")
    .replace(/-\d{8}$/, "")
}

function canonicalMatches(canonical: string, model: string): boolean {
  const name = modelFamily(canonical)
  const target = modelFamily(model)
  if (name === target) return true
  // A deployment version/date suffix is not a sibling variant (`mini`, `pro`, ...).
  if (!name.startsWith(`${target}-`)) return false
  return /^(?:v\d+(?::\d+)?|\d{4,8}|\d{4}-\d{2}-\d{2})$/.test(name.slice(target.length + 1))
}

function makerOf(model: string): string | undefined {
  const name = normalize(bare(priceModelId(model)))
  for (const [prefix, maker] of MAKERS) if (name.startsWith(prefix)) return maker
  return undefined
}

export function buildPriceBook(raw: unknown): PriceBook | undefined {
  const data = objectOf(raw)
  if (data === undefined) return undefined
  const byProvider = new Map<string, Branch>()
  const byModel = new Map<string, PriceEntry[]>()
  const entries: PriceEntry[] = []
  for (const [providerID, value] of Object.entries(data)) {
    if (PLAN_PROVIDER.test(lower(providerID))) continue
    const provider = objectOf(value)
    const models = objectOf(provider?.models)
    if (models === undefined) continue
    for (const [modelID, value] of Object.entries(models)) {
      const model = objectOf(value)
      const rate = rateOf(model?.cost)
      if (rate === undefined) continue
      const entry: PriceEntry = {
        provider: providerID,
        model: modelID,
        rate,
        canonical: stringOf(model?.canonical_model_id),
      }
      entries.push(entry)
      addEntry(byProvider, byModel, entry)
    }
  }
  return { byProvider, byModel, entries }
}

function branchLookup(branch: Branch | undefined, model: string): Price | undefined {
  if (branch === undefined) return undefined
  for (const key of lookupKeys(model)) {
    const direct = pickRate(branch.exact.get(lower(key)) ?? [])
    if (direct !== undefined) return direct
    const normalized = pickRate(branch.normalized.get(normalize(key)) ?? [])
    if (normalized !== undefined) return normalized
  }
  return undefined
}

function makerLookup(book: PriceBook, maker: string, model: string): Price | undefined {
  const branch = book.byProvider.get(maker)
  if (branch === undefined) return undefined
  const direct = branchLookup(branch, model)
  if (direct !== undefined) return direct
  const canonical = [...branch.exact.values(), ...branch.normalized.values()]
    .flat()
    .filter((entry) => entry.canonical !== undefined && canonicalMatches(entry.canonical, model))
  return pickRate(canonical)
}

export function priceOf(book: PriceBook | undefined, providerID: string, modelID: string): Price | undefined {
  if (book === undefined) return undefined
  const direct = branchLookup(book.byProvider.get(lower(providerID)), modelID)
  if (direct !== undefined) return direct
  const maker = makerOf(modelID)
  if (maker !== undefined) {
    const made = makerLookup(book, maker, modelID)
    if (made !== undefined) return made
  }
  for (const key of lookupKeys(modelID)) {
    const listed = pickRate(book.byModel.get(normalize(key)) ?? [])
    if (listed !== undefined) return listed
  }
  return undefined
}

export function estimateCost(tokens: CostTokens, price: Price): number {
  return (
    (tokens.cache.read * price.cacheRead +
      tokens.input * price.input +
      tokens.cache.write * price.cacheWrite +
      (tokens.output + (tokens.reasoning ?? 0)) * price.output) /
    1_000_000
  )
}

/** Session cost from each billed call's provider/model rate; provider cost is the fallback. */
export function buildCost(messages: readonly CostMessage[], book?: PriceBook): CostStats {
  let total = 0
  let steps = 0
  let estimated = 0
  let fallback = 0
  for (const message of messages) {
    if (message.type !== "assistant" && message.type !== "compaction") continue
    if (message.type === "compaction" && message.status !== "completed") continue
    if (message.tokens === undefined || message.tokens === null) continue
    const price =
      message.model === undefined || message.model === null
        ? undefined
        : priceOf(book, message.model.providerID, message.model.id)
    total += price === undefined ? (message.cost ?? 0) : estimateCost(message.tokens, price)
    if (message.type === "assistant") steps += 1
    if (price === undefined) fallback += 1
    else estimated += 1
  }
  // Compaction calls are priced too, so the per-call mean uses every priced row.
  const priced = estimated + fallback
  return { total, average: priced > 0 ? total / priced : 0, steps, estimated, fallback }
}

const PRICE_URL = "https://models.dev/api.json"
const PRICE_TTL = 60 * 60 * 1000
const PRICE_BACKOFF = 30 * 1000
const PRICE_TIMEOUT = 8_000
let cache: { at: number; book: PriceBook } | undefined
let pending: Promise<PriceBook | undefined> | undefined
let failedAt = 0
let version = 0

/** Bumped when a fresh catalogue lands, so clients can invalidate resolved rates. */
export function priceBookVersion(): number {
  return version
}

/** Loads the models.dev catalogue once per hour; failures leave the provider cost in place. */
export function loadPriceBook(): Promise<PriceBook | undefined> {
  if (cache !== undefined && Date.now() - cache.at < PRICE_TTL) return Promise.resolve(cache.book)
  if (pending !== undefined) return pending
  if (cache === undefined && failedAt !== 0 && Date.now() - failedAt < PRICE_BACKOFF) {
    return Promise.resolve(undefined)
  }
  // shortcut: one shared catalogue with a one-hour TTL; add a persisted copy if panels must work offline.
  const signal = typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(PRICE_TIMEOUT) : undefined
  pending = fetch(PRICE_URL, { signal })
    .then((response) => {
      if (!response.ok) throw new Error(`models.dev ${response.status}`)
      return response.json()
    })
    .then((raw) => {
      const book = buildPriceBook(raw)
      if (book === undefined) throw new Error("invalid models.dev catalogue")
      cache = { at: Date.now(), book }
      version += 1
      failedAt = 0
      return book
    })
    .catch(() => {
      failedAt = Date.now()
      return cache?.book
    })
    .finally(() => {
      pending = undefined
    })
  return pending
}
