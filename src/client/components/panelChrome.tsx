import { For, type Accessor } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import type { PanelView } from "../panelSupport.ts"

const TABS: readonly PanelView[] = ["overview", "browser", "fleet"]

export interface PanelHeaderProps {
  readonly subtitle: Accessor<string>
  readonly view: Accessor<PanelView>
  readonly sessionID: string
  readonly onView: (view: PanelView) => void
  readonly onRefresh: () => void
}

export function PanelHeader(props: PanelHeaderProps) {
  const ctx = usePlugin()
  return (
    <>
      <div class="oc-header">
        <div class="oc-header-text">
          <span class="oc-title">{ctx.t("panel.title")}</span>
          <span class="oc-subtitle">{props.subtitle()}</span>
        </div>
        <div class="oc-header-actions">
          <ctx.ui.Button
            class="oc-ctx-hover"
            variant="ghost"
            size="small"
            icon="outline-rotate-clockwise"
            onClick={props.onRefresh}
          >
            {ctx.t("refresh")}
          </ctx.ui.Button>
          <ctx.ui.Button
            class="oc-ctx-hover"
            variant="ghost"
            size="small"
            icon="outline-copy"
            onClick={() => {
              void ctx.system.copy(props.sessionID).then(
                () => ctx.toast.show({ title: ctx.t("panel.copied"), variant: "success" }),
                () => ctx.toast.show({ title: ctx.t("panel.copyFailed"), variant: "error" }),
              )
            }}
          >
            {ctx.t("panel.copySession")}
          </ctx.ui.Button>
        </div>
      </div>

      <div class="oc-tabs">
        <For each={TABS}>
          {(tab) => (
            <button
              type="button"
              class="oc-ctx-hover oc-tab"
              classList={{ "oc-tab-active": props.view() === tab }}
              onClick={() => props.onView(tab)}
            >
              {ctx.t(`tab.${tab}`)}
            </button>
          )}
        </For>
      </div>
    </>
  )
}
