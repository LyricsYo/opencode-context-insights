

/**
 * Gateway and deployment naming noise that must not change the price lookup.
 *
 * OpenRouter adds `:free`, Cloudflare prefixes `@cf/`, and deployments carry
 * resource prefixes. The pricing book uses the plain model ID, so the lookup
 * key drops the decoration but keeps the model family.
 */

const GATEWAY_PREFIXES = [
  "accounts/fireworks/models/",
  "accounts/fireworks/routers/",
  "workers-ai/",
  "@cf/",
  "hf:",
] as const

const RESOURCE_PREFIXES = ["global.", "us.", "eu.", "apac."] as const

/** Deployment markers that never name a catalogue model. */
const VARIANT_SUFFIXES = [/:free$/i, /:beta$/i, /:extended$/i, /:nitro$/i, /:floor$/i, /:online$/i, /@default$/i]

function stripPrefix(value: string): string {
  let next = value.trim()
  for (let guard = 0; guard < 4; guard++) {
    const before = next
    for (const prefix of GATEWAY_PREFIXES) {
      if (next.startsWith(prefix)) next = next.slice(prefix.length)
    }
    for (const prefix of RESOURCE_PREFIXES) {
      if (next.startsWith(prefix)) next = next.slice(prefix.length)
    }
    if (next === before) break
  }
  return next
}

function stripSuffix(value: string): string {
  let next = value
  for (;;) {
    const before = next
    for (const pattern of VARIANT_SUFFIXES) {
      if (pattern.test(next)) {
        next = next.replace(pattern, "")
        break
      }
    }
    if (next === before) return next
  }
}

/**
 * The billed model name for a lookup key: gateway prefixes and variant
 * suffixes removed, the provider namespace kept when present. Version and date
 * suffixes stay because catalogues use them as real model names.
 */
export function priceModelId(model: string): string {
  const stripped = stripPrefix(model)
  if (stripped === "") return model.trim()
  const slash = stripped.lastIndexOf("/")
  if (slash < 0) return stripSuffix(stripped)
  const namespace = stripped.slice(0, slash + 1)
  return `${namespace}${stripSuffix(stripped.slice(slash + 1))}`
}
