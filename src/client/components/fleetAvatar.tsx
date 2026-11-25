import { fleetInitials } from "../fleetModel.ts"

export function FleetAvatar(props: { title: string; hue: string }) {
  return <span class="oc-fleet-avatar" style={{ background: props.hue }}>{fleetInitials(props.title)}</span>
}

