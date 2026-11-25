import type { SessionMessageInfo } from "@opencode/client"
import { estimateTokens } from "./estimate.ts"
import { attachmentTokensOfMessage } from "./messageImages.ts"
import { contentText, objectOf, skillToolOf, stringOf, type JsonRecord } from "./reportInternal.ts"

export type SurfaceKind = "user" | "skill" | "reply" | "reasoning" | "tool" | "compaction" | "system" | "synthetic"

export interface SurfaceFile {
  readonly name: string
  readonly mime: string
  /** Base64 data, when the session carries it. */
  readonly data?: string
  readonly uri?: string
  readonly source?: string
  readonly description?: string
}

export interface SurfaceEntry {
  readonly id: string
  readonly messageID: string
  readonly at: number
  readonly kind: SurfaceKind
  readonly name: string
  readonly text: string
  readonly tokens: number
  readonly status?: string
  readonly input?: string
  readonly output?: string
  readonly truncated?: boolean
  readonly callTokens?: number
  readonly resultTokens?: number
  readonly turn?: number
  readonly step?: number
  readonly files?: readonly SurfaceFile[]
}

/** A tool call always carries the token split and its rendered input and output. */
export interface SurfaceToolEntry extends SurfaceEntry {
  readonly kind: "tool"
  readonly status: string
  readonly input: string
  readonly output: string
  readonly truncated: boolean
  readonly callTokens: number
  readonly resultTokens: number
}

export function isToolEntry(entry: SurfaceEntry): entry is SurfaceToolEntry {
  return entry.kind === "tool"
}

/** Mirrors `compose`: user text that carries injected context or a skill is not a plain user message. */
export function userSurface(text: string): { readonly kind: SurfaceKind; readonly name: string } {
  // Injections are whole messages; a mention inside prose (a summary, a doc) must not match.
  if (/^\s*<conversation-checkpoint\b/.test(text)) return { kind: "synthetic", name: "Conversation checkpoint" }
  const skill = /^\s*<skill_content(?:\s+name="([^"]*)")?/.exec(text)
  if (skill) return { kind: "skill", name: skill[1] || "Skill" }
  if (/^\s*<context\b/.test(text)) return { kind: "synthetic", name: "Injected context" }
  return { kind: "user", name: "User" }
}

function surfaceFiles(value: unknown): SurfaceFile[] | undefined {
  if (!Array.isArray(value)) return undefined
  const files: SurfaceFile[] = []
  for (const raw of value) {
    const file = objectOf(raw)
    if (!file) continue
    if (typeof file.type === "string" && file.type !== "file") continue
    const mime = stringOf(file.mime) ?? "application/octet-stream"
    const uri = stringOf(file.uri)
    const data = stringOf(file.data)
    if (!stringOf(file.mime) && !uri && !data) continue
    const name = stringOf(file.name) ?? (uri ? uri.split("/").at(-1) : undefined) ?? "file"
    files.push({
      name,
      mime,
      data,
      uri,
      source: stringOf(file.source),
      description: stringOf(file.description),
    })
  }
  return files.length > 0 ? files : undefined
}

