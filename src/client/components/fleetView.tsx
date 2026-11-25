import { For, Index, Show, createEffect, createSignal, onCleanup, onMount } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { span, stamp } from "../../shared/report.ts"
import { fleetPositionOf, fleetTimeAt, type FleetTimeline } from "../../shared/fleet.ts"
import { FLEET_BODY_MAX_H, FLEET_LABEL_W, FLEET_PX_PER_SECOND, FLEET_ROW_H, fleetAxisLabel, fleetHue, fleetStatusColor, fleetTickPosition } from "../fleetModel.ts"
import { Dot } from "./section.tsx"
import { FleetAvatar } from "./fleetAvatar.tsx"

export function FleetTimelineView(props: {
  timeline: FleetTimeline
  fit: "adaptive" | "overview"
  selected?: string
  lit?: ReadonlySet<string>
  focus?: string
  onFocusDone?: () => void
  onHover: (id: string | null) => void
  onPick: (id: string) => void
}) {
  const ctx = usePlugin()
  const duration = () => Math.max(1, props.timeline.end - props.timeline.start)
  const pct = (at: number) => fleetPositionOf(props.timeline, at) * 100
  const axis = (at: number) => fleetAxisLabel(at, duration())
  const peak = () => Math.max(1, props.timeline.peak)
  const related = (id: string) => props.lit === undefined || props.lit.has(id)
  const activeNow = () =>
    props.timeline.rows.some((row) =>
      row.spans.some((span) => span.start <= props.timeline.now && span.end > props.timeline.now),
    )
  const rowsHeight = () => props.timeline.rows.length * FLEET_ROW_H || FLEET_ROW_H
  const [trackViewport, setTrackViewport] = createSignal(0)
  const [trackViewportH, setTrackViewportH] = createSignal(0)
  const [scrollbarH, setScrollbarH] = createSignal(0)
  const measureScrollbar = () => {
    // A horizontal scrollbar is the difference between the border box and the client box.
    setScrollbarH(Math.max(0, fleetBodyEl.offsetHeight - fleetBodyEl.clientHeight))
  }
  onMount(() => {
    setTrackViewport(fleetBodyEl.clientWidth)
    setTrackViewportH(fleetBodyEl.clientHeight)
    measureScrollbar()
    if (typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (rect === undefined) return
      if (rect.width > 0) setTrackViewport(rect.width)
      if (rect.height > 0) setTrackViewportH(rect.height)
      measureScrollbar()
    })
    observer.observe(fleetBodyEl)
    onCleanup(() => observer.disconnect())
  })
  const linkPath = (link: FleetTimeline["links"][number]): string => {
    const x1 = pct(link.at) * 10
    const x2 = pct(link.childStart) * 10
    const y1 = link.from * FLEET_ROW_H + FLEET_ROW_H / 2
    const y2 = link.to * FLEET_ROW_H + FLEET_ROW_H / 2
    const mid = (y1 + y2) / 2
    return `M ${x1} ${y1} C ${x1} ${mid}, ${x2} ${mid}, ${x2} ${y2}`
  }
  const trackWidth = () =>
    Math.max(
      trackViewport(),
      Math.round((props.timeline.active / 1000) * FLEET_PX_PER_SECOND),
    )
  const adaptive = () => props.fit === "adaptive"
  const axisWidth = () => (adaptive() ? trackWidth() : trackViewport())
  const headerWidth = () => (adaptive() ? `${trackWidth()}px` : "100%")
  // The body must not set a measured pixel width: at the viewport edge a 1px rounding difference
  // toggles its horizontal scrollbar, which toggles the vertical one, which changes the measured
  // width again. `max(100%, ...)` lets the browser resolve the exact-fit case without a scrollbar.
  const bodyWidth = () =>
    adaptive() ? `max(100%, ${Math.round((props.timeline.active / 1000) * FLEET_PX_PER_SECOND)}px)` : "100%"
  const bodyHeight = () => {
    if (!adaptive()) return rowsHeight()
    const fit = Math.min(rowsHeight(), FLEET_BODY_MAX_H)
    // When every row fits, give the horizontal scrollbar its own strip instead of letting it
    // cover the bottom lane. When rows already scroll, the scrollbar overlaps only scrollable
    // space and adding its height would push the card past the section limit.
    return rowsHeight() <= FLEET_BODY_MAX_H
      ? Math.min(FLEET_BODY_MAX_H, fit + scrollbarH())
      : fit
  }
  const labelsHeight = () => Math.min(bodyHeight(), trackViewportH() || bodyHeight())
  // Refs are assigned during render, so the effect and the scroll handler always see them.
  let fleetLabelsEl!: HTMLDivElement
  let fleetHeaderEl!: HTMLDivElement
  let fleetBodyEl!: HTMLDivElement
  const syncTimelineScroll = (): void => {
    fleetHeaderEl.scrollLeft = fleetBodyEl.scrollLeft
    fleetLabelsEl.scrollTop = fleetBodyEl.scrollTop
  }
  createEffect(() => {
    props.fit
    fleetBodyEl.scrollTop = 0
    fleetBodyEl.scrollLeft = 0
    fleetHeaderEl.scrollLeft = 0
    fleetLabelsEl.scrollTop = 0
  })
  // Overview → Fleet jump: put the picked agent's row at the top, then release the focus.
  createEffect(() => {
    const id = props.focus
    if (id === undefined) return
    const index = props.timeline.rows.findIndex((row) => row.node.id === id)
    queueMicrotask(() => {
      if (index >= 0) {
        const row = props.timeline.rows[index]
        // Put the row (its name in the fixed label column) at the top of the lane list.
        fleetBodyEl.scrollTop = index * FLEET_ROW_H
        // Start the horizontal axis at this agent's beginning.
        if (adaptive()) {
          const start = fleetPositionOf(props.timeline, row.start) * trackWidth()
          fleetBodyEl.scrollLeft = Math.max(0, Math.round(start - 16))
        }
        syncTimelineScroll()
        const scroller = fleetBodyEl.closest<HTMLElement>("[data-panel-scroll]")
        const label = fleetLabelsEl.querySelector<HTMLElement>(`[data-fleet-label="${id}"]`)
        if (scroller !== null && label !== null) {
          scroller.scrollTop += label.getBoundingClientRect().top - scroller.getBoundingClientRect().top
        }
      }
      props.onFocusDone?.()
    })
  })
  const axisTicks = () => {
    const count = Math.max(3, Math.min(21, Math.round(axisWidth() / 150)))
    return Array.from({ length: count }, (_, index) => {
      const position = index / (count - 1)
      return { at: fleetTimeAt(props.timeline, position), position }
    })
  }
  return (
    <div class="oc-fleet-timeline" style={{ ...(adaptive() ? {} : { "max-height": "none" }) }}>
      <div class="oc-fleet-timeline-row">
        <div class="oc-fleet-timeline-fixed" style={{ width: `${FLEET_LABEL_W}px` }}>
          <div class="oc-fleet-spacer" />
          <div class="oc-fleet-timeline-parallel-head">
            <span class="oc-faint">{ctx.t("fleet.parallel")}</span>
            <span class="oc-chip-value oc-fleet-counter">
              {ctx.t("fleet.peak", { n: String(props.timeline.peak) })}
            </span>
          </div>
          <div
            ref={(el) => (fleetLabelsEl = el)}
            class="oc-fleet-timeline-labels" style={{ height: `${labelsHeight()}px`, overflow: "hidden" }}
          >
            <Index each={props.timeline.rows}>
              {(row) => (
                <button
                  type="button"
                  class="oc-ctx-hover oc-fleet-timeline-label"
                  data-fleet-label={row().node.id}
                  style={{ opacity: related(row().node.id) ? 1 : 0.35 }}
                  title={row().node.title}
                  onMouseEnter={() => props.onHover(row().node.id)}
                  onMouseLeave={() => props.onHover(null)}
                  onClick={() => props.onPick(row().node.id)}
                >
                  <span
                    style={{
                      "padding-left": `${Math.min(row().node.depth, 4) * 8}px`,
                      display: "flex",
                      "align-items": "center",
                      gap: "4px",
                      "min-width": 0,
                      flex: 1,
                    }}
                  >
                    <FleetAvatar title={row().node.title} hue={fleetHue(row().node)} />
                    <span class="oc-fleet-timeline-name">{row().node.title}</span>
                  </span>
                  <Dot color={fleetStatusColor(row().node)} />
                </button>
              )}
            </Index>
          </div>
        </div>

        <div class="oc-fleet-timeline-plot">
          <div ref={(el) => (fleetHeaderEl = el)} class="oc-fleet-timeline-header">
            <div class="oc-fleet-timeline-canvas" style={{ width: headerWidth() }}>
              <div class="oc-fleet-timeline-axis-track">
              <For each={axisTicks()}>
                {(tick, index) => (
                  <span
                    class="oc-fleet-timeline-tick" style={{ ...fleetTickPosition(index(), axisTicks().length, tick.position) }}
                  >
                    {axis(tick.at)}
                  </span>
                )}
              </For>
            </div>

            <div class="oc-fleet-timeline-parallel-track">
              <div class="oc-fleet-parallel-bars">
                <For each={props.timeline.buckets}>
                  {(count, index) => {
                    const at = () =>
                      fleetTimeAt(props.timeline, (index() + 0.5) / Math.max(1, props.timeline.buckets.length))
                    return (
                      <span
                        title={`${count} · ${stamp(at())}`}
                        style={{
                          flex: 1,
                          height: `${(count / peak()) * 100}%`,
                          "min-height": count > 0 ? "2px" : "0",
                          background: count > 1 ? "#22a06b" : "#5b8def",
                          opacity: count > 0 ? 0.35 + (0.65 * count) / peak() : 0.06,
                          "border-radius": "1px",
                        }}
                      />
                    )
                  }}
                </For>
              </div>
            </div>

            </div>
          </div>

          <div
            ref={(el) => (fleetBodyEl = el)}
            class="oc-fleet-timeline-body-scroll" style={{ height: `${bodyHeight()}px`, ...(adaptive() ? {} : { overflow: "hidden" }) }}
            onScroll={syncTimelineScroll}
          >
            <div class="oc-fleet-timeline-canvas" style={{ width: bodyWidth() }}>
              <div class="oc-fleet-timeline-lanes" style={{ height: `${rowsHeight()}px` }}>
              <For each={axisTicks()}>
                {(tick) => <div class="oc-fleet-timeline-grid" style={{ left: `${tick.position * 100}%` }} />}
              </For>
              <For each={props.timeline.segments.slice(1)}>
                {(segment) => (
                  <Show when={segment.gap >= 60_000}>
                    <div
                      class="oc-fleet-timeline-gap" style={{ left: `${segment.from * 100}%` }}
                      title={ctx.t("fleet.gap", { value: span(segment.gap) })}
                    >
                      <span class="oc-fleet-timeline-gap-cap" />
                    </div>
                  </Show>
                )}
              </For>
              <svg
                class="oc-fleet-timeline-links"
                width="100%"
                height={rowsHeight()}
                viewBox={`0 0 1000 ${rowsHeight()}`}
                preserveAspectRatio="none"
              >
                <For each={props.timeline.links}>
                  {(link) => (
                    <path
                      d={linkPath(link)}
                      fill="none"
                      stroke={fleetHue(props.timeline.rows[link.to]?.node)}
                      stroke-width="1.3"
                      stroke-dasharray={props.timeline.rows[link.to]?.node.running ? "4 3" : undefined}
                      vector-effect="non-scaling-stroke"
                      opacity={related(link.parentID) && related(link.childID) ? 0.55 : 0.1}
                    />
                  )}
                </For>
              </svg>
              <Show when={activeNow()}>
                <div class="oc-fleet-timeline-now" style={{ left: `${pct(props.timeline.now)}%` }} title={ctx.t("fleet.now")} />
              </Show>
              <Index each={props.timeline.rows}>
                {(row, index) => (
                  <button
                    type="button"
                    class="oc-ctx-hover oc-fleet-timeline-lane"
                    style={{ top: `${index * FLEET_ROW_H}px`, background:
                        props.selected === row().node.id
                          ? "color-mix(in srgb, currentColor 8%, transparent)"
                          : "transparent", opacity: related(row().node.id) ? 1 : 0.35 }}
                    onMouseEnter={() => props.onHover(row().node.id)}
                    onMouseLeave={() => props.onHover(null)}
                    onClick={() => props.onPick(row().node.id)}
                    title={row().node.title}
                  >
                    <For each={row().spans}>
                      {(part) => (
                        <span
                          class="oc-fleet-timeline-bar" style={{ left: `${pct(part.start)}%`, width: `${pct(part.end) - pct(part.start)}%`, background: fleetHue(row().node) }}
                          title={`${row().node.title} · ${stamp(part.start)} → ${stamp(part.end)} · ${span(part.end - part.start)}`}
                        />
                      )}
                    </For>
                    <Show when={row().spans.length === 0}>
                      <span
                        class="oc-fleet-timeline-bar" style={{ left: `${pct(row().node.createdAt)}%`, width: "2px", background: fleetHue(row().node), opacity: 0.5 }}
                      />
                    </Show>
                  </button>
                )}
              </Index>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="oc-fleet-timeline-head oc-fleet-timeline-head-auto">
        <span class="oc-fleet-timeline-hint" title={ctx.t("fleet.timelineHint")}>
          {ctx.t("fleet.timelineHint")}
        </span>
      </div>
    </div>
  )
}


