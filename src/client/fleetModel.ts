import type { JSX } from "solid-js"
import { LEAD_HUE, familyHue, type FleetLink, type FleetNode } from "../shared/fleet.ts"
import { CATEGORY_COLOR } from "./colors.ts"
import { SECTION_SCROLL_MAX } from "./styleMetrics.ts"

export function fleetStatusColor(node: FleetNode): string {
  if (node.running) return "#22a06b"
  if (node.outcome === "failed") return "#d64545"
  if (node.outcome === "interrupted") return "#c9a227"
  return node.completed ? "#7f8c8d" : "#c9a227"
}

export function fleetHue(node: FleetNode | undefined): string {
  return node === undefined || node.isCurrent || node.family < 0 ? LEAD_HUE : familyHue(node.family)
}

export function fleetInitials(title: string): string {
  const clean = title.trim()
  if (clean === "") return "?"
  if (/[\u3400-\u9fff]/.test(clean)) return clean.slice(0, 1)
  const words = clean.split(/\s+/).filter(Boolean)
  return words.slice(0, 2).map((word) => word.charAt(0).toUpperCase()).join("")
}

export function fleetLinkPath(link: FleetLink): string {
  const curve = Math.min(90, Math.max(24, (link.y2 - link.y1) * 0.45))
  return `M ${link.x1} ${link.y1} C ${link.x1} ${link.y1 + curve}, ${link.x2} ${link.y2 - curve}, ${link.x2} ${link.y2}`
}

export const FLEET_ROW_H = 24
export const FLEET_LABEL_W = 132
/** Scrollable timeline density: one pixel per five seconds of fleet-active time. */
export const FLEET_PX_PER_SECOND = 0.2
/** Axis spacer + parallel strip + card gaps/padding + one-line hint: 420px minus this is the rows area. */
export const FLEET_TIMELINE_CHROME_H = 76
/** The tree stage and the timeline card share one max height so switching modes does not jump. */
export const FLEET_BODY_MAX_H = SECTION_SCROLL_MAX - FLEET_TIMELINE_CHROME_H

export function fleetAxisLabel(at: number, span: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, "0")
  const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  if (span < 10 * 60_000) {
    return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  }
  if (span < 7 * 24 * 3600_000) return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`
  return day
}

export function fleetTickPosition(index: number, count: number, position: number): JSX.CSSProperties {
  const left = `${position * 100}%`
  if (index === 0) return { left }
  if (index === count - 1) return { left, transform: "translateX(-100%)" }
  return { left, transform: "translateX(-50%)" }
}

export function fleetKindLabel(t: (key: string) => string, kind: string): string {
  if (kind === "user") return t("fleet.kind.prompt")
  if (kind === "reply") return t("fleet.kind.reply")
  if (kind === "skill") return t("fleet.kind.skill")
  return t("fleet.kind.context")
}

/** Transcript row colour, using the same category tints as the context composition. */
export function fleetKindColor(kind: string): string {
  if (kind === "user") return CATEGORY_COLOR.user
  if (kind === "reply") return CATEGORY_COLOR.assistant
  if (kind === "skill") return CATEGORY_COLOR.skills
  return CATEGORY_COLOR.injected
}

/** A delegation's state glyph and tone: done, failed, running, else pending. */
export function fleetDelegationMark(status: string | undefined): { glyph: string; color: string } {
  if (status === "completed") return { glyph: "✓", color: "#22a06b" }
  if (status === "error" || status === "failed") return { glyph: "✗", color: "#d64545" }
  if (status === "running") return { glyph: "●", color: "#c9a227" }
  return { glyph: "⇢", color: "#5b8def" }
}

