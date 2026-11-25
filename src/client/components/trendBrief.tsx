import type { JSX } from "solid-js"
import { type StepBriefEntry } from "../../shared/report.ts"

export function TrendBriefRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="oc-brief-row">
      <span class="oc-brief-label">{props.label}</span>
      <div class="oc-brief-body">{props.children}</div>
    </div>
  )
}

export function TrendBriefChip(props: { entry: StepBriefEntry; onClick: () => void }) {
  return (
    <button type="button" class="oc-ctx-hover oc-brief-chip"  title={props.entry.preview} onClick={props.onClick}>
      <span class="oc-brief-tag">{props.entry.name}</span>
      <span class="oc-brief-text">{props.entry.preview}</span>
    </button>
  )
}

