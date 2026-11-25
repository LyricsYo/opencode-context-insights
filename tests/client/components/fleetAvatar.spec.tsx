import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { FleetAvatar } from "../../../src/client/components/fleetAvatar.tsx"
import { mount } from "../helpers/mount.tsx"

describe("FleetAvatar", () => {
  test("renders the initials on the given hue", () => {
    const { container, dispose } = mount(() => <FleetAvatar title="scan the repo" hue="#5b8def" />)
    const avatar = container.querySelector<HTMLElement>(".oc-fleet-avatar")!
    assert.equal(avatar.textContent, "ST")
    assert.equal(avatar.style.backgroundColor, "rgb(91, 141, 239)")
    dispose()
  })
})
