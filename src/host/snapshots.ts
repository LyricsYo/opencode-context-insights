import type { Snapshot } from "../shared/estimate.ts"

export interface SnapshotStore {
  get(sessionID: string): Snapshot | undefined
  set(sessionID: string, snapshot: Snapshot): void
  clear(): void
}

/** Latest context snapshot per session; bounded so a long-running host does not grow forever. */
export function createSnapshotStore(max = 100): SnapshotStore {
  const snapshots = new Map<string, Snapshot>()
  return {
    get: (sessionID) => snapshots.get(sessionID),
    set(sessionID, snapshot) {
      // Re-insert so the eviction order is least-recently-written.
      snapshots.delete(sessionID)
      snapshots.set(sessionID, snapshot)
      if (snapshots.size <= max) return
      snapshots.delete(snapshots.keys().next().value as string)
    },
    clear: () => snapshots.clear(),
  }
}
