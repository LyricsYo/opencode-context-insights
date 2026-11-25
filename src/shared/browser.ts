import type { SessionMessageInfo } from "@opencode/client"
import { CATEGORY_ORDER, clip, estimateTokens, type Category, type Item } from "./estimate.ts"
import type { HeaderDetail } from "./header.ts"
import { attachmentTokensOfMessage } from "./messageImages.ts"
import { buildSteps } from "./steps.ts"
import { buildSurface, isToolEntry, type SurfaceEntry, type SurfaceFile, type SurfaceKind, type SurfaceToolEntry } from "./surface.ts"

export type BrowserRowKind =
  | "system"
  | "toolSchema"
  | "user"
  | "injected"
  | "skill"
  | "reply"
  | "reasoning"
  | "toolCall"
  | "toolResult"

export interface BrowserRow {
  readonly id: string
  readonly kind: BrowserRowKind
  readonly name: string
  readonly preview: string
  readonly tokens: number
  readonly at: number
  readonly turn?: number
  readonly step?: number
  readonly status?: string
  readonly text?: string
  readonly input?: string
  readonly output?: string
  readonly files?: readonly SurfaceFile[]
  readonly truncated?: boolean
  readonly description?: string
  readonly schema?: string
  readonly source?: string
  readonly calls?: number
  /** 1-based order in the request; header rows have none and sit at the end of the flat list. */
  readonly position?: number
  readonly tail?: boolean
}

export interface BrowserGroup {
  readonly key: Category
  readonly rows: readonly BrowserRow[]
  readonly tokens: number
}

export interface StepBriefEntry {
  readonly id: string
  readonly kind: SurfaceKind
  readonly name: string
  readonly preview: string
  readonly tokens: number
  readonly messageID: string
}

export interface StepBrief {
  readonly opener?: StepBriefEntry
  /** Items that entered the request since the previous step; empty at a turn start. */
  readonly inputs: readonly StepBriefEntry[]
  /** The reply, reasoning and tool calls this step generated. */
  readonly response: readonly StepBriefEntry[]
}

/** The three plain-language rows dsh-context shows under a trend bar. */
export function buildStepBrief(messages: readonly SessionMessageInfo[], stepID: string): StepBrief {
  const messagesIndex = messages.findIndex((message) => message.id === stepID)
  if (messagesIndex < 0) return { inputs: [], response: [] }
  const briefEntry = (entry: SurfaceEntry): StepBriefEntry => ({
    id: entry.id,
    kind: entry.kind,
    name: entry.name,
    preview: clip(isToolEntry(entry) ? entry.input : entry.text, 90),
    tokens: entry.tokens,
    messageID: entry.messageID,
  })
  const surface = buildSurface(messages, stepID, true)
  const response = surface
    .filter((entry) => entry.messageID === stepID && (entry.kind === "reply" || entry.kind === "reasoning" || entry.kind === "tool"))
    .map(briefEntry)
  let opener: StepBriefEntry | undefined
  for (let index = messagesIndex - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.type !== "user") continue
    opener = {
      id: message.id,
      kind: "user",
      name: "User",
      preview: clip(message.text, 90) || (message.files?.length ? `${message.files.length} attachments` : ""),
      tokens: estimateTokens(message.text) + attachmentTokensOfMessage(message),
      messageID: message.id,
    }
    break
  }
  const steps = buildSteps(messages)
  const stepIndex = steps.findIndex((step) => step.id === stepID)
  const previous = stepIndex > 0 ? steps[stepIndex - 1] : undefined
  const current = stepIndex >= 0 ? steps[stepIndex] : undefined
  const turnStart = previous === undefined || current === undefined || previous.turn !== current.turn
  const inputs =
    turnStart || previous === undefined
      ? []
      : surface
          .filter((entry) => entry.messageID === previous.id && entry.kind !== "reasoning")
          .map(briefEntry)
  return { opener, inputs, response }
}

/**
 * Groups one request into the same categories as the composition bar. Header rows
 * (system prompt and tool schemas) come from the captured request; message rows
 * come from the session log. With `upto`, the selected step's own response is
 * excluded, because the browser shows what that request was assembled from.
 */
