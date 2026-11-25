import type { SessionMessageInfo } from "@opencode/client"
import type { HeaderDetail, HeaderSummary } from "../../src/shared/header.ts"

export const at = (minute: number) => Date.UTC(2026, 0, 1, 0, minute)

export function assistant(input: number, output: number, extra: Record<string, unknown> = {}): SessionMessageInfo {
  return {
    id: `msg_${input}`,
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: at(input), completed: at(input) + 1000 },
    content: [],
    tokens: { input, output, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.01,
    ...extra,
  } as unknown as SessionMessageInfo
}

export function assistantAt(input: number, output: number, minute: number): SessionMessageInfo {
  return {
    ...assistant(input, output),
    time: { created: at(minute), completed: at(minute) + 1000 },
  } as SessionMessageInfo
}

export function headerSummary(at: number, system: number, tools: number): HeaderSummary {
  return {
    at,
    systemHash: `s${at}`,
    toolsHash: `t${at}`,
    system: [{ key: "core", tokens: system }],
    tools: [{ name: "read", tokens: tools }],
  }
}

export function headerDetail(summary: HeaderSummary): HeaderDetail {
  return {
    summary,
    system: [{ key: "core", text: "" }],
    tools: [{ name: "read", description: "", schema: "" }],
  }
}

export function tool(id: string, name: string, state: Record<string, unknown>, start: number, end: number) {
  return {
    type: "tool",
    id,
    name,
    time: { created: start, ran: start, completed: end },
    state,
  }
}
