import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { Snapshot } from "../../src/shared/estimate.ts"
import { createSnapshotStore } from "../../src/host/snapshots.ts"

describe("createSnapshotStore", () => {
  test("evicts the oldest session", () => {
    const store = createSnapshotStore(2)
    store.set("a", {} as Snapshot)
    store.set("b", {} as Snapshot)
    store.set("c", {} as Snapshot)
    assert.equal(store.get("a"), undefined)
    assert.ok(store.get("b"))
    assert.ok(store.get("c"))
  })
})
