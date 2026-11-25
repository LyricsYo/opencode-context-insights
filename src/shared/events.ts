import type { SessionMessageInfo } from "@opencode/client"
import { clip, estimateTokens } from "./estimate.ts"
import { skillToolOf } from "./reportInternal.ts"

export type EventKind = "inject" | "skill" | "compaction" | "model" | "agent" | "error"

export const EVENT_KINDS: readonly EventKind[] = ["inject", "skill", "compaction", "model", "agent", "error"]

export interface EventRow {
  readonly id: string
  readonly at: number
  readonly kind: EventKind
  readonly name?: string
  readonly detail?: string
  readonly reason?: "auto" | "manual"
  readonly status?: string
  readonly error?: string
  readonly from?: string
  readonly to?: string
  readonly count?: number
  readonly tokens?: number
  readonly grossTokens?: number
  readonly turn?: number
  readonly step?: number
  readonly fromTurn?: number
  readonly fromStep?: number
  /** The request that first carried this event into the context. */
  readonly stepID?: string
  readonly failed: boolean
}

/** What a message contributes to the context a compaction replaces. */
function eventMessageCount(message: SessionMessageInfo): number {
  if (message.type === "user" || message.type === "system" || message.type === "synthetic" || message.type === "skill") return 1
  if (message.type === "assistant") return message.content.length > 0 ? 1 : 0
  return 0
}

export function buildEvents(messages: readonly SessionMessageInfo[]): EventRow[] {
  const requests: { index: number; turn: number; step: number; id: string }[] = []
  let turn = 0
  let step = 0
  messages.forEach((message, index) => {
    if (message.type === "user") {
      turn += 1
      step = 0
      return
    }
    if (message.type === "assistant" && message.tokens) {
      step += 1
      requests.push({ index, turn, step, id: message.id })
    }
  })

  const rows: EventRow[] = []
  let ri = 0
  let replacedCount = 0
  let lastPrompt: number | undefined
  for (let index = 0; index < messages.length; index++) {
    const message = messages[index]
    while (ri < requests.length && requests[ri].index <= index) ri += 1
    const next = requests[ri]
    const prev = ri > 0 ? requests[ri - 1] : undefined
    const span = {
      turn: next?.turn,
      step: next?.step,
      fromTurn: prev?.turn,
      fromStep: prev?.step,
      stepID: next?.id,
    }
    if (message.type === "compaction") {
      if (message.status === "completed") {
        const summaryTokens = estimateTokens(message.summary)
        const gross = lastPrompt
        rows.push({
          id: message.id,
          at: message.time.created,
          kind: "compaction",
          reason: message.reason,
          status: message.status,
          count: replacedCount,
          tokens: gross === undefined ? undefined : Math.max(0, gross - summaryTokens),
          grossTokens: gross,
          failed: false,
          ...span,
        })
        replacedCount = 1
      } else {
        rows.push({
          id: message.id,
          at: message.time.created,
          kind: "compaction",
          reason: message.reason,
          status: message.status,
          ...(message.status === "failed" ? { error: message.error.message } : {}),
          failed: message.status === "failed",
          ...span,
        })
      }
      continue
    }
    replacedCount += eventMessageCount(message)
    if (message.type === "assistant" && message.tokens) {
      lastPrompt = message.tokens.input + message.tokens.cache.read + message.tokens.cache.write
    }
    if (message.type === "system" || message.type === "synthetic") {
      rows.push({
        id: message.id,
        at: message.time.created,
        kind: "inject",
        name: message.description ?? clip(message.text, 90),
        detail: message.description ? clip(message.text, 90) : undefined,
        tokens: estimateTokens(message.text),
        failed: false,
        ...span,
      })
    } else if (message.type === "skill") {
      rows.push({
        id: message.id,
        at: message.time.created,
        kind: "skill",
        name: message.name,
        tokens: estimateTokens(message.text),
        failed: false,
        ...span,
      })
    } else if (message.type === "model-switched") {
      rows.push({
        id: message.id,
        at: message.time.created,
        kind: "model",
        from: message.previous?.id,
        to: message.model.id,
        failed: false,
        ...span,
      })
    } else if (message.type === "agent-switched") {
      rows.push({
        id: message.id,
        at: message.time.created,
        kind: "agent",
        from: message.previous,
        to: message.agent,
        failed: false,
        ...span,
      })
    } else if (message.type === "idle" && message.outcome !== "succeeded") {
      rows.push({
        id: message.id,
        at: message.time.created,
        kind: "error",
        status: message.outcome,
        error: message.error?.message,
        failed: true,
        ...span,
      })
    } else if (message.type === "assistant") {
      for (const part of message.content) {
        if (part.type !== "tool") continue
        const skill = skillToolOf(part)
        if (skill === undefined) continue
        rows.push({
          id: part.id,
          at: part.time.created,
          kind: "skill",
          name: skill.name,
          tokens: estimateTokens(skill.text),
          failed: false,
          ...span,
        })
      }
    }
  }
  return rows.reverse()
}