/** The request contents up to a step: messages after the last compaction, including its summary. */
export function buildSurface(
  messages: readonly SessionMessageInfo[],
  upto?: string,
  includeStep = true,
  all = false,
  kinds?: ReadonlySet<SurfaceKind>,
): SurfaceEntry[] {
  let end = messages.length - 1
  if (upto !== undefined) {
    const found = messages.findIndex((message) => message.id === upto)
    if (found >= 0) end = includeStep ? found : found - 1
  }
  let start = 0
  if (!all) {
    for (let index = end; index >= 0; index--) {
      const message = messages[index]
      if (message.type === "compaction" && message.status === "completed") {
        start = index
        break
      }
    }
  }
  const entries: SurfaceEntry[] = []
  const push = (entry: Omit<SurfaceEntry, "tokens"> & { tokens?: number }) => {
    entries.push(entry.tokens === undefined ? { ...entry, tokens: estimateTokens(entry.text) } : { ...entry, tokens: entry.tokens })
  }
  const wanted = (kind: SurfaceKind) => kinds === undefined || kinds.has(kind)
  let turn = 0
  let step = 0
  // Counters run over the whole log so labels stay aligned with the timeline after a compaction.
  for (let index = 0; index <= end; index++) {
    const message = messages[index]
    const visible = index >= start
    if (message.type === "user") {
      turn += 1
      step = 0
      if (!visible) continue
      const surface = userSurface(message.text)
      if (!wanted(surface.kind)) continue
      push({
        id: message.id,
        messageID: message.id,
        at: message.time.created,
        kind: surface.kind,
        name: surface.name,
        text: message.text,
        tokens: estimateTokens(message.text) + attachmentTokensOfMessage(message),
        turn,
        step: 1,
        files: surfaceFiles(message.files),
      })
    } else if (message.type === "system") {
      if (!visible || !wanted("system")) continue
      push({
        id: message.id,
        messageID: message.id,
        at: message.time.created,
        kind: "system",
        name: message.description ?? "System",
        text: message.text,
        turn,
        step,
      })
    } else if (message.type === "synthetic") {
      if (!visible || !wanted("synthetic")) continue
      push({
        id: message.id,
        messageID: message.id,
        at: message.time.created,
        kind: "synthetic",
        name: message.description ?? "Synthetic",
        text: message.text,
        turn,
        step,
      })
    } else if (message.type === "skill") {
      if (!visible || !wanted("skill")) continue
      push({
        id: message.id,
        messageID: message.id,
        at: message.time.created,
        kind: "skill",
        name: message.name,
        text: message.text,
        turn,
        step,
      })
    } else if (message.type === "compaction") {
      if (!visible || !wanted("compaction")) continue
      push({
        id: message.id,
        messageID: message.id,
        at: message.time.created,
        kind: "compaction",
        name: `Compaction · ${message.reason}`,
        text: message.status === "completed" ? message.summary : "",
        turn,
        step,
      })
    } else if (message.type === "assistant") {
      step += 1
      if (!visible) continue
      message.content.forEach((part, partIndex) => {
        const id = `${message.id}:${partIndex}`
        if (part.type === "text") {
          if (wanted("reply")) {
            push({ id, messageID: message.id, at: message.time.created, kind: "reply", name: "Reply", text: part.text, turn, step })
          }
        } else if (part.type === "reasoning") {
          if (wanted("reasoning")) {
            push({ id, messageID: message.id, at: message.time.created, kind: "reasoning", name: "Reasoning", text: part.text, turn, step })
          }
        } else if (part.type === "tool") {
          const skill = skillToolOf(part)
          if (skill !== undefined) {
            if (!wanted("skill")) return
            push({ id, messageID: message.id, at: part.time.created, kind: "skill", name: skill.name, text: skill.text, turn, step })
          } else if (!wanted("tool")) {
            return
          } else {
            const state = part.state as unknown as JsonRecord
            const input = state.input
            const output = contentText(state.content)
            const error = objectOf(state.error)
            const inputText = typeof input === "string" ? input : JSON.stringify(input ?? {})
            const outputText = output || String(error?.message ?? "")
            const callTokens = estimateTokens(`${part.name} ${inputText}`)
            const resultTokens = estimateTokens(outputText)
            push({
              id: part.id,
              messageID: message.id,
              at: part.time.created,
              kind: "tool",
              name: part.name,
              text: `${inputText}\n${outputText}`,
              tokens: callTokens + resultTokens,
              status: String(state.status ?? "unknown"),
              input: typeof input === "string" ? input : JSON.stringify(input ?? {}, null, 1),
              output: outputText,
              truncated: objectOf(state.metadata)?.truncated === true,
              callTokens,
              resultTokens,
              turn,
              step,
              files: surfaceFiles(state.content),
            } satisfies SurfaceToolEntry)
          }
        }
      })
    }
  }
  return entries
}

