import { Show } from "solid-js"
import type { JSX } from "solid-js"

export function Section(props: {
  title: string
  hint?: string
  headerActions?: JSX.Element
  toolbar?: JSX.Element
  scroll?: boolean
  onScroll?: (event: { currentTarget: HTMLDivElement }) => void
  scrollKey?: string
  children?: JSX.Element
  ref?: (el: HTMLElement) => void
}) {
  return (
    <section ref={props.ref} class="oc-card">
      <div class="oc-section-header">
        <span class="oc-section-title">{props.title}</span>
        <Show when={props.hint}>
          <span class="oc-hint">{props.hint}</span>
        </Show>
        {props.headerActions}
      </div>
      {props.toolbar}
      {props.scroll ? (
        <div data-scroll-key={props.scrollKey} class="oc-section-scroll" onScroll={props.onScroll}>
          {props.children}
        </div>
      ) : (
        props.children
      )}
    </section>
  )
}

export function Stat(props: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div class="oc-stat">
      <span class="oc-faint oc-inline-tight">
        <Show when={props.color}>{(color) => <Dot color={color()} />}</Show>
        {props.label}
      </span>
      <span class="oc-stat-value">{props.value}</span>
      <Show when={props.hint}>
        <span class="oc-faint">{props.hint}</span>
      </Show>
    </div>
  )
}

export function Dot(props: { color: string }) {
  return <span class="oc-dot" style={{ background: props.color }} />
}

