import { fileTokensOf, imageTokensFor } from "./imageTokens.ts"

export type Category =
  | "system"
  | "tools"
  | "user"
  | "injected"
  | "skills"
  | "assistant"
  | "reasoning"
  | "toolCalls"
  | "toolResults"

export const CATEGORY_ORDER: readonly Category[] = [
  "system",
  "tools",
  "user",
  "injected",
  "skills",
  "assistant",
  "reasoning",
  "toolCalls",
  "toolResults",
]

export const CATEGORY_LABEL: Record<Category, string> = {
  system: "System",
  tools: "Tools",
  user: "User",
  injected: "Injected",
  skills: "Skills",
  assistant: "Replies",
  reasoning: "Reasoning",
  toolCalls: "Tool calls",
  toolResults: "Tool results",
}

export interface Item {
  readonly category: Category
  readonly name: string
  readonly tokens: number
}

export interface Composition {
  readonly total: number
  readonly byCategory: Record<Category, number>
  readonly items: readonly Item[]
}

/** A model request captured right before it is sent. */
export interface Snapshot extends Composition {
  readonly sessionID: string
  readonly at: number
  readonly agent: string
  readonly model: { readonly providerID: string; readonly id: string; readonly variant?: string }
}

interface TextPart {
  readonly type?: string
  readonly text?: string | null
  readonly name?: string
  readonly input?: unknown
  readonly result?: unknown
  readonly mime?: string
  readonly data?: string
}

interface MessageInput {
  readonly role?: string
  readonly content?: readonly TextPart[] | string
}

interface SystemInput {
  readonly text: string
  readonly metadata?: Record<string, unknown>
}

interface ToolInput {
  readonly description?: string
  readonly input?: unknown
}

/** BMP ranges that count as one token per glyph. */
const CJK = (code: number) =>
  (code >= 0x2e80 && code <= 0x9fff) ||
  (code >= 0xac00 && code <= 0xd7af) ||
  (code >= 0xf900 && code <= 0xfaff) ||
  (code >= 0xff00 && code <= 0xffef)

// The same message text is rescanned on every settle. V8 caches a string's hash, so a hit is cheap.
// Skip very short or huge strings to bound memory and avoid streaming deltas evicting stable text.
const tokenCache = new Map<string, number>()
let tokenChars = 0
const TOKEN_CACHE_CHARS = 4_000_000
const TOKEN_CACHE_TEXT_MAX = 128_000
const TOKEN_CACHE_TEXT_MIN = 64

/** Rough token estimate: CJK glyphs count as one, other text as four characters per token. */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cached = tokenCache.get(text)
  if (cached !== undefined) return cached
  let cjk = 0
  for (let index = 0; index < text.length; index++) if (CJK(text.charCodeAt(index))) cjk += 1
  const value = Math.ceil(cjk + (text.length - cjk) / 4)
  if (text.length >= TOKEN_CACHE_TEXT_MIN && text.length <= TOKEN_CACHE_TEXT_MAX) {
    tokenCache.set(text, value)
    tokenChars += text.length
    // shortcut: FIFO eviction by total characters, not true LRU; the recent tail is what rescans.
    while (tokenChars > TOKEN_CACHE_CHARS) {
      const oldest = tokenCache.keys().next().value as string
      tokenCache.delete(oldest)
      tokenChars -= oldest.length
    }
  }
  return value
}

export function clip(text: string, max = 64): string {
  // Collapsing whitespace across a huge payload is wasted work: a long enough prefix clips the same.
  const limit = max * 8 + 64
  const prefix = text.length > limit ? text.slice(0, limit).replace(/\s+/g, " ").trim() : undefined
  // A whitespace-heavy prefix can collapse below the clip length; then the rest of the text still matters.
  const line = prefix !== undefined && prefix.length >= max ? prefix : text.replace(/\s+/g, " ").trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value) ?? ""
  } catch {
    return String(value)
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "object" && value !== null) return value as Record<string, unknown>
  return undefined
}

