

export function fmt(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 10_000) return `${Math.round(value / 1000)}k`
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(Math.round(value))
}

export function percent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : "—"
}

/** Percentage with two decimals, for metrics where rounding to 1% hides the difference. */
export function percent2(value: number, total: number): string {
  return total > 0 ? `${((value / total) * 100).toFixed(2)}%` : "—"
}

/** Local date and time, e.g. 11-16 09:41; use stamp() when the year matters. */
export function clock(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Full local date and time, e.g. 2026-11-13 09:41:07. */
export function stamp(at: number): string {
  const date = new Date(at)
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function span(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms)) return "—"
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  if (ms < 3_600_000) {
    const minutes = Math.floor(ms / 60_000)
    const seconds = Math.round((ms - minutes * 60_000) / 1000)
    return `${minutes}m${String(seconds).padStart(2, "0")}s`
  }
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor((ms - hours * 3_600_000) / 60_000)
  return `${hours}h${String(minutes).padStart(2, "0")}m`
}
