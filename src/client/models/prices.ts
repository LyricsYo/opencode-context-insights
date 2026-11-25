import { buildPriceBookFromEntries, loadPriceBook, type PriceBook } from "../../shared/cost.ts"

const TTL_MS = 60 * 60 * 1000
const RETRY_MS = 30 * 1000

interface PricePayload {
  readonly entries?: readonly unknown[]
}

let cache: { at: number; book: PriceBook } | undefined
let pending: Promise<PriceBook | undefined> | undefined
let failedAt = 0

/**
 * The host fetches and parses models.dev once; the renderer only rebuilds the
 * lookup maps. Older hosts have no prices method, so the direct fetch stays as
 * a fallback.
 */
export function loadHostPriceBook(request: () => Promise<unknown>): Promise<PriceBook | undefined> {
  if (cache !== undefined && Date.now() - cache.at < TTL_MS) return Promise.resolve(cache.book)
  if (pending !== undefined) return pending
  if (cache === undefined && failedAt !== 0 && Date.now() - failedAt < RETRY_MS) {
    return Promise.resolve(undefined)
  }
  pending = Promise.resolve()
    .then(request)
    .then((raw): PriceBook | null | undefined => {
      const entries = (raw as PricePayload).entries
      if (!Array.isArray(entries)) return undefined
      return buildPriceBookFromEntries(entries) ?? null
    })
    .catch(() => undefined)
    .then(async (book) => {
      // A missing method or malformed reply falls back to the renderer fetch; an
      // empty host catalogue is an answer, so a second fetch would only wait again.
      const resolved = book === undefined ? await loadPriceBook() : (book ?? undefined)
      if (resolved === undefined) {
        failedAt = Date.now()
        return undefined
      }
      cache = { at: Date.now(), book: resolved }
      failedAt = 0
      return resolved
    })
    .finally(() => {
      pending = undefined
    })
  return pending
}