/** Bytes behind a base64 payload, without decoding it. */
function bytesOfBase64(data: string): number {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1
  const payload = comma >= 0 ? data.slice(comma + 1) : data
  if (payload === "") return 0
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

/** A media part carries pixels; its cost comes from the image size, not the encoded payload. */
function mediaPartOf(part: TextPart): { readonly mime?: string; readonly data?: string | Uint8Array } {
  const raw = part as unknown as Record<string, unknown>
  const media = record(raw.media)
  const source = record(media?.source)
  const mime =
    (typeof media?.mediaType === "string" ? media.mediaType : undefined) ??
    (typeof raw.mime === "string" ? raw.mime : undefined) ??
    (typeof source?.mediaType === "string" ? source.mediaType : undefined)
  const data =
    typeof source?.data === "string" || source?.data instanceof Uint8Array
      ? (source.data as string | Uint8Array)
      : typeof media?.data === "string" || media?.data instanceof Uint8Array
        ? (media.data as string | Uint8Array)
        : typeof raw.data === "string" || raw.data instanceof Uint8Array
          ? (raw.data as string | Uint8Array)
          : typeof raw.url === "string"
            ? raw.url
            : undefined
  return { mime, data }
}

/** A part is media when it names a media type or carries an inline image payload. */
function mediaKindOf(part: TextPart): "image" | "file" | undefined {
  const raw = part as unknown as Record<string, unknown>
  const media = record(raw.media)
  const source = record(media?.source)
  const mime =
    (typeof media?.mediaType === "string" ? media.mediaType : undefined) ??
    (typeof raw.mime === "string" ? raw.mime : undefined) ??
    (typeof source?.mediaType === "string" ? source.mediaType : undefined)
  if (raw.type === "file") {
    // An image attachment may still arrive as a file part; only a non-image file is priced by identity.
    return mime !== undefined && mime.startsWith("image/") ? "image" : "file"
  }
  if (raw.type === "media" || raw.type === "image") {
    return mime !== undefined && !mime.startsWith("image/") ? "file" : "image"
  }
  if (mime !== undefined && mime.startsWith("image/") && (source?.data !== undefined || raw.data !== undefined)) return "image"
  return undefined
}

function mediaTokensOf(part: TextPart, kind: "image" | "file"): number {
  const media = mediaPartOf(part)
  if (kind === "image") return imageTokensFor(media.data, media.mime)
  const raw = part as unknown as Record<string, unknown>
  return fileTokensOf({
    name: typeof raw.name === "string" ? raw.name : undefined,
    mime: media.mime,
    bytes: typeof media.data === "string" ? bytesOfBase64(media.data) : media.data?.length,
  })
}

/** Provider tool results wrap text in `{ type: "text", value }`; count the payload, not the wrapper. */
function resultTextOf(value: unknown): string {
  const entry = record(value)
  if (entry !== undefined) {
    if (entry.type === "text" && typeof entry.value === "string") return entry.value
    if (entry.type === "json") return stringify(entry.value)
  }
  return stringify(value)
}

function systemLabel(part: SystemInput, index: number): string {
  const instructions = record(record(part.metadata)?.experimental)?.instructions
  if (Array.isArray(instructions) && instructions.length > 0) {
    return instructions.map((entry) => String(record(entry)?.key ?? "instructions")).join(", ")
  }
  return `System prompt ${index + 1}`
}

/**
 * Splits an outgoing model request into the categories shown in the panel.
 * The labels and counts are estimates; provider usage stays the source of truth.
 */
export function compose(input: {
  readonly system: readonly SystemInput[]
  readonly messages: readonly MessageInput[]
  readonly tools: Readonly<Record<string, ToolInput>>
}): Composition {
  const byCategory = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, 0])) as Record<
    Category,
    number
  >
  const items: Item[] = []

  const add = (category: Category, name: string, text: string) => {
    const tokens = estimateTokens(text)
    if (tokens === 0) return
    byCategory[category] += tokens
    if (items.length < 400) items.push({ category, name: clip(name), tokens })
  }
  /** Media parts count as image/file cost; text parts go through the normal estimator. */
  const addMedia = (category: Category, parts: readonly TextPart[]) => {
    for (const part of parts) {
      const kind = mediaKindOf(part)
      if (kind === undefined) continue
      const tokens = mediaTokensOf(part, kind)
      byCategory[category] += tokens
      if (items.length < 400) items.push({ category, name: kind === "image" ? "Image" : "File", tokens })
    }
  }

  input.system.forEach((part, index) => add("system", systemLabel(part, index), part.text))

  for (const [name, tool] of Object.entries(input.tools)) {
    add("tools", name, `${name} ${tool.description ?? ""} ${stringify(tool.input)}`)
  }

  for (const message of input.messages) {
    const parts: readonly TextPart[] =
      typeof message.content === "string" ? [{ type: "text", text: message.content }] : (message.content ?? [])

    if (message.role === "tool") {
      for (const part of parts) {
        const text = resultTextOf(part.result)
        // The skill tool returns the loaded skill body; the panel shows it as a skill, not a tool result.
        if (part.name === "skill" || /^\s*<skill_content\b/.test(text)) add("skills", part.name ?? "skill", text)
        else add("toolResults", part.name ?? "tool", text)
      }
      continue
    }

    if (message.role === "assistant") {
      for (const part of parts) {
        if (part.type === "text") add("assistant", part.text ?? "", part.text ?? "")
        else if (part.type === "reasoning") add("reasoning", part.text ?? "", part.text ?? "")
        else if (part.type === "tool-call") {
          if (part.name !== "skill") add("toolCalls", part.name ?? "tool", `${part.name ?? "tool"} ${stringify(part.input)}`)
        } else if (part.type === "compaction") add("injected", "compaction", part.text ?? "")
      }
      continue
    }

    if (message.role === "system") {
      for (const part of parts) add("injected", part.text ?? "system", part.text ?? "")
      continue
    }

    const text = parts
      .filter((part) => !part.type || part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n")

    // An image or file attachment is priced from its pixels or identity, never its base64 payload.
    addMedia("user", parts)

    if (!text) {
      // A part with a payload but no text and no media kind is still an attachment; summarise it.
      for (const part of parts) {
        if (mediaKindOf(part) !== undefined) continue
        add("injected", part.type ?? "attachment", stringify(part))
      }
      continue
    }

    // Injections are whole messages; a mention inside prose (a summary, a doc) must not match.
    const checkpoint = /^\s*<conversation-checkpoint\b/.test(text)
    if (checkpoint) add("injected", "Conversation checkpoint", text)
    else {
      const skill = /^\s*<skill_content(?:\s+name="([^"]*)")?/.exec(text)
      if (skill) add("skills", skill[1] || text, text)
      else if (/^\s*<context\b/.test(text)) add("injected", text, text)
      else add("user", text, text)
    }
  }

  const total = CATEGORY_ORDER.reduce((sum, category) => sum + byCategory[category], 0)
  return { total, byCategory, items }
}
