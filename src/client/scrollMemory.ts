import { createEffect, onCleanup, onMount, type Accessor } from "solid-js"
import { panelMemoryOf, type PanelView } from "./panelSupport.ts"

export interface ScrollMemoryParams {
  readonly sessionID: Accessor<string>
  readonly view: Accessor<PanelView>
}

/** Keeps the panel, each tab and tagged inner scrollers at their remembered offsets. */
export function createScrollMemory(params: ScrollMemoryParams) {
  const { sessionID, view } = params
  let rootEl: HTMLElement | undefined
  let bodyEl: HTMLDivElement | undefined
  let ready = false

  const viewScroll = () => panelMemoryOf(sessionID()).scroll

  const restoreKeyed = () => {
    const root = rootEl
    if (root === undefined) return
    const sections = panelMemoryOf(sessionID()).sections
    for (const node of root.querySelectorAll<HTMLElement>("[data-scroll-key]")) {
      const key = node.dataset.scrollKey
      if (key === undefined) continue
      const saved = sections.get(key)
      if (saved === undefined) continue
      node.scrollTop = saved.top
      node.scrollLeft = saved.left
    }
  }

  const restoreBody = () => {
    if (bodyEl === undefined) return
    const memory = panelMemoryOf(sessionID())
    bodyEl.scrollTop = memory.scroll.get(memory.view) ?? 0
  }

  const restore = () => {
    restoreBody()
    restoreKeyed()
  }

  onMount(() => {
    const root = rootEl
    if (root !== undefined) {
      const save = (event: Event) => {
        if (!ready) return
        const target = event.target
        if (!(target instanceof HTMLElement)) return
        const key = target.dataset.scrollKey
        if (key === undefined) return
        // Hidden <details> content cannot keep a meaningful offset; do not overwrite the saved one with 0.
        if (target.clientHeight === 0) return
        const sections = panelMemoryOf(sessionID()).sections
        const previous = sections.get(key)
        if (previous !== undefined && previous.top === target.scrollTop && previous.left === target.scrollLeft) return
        sections.set(key, { top: target.scrollTop, left: target.scrollLeft })
        if (sections.size > 256) {
          const oldest = sections.keys().next().value
          if (oldest !== undefined && oldest !== key) sections.delete(oldest)
        }
      }
      root.addEventListener("scroll", save, true)
      onCleanup(() => root.removeEventListener("scroll", save, true))
    }
    queueMicrotask(restoreKeyed)
    requestAnimationFrame(() => {
      ready = true
    })
  })

  createEffect(() => {
    const current = view()
    const id = sessionID()
    panelMemoryOf(id).view = current
    queueMicrotask(() => {
      restoreBody()
      restoreKeyed()
    })
  })

  createEffect(() => {
    const memory = panelMemoryOf(sessionID())
    queueMicrotask(() => {
      if (bodyEl !== undefined) bodyEl.scrollTop = memory.scroll.get(memory.view) ?? 0
    })
  })

  const rememberChartScroll = (which: "trend" | "timing", el: HTMLDivElement) => {
    if (!ready) return
    const memory = panelMemoryOf(sessionID())
    if (which === "trend") memory.trendLeft = el.scrollLeft
    else memory.timingLeft = el.scrollLeft
  }

  return {
    attachRoot: (el: HTMLElement) => (rootEl = el),
    attachBody: (el: HTMLDivElement) => (bodyEl = el),
    onBodyScroll: () => {
      if (!ready || bodyEl === undefined) return
      viewScroll().set(view(), bodyEl.scrollTop)
    },
    restore,
    restoreKeyed,
    rememberChartScroll,
  }
}
