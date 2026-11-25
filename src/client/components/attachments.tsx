import { For, Show, createSignal } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import { type SurfaceFile } from "../../shared/report.ts"
import { bytesLabel, extensionOf } from "./richText.tsx"

export function AttachmentCard(props: { file: SurfaceFile }) {
  const ctx = usePlugin()
  const [dims, setDims] = createSignal<{ width: number; height: number }>()
  const bytes = () => (props.file.data ? Math.round((props.file.data.length * 3) / 4) : undefined)
  const openable = () => props.file.uri !== undefined && !props.file.uri.startsWith("data:")
  const open = () => {
    const uri = props.file.uri
    if (uri === undefined) return
    try {
      if (ctx.links.open({ href: uri, exact: true })) return
    } catch {
      // Fall through to the system opener.
    }
    void ctx.system.openExternal(uri)
  }
  return (
    <button
      type="button"
      classList={{ "oc-ctx-hover": openable() }}
      class="oc-attach-card oc-attach-plain" style={{ cursor: openable() ? "pointer" : "default" }}
      title={props.file.description ?? props.file.uri ?? props.file.name}
      aria-disabled={!openable()}
      onClick={open}
    >
      <Show
        when={props.file.mime.startsWith("image/") && props.file.data}
        fallback={<span class="oc-attach-glyph">{extensionOf(props.file.name)}</span>}
      >
        <img
          src={`data:${props.file.mime};base64,${props.file.data}`}
          alt={props.file.name}
          loading="lazy"
          decoding="async"
          class="oc-attach-img"
          onLoad={(event) => setDims({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
      </Show>
      <div class="oc-min-0">
        <div class="oc-attach-name">{props.file.name}</div>
        <div class="oc-attach-meta">
          {props.file.mime}
          {bytesLabel(bytes()) ? ` · ${bytesLabel(bytes())}` : ""}
          <Show when={dims()}>{(value) => ` · ${value().width}×${value().height}`}</Show>
        </div>
      </div>
    </button>
  )
}

export function AttachmentCards(props: { files: readonly SurfaceFile[] }) {
  const ctx = usePlugin()
  return (
    <>
      <div class="oc-field-label">{ctx.t("browser.attachments", { count: String(props.files.length) })}</div>
      <div class="oc-attach-row">
        <For each={props.files}>{(file) => <AttachmentCard file={file} />}</For>
      </div>
    </>
  )
}

