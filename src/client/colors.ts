import type { Category } from "../shared/estimate.ts"
import type { EventKind } from "../shared/report.ts"

export const CATEGORY_COLOR: Record<Category, string> = {
  system: "#5b8def",
  tools: "#22a06b",
  user: "#e07b39",
  injected: "#9b59b6",
  skills: "#d64545",
  assistant: "#0e9aa7",
  reasoning: "#c9a227",
  toolCalls: "#3f7fbf",
  toolResults: "#7f8c8d",
}

export const EVENT_COLOR: Record<EventKind, string> = {
  inject: "#22a06b",
  skill: "#8b5cf6",
  compaction: "#d64545",
  model: "#5b8def",
  agent: "#0ea5a4",
  error: "#d64545",
}

export const EVENT_GLYPH: Record<EventKind, string> = {
  inject: "+",
  skill: "✦",
  compaction: "✂",
  model: "⇄",
  agent: "◈",
  error: "!",
}

export const TREND_DURATION_COLOR = "#ec4899"
