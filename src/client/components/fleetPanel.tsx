import { For, Index, Show } from "solid-js"
import { usePlugin, type PanelProps } from "@opencode/plugin/gui"
import { fmt, span } from "../../shared/report.ts"
import { CATEGORY_COLOR } from "../colors.ts"
import { Dot, Section } from "./common.tsx"
import { FleetCard, FleetInspector, FleetTimelineView, fleetHue, fleetLinkPath } from "./fleet.tsx"
import { createFleetModel } from "../models/fleet.ts"

export interface FleetPanelProps {
  readonly fleet: ReturnType<typeof createFleetModel>
  readonly session: PanelProps["session"]
  readonly attachFleetStage: (el: HTMLDivElement) => void
}

export function FleetPanel(props: FleetPanelProps) {
  const ctx = usePlugin()
  const {
    fleetPinned,
    setFleetPinned,
    fleetFocus,
    setFleetFocus,
    setFleetHover,
    fleetMode,
    setFleetMode,
    fleetTimelineFit,
    setFleetTimelineFit,
    fleet,
    fleetByID,
    fleetInspected,
    fleetLayout,
    fleetLit,
    fleetLimitOf,
    fleetHeads,
    fleetInspectedDetail,
    fleetDelegations,
    fleetIncoming,
    fleetChain,
    fleetTimeline,
    fleetActiveOf,
    fleetSummary,
    fleetCategories,
  } = props.fleet
  return (
    <>
        <Section
          title={ctx.t("fleet.title")}
          hint={fleetMode() === "timeline" ? ctx.t("fleet.hintTimeline") : ctx.t("fleet.hint")}
          headerActions={
            <>
              <span class="oc-segment">
                <button
                  type="button"
                  disabled={fleetMode() !== "timeline"}
                  class="oc-segment-btn"
                  classList={{ "oc-segment-btn-on": fleetMode() === "timeline" && fleetTimelineFit() === "adaptive" }}
                  style={{ ...(fleetMode() === "timeline" ? {} : { opacity: 0.4, cursor: "default" }) }}
                  title={ctx.t("fleet.adaptiveHint")}
                  onClick={() => setFleetTimelineFit("adaptive")}
                >
                  {ctx.t("trend.adaptive")}
                </button>
                <button
                  type="button"
                  disabled={fleetMode() !== "timeline"}
                  class="oc-segment-btn"
                  classList={{ "oc-segment-btn-on": fleetMode() === "timeline" && fleetTimelineFit() === "overview" }}
                  style={{ ...(fleetMode() === "timeline" ? {} : { opacity: 0.4, cursor: "default" }) }}
                  title={ctx.t("fleet.overviewHint")}
                  onClick={() => setFleetTimelineFit("overview")}
                >
                  {ctx.t("trend.overview")}
                </button>
              </span>
              <span class="oc-segment">
                <button
                  type="button"
                  class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": fleetMode() === "timeline" }}
                  onClick={() => setFleetMode("timeline")}
                >
                  {ctx.t("fleet.timeline")}
                </button>
                <button
                  type="button"
                  class="oc-ctx-hover oc-segment-btn" classList={{ "oc-segment-btn-on": fleetMode() === "tree" }}
                  onClick={() => setFleetMode("tree")}
                >
                  {ctx.t("fleet.tree")}
                </button>
              </span>
            </>
          }
        >
          <div class="oc-chip-row">
            <span class="oc-chip">
              <span class="oc-chip-name">{ctx.t("fleet.agents")}</span>
              <span class="oc-chip-value">{fleetSummary().agents}</span>
            </span>
            <span class="oc-chip" style={{ ...(fleetSummary().running > 0 ? { color: "#22a06b" } : {}) }}>
              <span class="oc-chip-name">{ctx.t("fleet.running")}</span>
              <span class="oc-chip-value">{fleetSummary().running}</span>
            </span>
            <span class="oc-chip" title={ctx.t("fleet.activeTip")}>
              <span class="oc-chip-name">{ctx.t("fleet.active")}</span>
              <span class="oc-chip-value">{span(fleetTimeline().active)}</span>
            </span>
            <span class="oc-chip" title={ctx.t("fleet.activeSumTip")}>
              <span class="oc-chip-name">{ctx.t("fleet.activeSum")}</span>
              <span class="oc-chip-value">{span(fleetTimeline().activeSum)}</span>
            </span>
            <span class="oc-chip">
              <span class="oc-chip-name">{ctx.t("fleet.tokens")}</span>
              <span class="oc-chip-value">
                ↑{fmt(fleetSummary().prompt)} ↓{fmt(fleetSummary().output)}
              </span>
            </span>
            <span class="oc-chip">
              <span class="oc-chip-name">{ctx.t("fleet.cost")}</span>
              <span class="oc-chip-value">${fleetSummary().cost.toFixed(4)}</span>
            </span>
            <Show when={fleetMode() === "timeline"}>
              <span class="oc-chip">
                <span class="oc-chip-name">{ctx.t("fleet.parallel")}</span>
                <span class="oc-chip-value">{ctx.t("fleet.peak", { n: String(fleetTimeline().peak) })}</span>
              </span>
            </Show>
          </div>

          <Show when={fleetMode() === "tree" && fleetCategories().length > 0}>
            <div class="oc-chip-row">
              <For each={fleetCategories()}>
                {(category) => (
                  <span class="oc-chip">
                    <Dot color={CATEGORY_COLOR[category]} />
                    {ctx.t(`category.${category}`)}
                  </span>
                )}
              </For>
            </div>
          </Show>

          <Show when={fleet().nodes.length > 0} fallback={<span class="oc-muted">{ctx.t("fleet.empty")}</span>}>
          <Show when={fleetMode() === "tree"}>
          <div ref={props.attachFleetStage} class="oc-fleet-stage">
            <div
              class="oc-fleet-canvas" style={{ width: `${fleetLayout().width}px`, height: `${fleetLayout().height}px` }}
            >
              <svg
                class="oc-fleet-links"
                width={fleetLayout().width}
                height={fleetLayout().height}
                viewBox={`0 0 ${fleetLayout().width} ${fleetLayout().height}`}
              >
                <Index each={fleetLayout().links}>
                  {(link) => {
                    const related = () => {
                      const lit = fleetLit()
                      return lit === undefined || (lit.has(link().from) && lit.has(link().to))
                    }
                    return (
                      <path
                        d={fleetLinkPath(link())}
                        fill="none"
                        stroke={fleetHue(fleetByID().get(link().to))}
                        stroke-width={link().running ? 2 : 1.4}
                        stroke-dasharray={link().running ? "5 4" : undefined}
                        opacity={related() ? 0.85 : 0.18}
                      />
                    )
                  }}
                </Index>
              </svg>
              <Index each={fleetLayout().points}>
                {(point) => {
                  const node = () => fleetByID().get(point().id)
                  return (
                    <Show when={node()}>
                      {(value) => (
                        <FleetCard
                          node={value()}
                          point={point()}
                          width={fleetLayout().cardWidth}
                          hue={fleetHue(value())}
                          active={fleetInspected()?.id === value().id}
                          activeMs={fleetActiveOf().get(value().id)}
                          lit={fleetLit()?.has(value().id)}
                          detail={fleetHeads().get(value().id)}
                          limit={fleetLimitOf(value())}
                          pinned={fleetPinned() === value().id}
                          onHover={(id) => setFleetHover(id ?? undefined)}
                          onPick={(id) => setFleetPinned((current) => (current === id ? undefined : id))}
                        />
                      )}
                    </Show>
                  )
                }}
              </Index>
            </div>
          </div>
          </Show>

          <Show when={fleetMode() === "timeline"}>
            <FleetTimelineView
              timeline={fleetTimeline()}
              fit={fleetTimelineFit()}
              selected={fleetInspected()?.id}
              lit={fleetChain()}
              focus={fleetFocus()}
              onFocusDone={() => setFleetFocus(undefined)}
              onHover={(id) => setFleetHover(id ?? undefined)}
              onPick={(id) => setFleetPinned((current) => (current === id ? undefined : id))}
            />
          </Show>

          <Show when={fleet().solo}>
            <span class="oc-muted">{ctx.t("fleet.solo")}</span>
          </Show>

          <Show when={fleetInspected()}>
            {(node) => (
              <FleetInspector
                node={node()}
                detail={fleetInspectedDetail()}
                activeMs={fleetActiveOf().get(node().id)}
                limit={fleetLimitOf(node())}
                pinned={fleetPinned() === node().id}
                incoming={fleetIncoming().get(node().id)}
                delegations={fleetDelegations().get(node().id) ?? []}
                onPick={(id) => setFleetPinned(id)}
                onOpen={() => ctx.tabs.open({ server: props.session.server.id, id: node().id }, { focus: true })}
                onUnpin={() => setFleetPinned(undefined)}
              />
            )}
          </Show>
          </Show>
        </Section>
    </>
  )
}
