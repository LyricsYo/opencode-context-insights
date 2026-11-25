

/** Stored values gain a version wrapper so future shapes can be migrated without guessing. */
export const HEADER_STORAGE_VERSION = 1

interface Versioned<T> {
  readonly v: number
  readonly value: T
}

export function packValue<T>(value: T): Versioned<T> {
  return { v: HEADER_STORAGE_VERSION, value }
}

/** Reads both the versioned wrapper and the pre-versioning bare value. */
export function unpackValue<T>(raw: unknown): T | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw === "object" && !Array.isArray(raw) && "v" in raw && "value" in raw) {
    return (raw as Versioned<T>).value
  }
  return raw as T
}