export function buildBrowserGroups(
  messages: readonly SessionMessageInfo[],
  header: HeaderDetail | null | undefined,
  upto?: string,
  includeStep = false,
): BrowserGroup[] {
  const rows = Object.fromEntries(CATEGORY_ORDER.map((category) => [category, [] as BrowserRow[]])) as Record<
    Category,
    BrowserRow[]
  >
  const surface = buildSurface(messages, upto, includeStep)
  if (header) {
    header.summary.system.forEach((part, index) => {
      const text = header.system[index]?.text ?? ""
      rows.system.push({
        id: `sys:${index}`,
        kind: "system",
        name: part.key,
        preview: clip(text, 90),
        tokens: part.tokens,
        text,
        at: header.summary.at,
        tail: true,
      })
    })
    const hits = new Map<string, number>()
    for (const entry of surface) {
      if (entry.kind === "tool") hits.set(entry.name, (hits.get(entry.name) ?? 0) + 1)
    }
    header.summary.tools.forEach((tool, index) => {
      const detail = header.tools[index]
      const schema = detail?.schema ?? ""
      rows.tools.push({
        id: `tool:${tool.name}`,
        kind: "toolSchema",
        name: tool.name,
        preview: detail?.description ? clip(detail.description, 90) : tool.name,
        tokens: tool.tokens,
        at: header.summary.at,
        description: detail?.description,
        schema,
        source: detail?.source,
        calls: hits.get(tool.name) ?? 0,
        tail: true,
      })
    })
  }
  surface.forEach((entry, index) => {
    const base = {
      id: entry.id,
      name: entry.name,
      tokens: entry.tokens,
      at: entry.at,
      turn: entry.turn,
      step: entry.step,
      position: index + 1,
    }
    if (entry.kind === "user") {
      rows.user.push({
        ...base,
        kind: "user",
        preview: entry.files?.length ? entry.files.map((file) => file.name).join(", ") : clip(entry.text, 90),
        text: entry.text,
        files: entry.files,
      })
    } else if (entry.kind === "system" || entry.kind === "synthetic" || entry.kind === "compaction") {
      rows.injected.push({ ...base, kind: "injected", preview: clip(entry.text, 90), text: entry.text, files: entry.files })
    } else if (entry.kind === "skill") {
      rows.skills.push({ ...base, kind: "skill", preview: clip(entry.text, 90), text: entry.text })
    } else if (entry.kind === "reply") {
      rows.assistant.push({ ...base, kind: "reply", preview: clip(entry.text, 90), text: entry.text })
    } else if (entry.kind === "reasoning") {
      rows.reasoning.push({ ...base, kind: "reasoning", preview: clip(entry.text, 90), text: entry.text })
    } else {
      // Every other kind was handled above; the chain leaves exactly a tool entry.
      const tool = entry as SurfaceToolEntry
      rows.toolCalls.push({
        ...base,
        id: `${entry.id}:call`,
        kind: "toolCall",
        tokens: tool.callTokens,
        preview: clip(tool.input, 90),
        input: tool.input,
        status: tool.status,
      })
      rows.toolResults.push({
        ...base,
        id: `${entry.id}:result`,
        kind: "toolResult",
        tokens: tool.resultTokens,
        preview: clip(tool.output || tool.status, 90),
        input: tool.input,
        output: tool.output,
        status: tool.status,
        truncated: tool.truncated,
        files: tool.files,
      })
    }
  })
  return CATEGORY_ORDER.map((key) => {
    const list = rows[key]
      .slice()
      .sort((left, right) => right.at - left.at || (right.position ?? 0) - (left.position ?? 0))
    return { key, rows: list, tokens: list.reduce((sum, row) => sum + row.tokens, 0) }
  })
}

export interface CategoryGroup {
  readonly category: Category
  readonly tokens: number
  readonly items: readonly Item[]
}

export interface GroupDelta {
  readonly tokens: number
  readonly items: number
}

/** Signed per-category change from a previous request; missing rows count as zero. */
export function groupDeltas(
  current: readonly BrowserGroup[],
  base: readonly BrowserGroup[] | undefined,
): Partial<Record<Category, GroupDelta>> {
  if (base === undefined) return {}
  const previous = new Map(base.map((group) => [group.key, group]))
  const deltas: Partial<Record<Category, GroupDelta>> = {}
  for (const group of current) {
    const before = previous.get(group.key)
    deltas[group.key] = {
      tokens: group.tokens - (before?.tokens ?? 0),
      items: group.rows.length - (before?.rows.length ?? 0),
    }
  }
  return deltas
}

/** Snapshot items grouped by category, largest category first. */
export function groupItems(items: readonly Item[]): CategoryGroup[] {
  const groups = new Map<Category, Item[]>()
  for (const item of items) {
    const list = groups.get(item.category)
    if (list) list.push(item)
    else groups.set(item.category, [item])
  }
  return [...groups.entries()]
    .map(([category, list]) => ({
      category,
      tokens: list.reduce((sum, item) => sum + item.tokens, 0),
      items: [...list].sort((left, right) => right.tokens - left.tokens),
    }))
    .sort((left, right) => right.tokens - left.tokens)
}

