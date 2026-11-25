import { createEffect, createSignal, type Accessor } from "solid-js"
import { usePlugin, type PanelProps } from "@opencode/plugin/gui"
import type { FileRow } from "../../shared/report.ts"
import type { PanelView } from "../panelSupport.ts"

export interface FilePreviewParams {
  readonly props: PanelProps
  readonly view: Accessor<PanelView>
  readonly revision: Accessor<number>
  readonly shownFiles: Accessor<FileRow[]>
  readonly fileLimit: Accessor<number>
}

export function createFilePreview(params: FilePreviewParams) {
  const ctx = usePlugin()
  const { props, view, revision, shownFiles, fileLimit } = params
  const [fileMissing, setFileMissing] = createSignal<ReadonlyMap<string, boolean>>(new Map())
  const checks = new Set<string>()

  const fileHref = (path: string) =>
    /^([A-Za-z]:[\\/]|\\\\|\/)/.test(path)
      ? path
      : `${props.session.directory.replace(/[\\/]+$/, "")}/${path.replace(/^\.?[\\/]/, "")}`

  const previewFile = (path: string) => {
    const href = fileHref(path)
    try {
      if (ctx.links.open({ href, exact: true, session: props.session })) return
    } catch {
      // Fall through to the system opener.
    }
    // The cached check said the file exists but the host could not open it, so refresh that result.
    void Promise.resolve(ctx.links.exists({ href, exact: true, session: props.session }))
      .then((exists) => {
        setFileMissing((current) => {
          const next = new Map(current)
          next.set(path, exists)
          return next
        })
      })
      .catch(() => {})
    void ctx.system.openExternal(`file:///${href.replaceAll("\\", "/").replace(/^\/+/, "")}`)
  }

  // Files the session touched may be gone: strike the name and do not offer a preview.
  createEffect(() => {
    if (view() !== "browser") return
    const visible = shownFiles().slice(0, fileLimit())
    revision()
    const session = props.session
    for (const file of visible) {
      if (checks.has(file.path)) continue
      checks.add(file.path)
      void Promise.resolve(ctx.links.exists({ href: fileHref(file.path), exact: true, session }))
        .then((exists) => {
          setFileMissing((current) => {
            if (current.get(file.path) === exists) return current
            const next = new Map(current)
            next.set(file.path, exists)
            return next
          })
        })
        .catch(() => checks.delete(file.path))
    }
  })

  return {
    previewFile,
    fileMissing,
    setFileMissing,
    clearChecks: () => checks.clear(),
  }
}
