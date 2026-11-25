/**
 * What the client may expect from the host half of the plugin.
 *
 * The desktop GUI hot-reloads while the host loads once per app start, so the
 * two halves can drift after an update. The host answers `hello` with its
 * contract and method list, and the client gates optional calls on it.
 */

export const HOST_CONTRACT = 1

export interface HostInfo {
  readonly plugin: string
  readonly contract: number
  readonly storage: number
  readonly app: string
  readonly appVersion: string
  readonly methods: readonly string[]
}

/** Methods every host build must provide; a gap means the panel needs an app restart. */
export const REQUIRED_HOST_METHODS = ["snapshot", "header", "headers"] as const
