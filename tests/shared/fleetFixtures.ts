import type { SessionInfo, SessionMessageInfo } from "@opencode/client"

export const at = (minute: number) => Date.UTC(2026, 0, 1, 0, minute)

export function session(id: string, parentID: string | undefined, patch: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    parentID,
    title: `title ${id}`,
    agent: "build",
    model: { id: "m", providerID: "p" },
    cost: 0.1,
    tokens: { input: 100, output: 10, reasoning: 1, cache: { read: 0, write: 0 } },
    time: { created: at(0), updated: at(1) },
    location: { directory: "D:/work" },
    projectID: "p",
    ...patch,
  } as unknown as SessionInfo
}

export function timedMessage(type: "user" | "assistant", minute: number, end?: number): SessionMessageInfo {
  return {
    id: `${type}_${minute}`,
    type,
    ...(type === "user" ? { text: "go" } : { agent: "build", model: { id: "m", providerID: "p" }, content: [] }),
    time: { created: at(minute), ...(end !== undefined ? { completed: at(end) } : {}) },
  } as unknown as SessionMessageInfo
}

export function toolMessage(id: string, name: string, state: unknown, minute: number): SessionMessageInfo {
  return {
    id,
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: at(minute), completed: at(minute) + 1000 },
    content: [{ type: "tool", id, name, state, time: { created: at(minute) } }],
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0,
  } as unknown as SessionMessageInfo
}

export const child = { id: "ses_child", title: "scan repo", createdAt: at(1), prompt: "find all files" }
