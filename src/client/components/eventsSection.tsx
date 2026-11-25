import { For, Show } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { EVENT_KINDS } from "../../shared/report.ts"
import { growOnScroll } from "../paging.ts"
import { EventRowView, Section } from "./common.tsx"
import { createTrendModel } from "../models/trend.ts"
import { createTimingModel } from "../models/timing.ts"
import { createBrowserModel } from "../models/browser.ts"
import { createSessionModel } from "../models/session.ts"
import type { BrowserUi } from "./browserPanel.tsx"

export interface EventsSectionProps {
  readonly session: ReturnType<typeof createSessionModel>
  readonly trend: ReturnType<typeof createTrendModel>
  readonly timing: ReturnType<typeof createTimingModel>
  readonly browser: ReturnType<typeof createBrowserModel>
  readonly ui: BrowserUi
  readonly attachTrendScroll: (el: HTMLDivElement) => void
  readonly attachTimingScroll: (el: HTMLDivElement) => void
  readonly attachBrowserAnchor: (el: HTMLElement) => void
  readonly attachBrowserSelect: (el: HTMLSelectElement) => void
  readonly measureTrendWindow: (el: HTMLDivElement) => void
  readonly measureTimingWindow: (el: HTMLDivElement) => void
  readonly refreshTrendWindow: () => void
  readonly refreshTimingWindow: () => void
  readonly scrollToBrowser: () => void
}

export function EventsSection(props: EventsSectionProps) {
  const ctx = usePlugin()
  const { events } = props.session
  const { filteredEvents, eventLimit, eventKinds, toggleEventKind, eventCounts, eventLabelOf, eventAtOf, focusEvent, setEventLimit } = props.ui
  return (
    <>
        <Section
          title={ctx.t("events.title")}
          scroll
          scrollKey="events"
          onScroll={(event) =>
            growOnScroll(event, eventLimit(), filteredEvents().length, setEventLimit)
          }
          toolbar={
            <div class="oc-event-filters">
              <For each={EVENT_KINDS}>
                {(kind) => (
                  <button
                    type="button"
                    class="oc-ctx-hover oc-toggle" classList={{ "oc-toggle-active": eventKinds().includes(kind) }}
                    onClick={() => toggleEventKind(kind)}
                  >
                    {ctx.t(`event.kind.${kind}`)}
                    <span class="oc-event-kind-count">{eventCounts()[kind] ?? 0}</span>
                  </button>
                )}
              </For>
            </div>
          }
        >
          <Show when={events().length > 0} fallback={<span class="oc-muted">{ctx.t("events.empty")}</span>}>
            <Show when={filteredEvents().length > 0} fallback={<span class="oc-muted">{ctx.t("events.noMatch")}</span>}>
              <div class="oc-events">
                <For each={filteredEvents().slice(0, eventLimit())}>
                  {(event) => (
                    <EventRowView
                      event={event}
                      label={eventLabelOf(event)}
                      at={eventAtOf(event)}
                      onClick={
                        event.stepID !== undefined &&
                        (event.kind === "inject" || event.kind === "skill" || event.kind === "compaction")
                          ? () => focusEvent(event)
                          : undefined
                      }
                    />
                  )}
                </For>
              </div>
            </Show>
          </Show>
        </Section>
    </>
  )
}
