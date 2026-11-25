import type { SessionMessageInfo } from "@opencode/client"
import type { CommandRow } from "./commands.ts"
import { COMMAND_TOOLS, commandRowOf, commandStatusOf, statusOf } from "./commandInternals.ts"
import { baseToolName, contentText, lineCount, numberOf, objectOf, stringOf, type JsonRecord } from "./reportInternal.ts"

export type FileOpKind = "read" | "write" | "search"

export interface FileOpRow {
  readonly id: string
  readonly messageID: string
  readonly at: number
  readonly kind: FileOpKind
  readonly path: string
  readonly tool: string
  readonly additions: number
  readonly deletions: number
  readonly status: string
  readonly hits?: number
  readonly lines?: number
  readonly detail?: string
}

export interface FileRow {
  readonly path: string
  readonly reads: number
  readonly writes: number
  readonly searches: number
  readonly additions: number
  readonly deletions: number
  readonly ops: readonly FileOpRow[]
}

function fileOpOf(
  id: string,
  messageID: string,
  at: number,
  kind: FileOpKind,
  path: string,
  tool: string,
  status: string,
  extra: { additions?: number; deletions?: number; hits?: number; lines?: number; detail?: string } = {},
): FileOpRow {
  return {
    id,
    messageID,
    at,
    kind,
    path,
    tool,
    status,
    additions: extra.additions ?? 0,
    deletions: extra.deletions ?? 0,
    ...(extra.hits === undefined ? {} : { hits: extra.hits }),
    ...(extra.lines === undefined ? {} : { lines: extra.lines }),
    ...(extra.detail === undefined ? {} : { detail: extra.detail }),
  }
}

export interface ToolScan {
  readonly commands: CommandRow[]
  readonly files: FileOpRow[]
}

/** A path relative to the workspace root when it sits under it, otherwise normalized as given. */
function pathKeyOf(path: string, root: string | undefined): string {
  const normalized = path.replaceAll("\\", "/")
  const rootKey = root?.replaceAll("\\", "/").replace(/\/+$/, "")
  if (rootKey !== undefined && rootKey !== "" && normalized.startsWith(rootKey + "/")) {
    return normalized.slice(rootKey.length + 1)
  }
  return normalized.replace(/^\.\//, "")
}

const toolScanCache = new Map<string, { key: string; value: ToolScan }>()
/** Stable message objects skip the part walk; host updates mutate these objects in place. */
const toolScanSettled = new WeakMap<
  SessionMessageInfo,
  { created: number; workspace: string | undefined; snapshot: string; value: ToolScan }
>()
// shortcut: completed tool states are treated as immutable; a late background result must change status/times to refresh the cache.

function toolScanKeyOf(message: Extract<SessionMessageInfo, { type: "assistant" }>, workspace: string | undefined): { key: string; stable: boolean } {
  let key = `${workspace ?? ""}|${message.id}|${message.time.completed ?? 0}|${message.content.length}|${snapshotKeyOf(message)}`
  let stable = message.time.completed !== undefined
  for (const part of message.content) {
    if (part.type !== "tool") {
      key += `|${part.type}`
      continue
    }
    const state = part.state as unknown as JsonRecord
    key += `|${part.id}:${part.name}:${part.time.created}:${part.time.ran ?? 0}:${part.time.completed ?? 0}:${String(state.status ?? "")}`
    if (part.time.completed === undefined) stable = false
  }
  return { key, stable }
}

/** The step's changed-file list, which also covers writes no file tool reported, e.g. a shell command's output. */
function snapshotKeyOf(message: Extract<SessionMessageInfo, { type: "assistant" }>): string {
  return message.snapshot?.files?.join("|") ?? ""
}

/** Commands and file activity for one assistant message, cached once its tools have settled. */
function toolScanOfMessage(message: Extract<SessionMessageInfo, { type: "assistant" }>, workspace?: string): ToolScan {
  const commands: CommandRow[] = []
  const files: FileOpRow[] = []
    for (const part of message.content) {
      if (part.type !== "tool") continue
      const state = part.state as unknown as JsonRecord
      const input = objectOf(state.input) ?? {}
      const metadata = objectOf(state.metadata)
      const name = baseToolName(part.name)

      if (COMMAND_TOOLS.has(name)) {
        const exit = numberOf(metadata?.exit)
        const ran = part.time.ran ?? part.time.created
        commands.push(
          commandRowOf({
            id: part.id,
            messageID: message.id,
            at: ran,
            tool: name,
            command: String(input.command ?? ""),
            description: stringOf(input.description),
            workdir: stringOf(input.workdir),
            background: input.background === true || metadata?.shellID !== undefined,
            timeoutMs: numberOf(input.timeout),
            status: commandStatusOf(state, exit),
            exit,
            duration: part.time.completed === undefined ? undefined : Math.max(0, part.time.completed - ran),
            truncated: metadata?.truncated === true,
            output: contentText(state.content),
            workspace,
          }),
        )
      }

      const { status } = statusOf(state)
      if (name === "read") {
        const path = stringOf(input.path)
        if (path) {
          const range = /lines (\d+)-(\d+)/.exec(contentText(state.content))
          const lines = range ? Number(range[2]) - Number(range[1]) + 1 : numberOf(input.limit)
          files.push(fileOpOf(part.id, message.id, part.time.created, "read", path, name, status, { lines }))
        }
      } else if (name === "write") {
        const path = stringOf(input.path)
        if (path) {
          files.push(
            fileOpOf(part.id, message.id, part.time.created, "write", path, name, status, {
              additions: lineCount(String(input.content ?? "")),
            }),
          )
        }
      } else if (name === "edit") {
        const editFiles = metadata?.files
        if (Array.isArray(editFiles) && editFiles.length > 0) {
          editFiles.forEach((raw, index) => {
            const file = objectOf(raw)
            const path = stringOf(file?.file)
            if (!path) return
            files.push(
              fileOpOf(`${part.id}:${index}`, message.id, part.time.created, "write", path, name, stringOf(file?.status) ?? status, {
                additions: numberOf(file?.additions) ?? 0,
                deletions: numberOf(file?.deletions) ?? 0,
              }),
            )
          })
        } else {
          const path = stringOf(input.path)
          if (path) {
            files.push(
              fileOpOf(part.id, message.id, part.time.created, "write", path, name, status, {
                additions: lineCount(String(input.newString ?? "")),
                deletions: lineCount(String(input.oldString ?? "")),
              }),
            )
          }
        }
      } else if (name === "grep" || name === "glob") {
        const path = stringOf(input.path) ?? stringOf(input.pattern) ?? name
        files.push(
          fileOpOf(part.id, message.id, part.time.created, "search", path, name, status, {
            hits: numberOf(metadata?.matches),
            detail: stringOf(input.pattern) ?? stringOf(input.include),
          }),
        )
      }

      if (name !== "execute") continue
      const calls = metadata?.toolCalls
      if (!Array.isArray(calls)) continue
      calls.forEach((raw, index) => {
        const call = objectOf(raw)
        if (!call) return
        const nested = baseToolName(String(call.tool ?? ""))
        const nestedInput = objectOf(call.input) ?? {}
        const nestedStatus = stringOf(call.status) ?? "unknown"
        if (COMMAND_TOOLS.has(nested)) {
          commands.push(
            commandRowOf({
              id: `${part.id}:${index}`,
              messageID: message.id,
              at: part.time.created,
              tool: nested,
              nested: true,
              command: String(nestedInput.command ?? ""),
              description: stringOf(nestedInput.description),
              workdir: stringOf(nestedInput.workdir),
              background: nestedInput.background === true,
              timeoutMs: numberOf(nestedInput.timeout),
              status:
                nestedStatus === "running"
                  ? "running"
                  : nestedStatus === "completed"
                    ? "completed"
                    : nestedStatus === "unknown"
                      ? "completed"
                      : "failed",
              workspace,
            }),
          )
        }
        const id = `${part.id}:${index}`
        if (nested === "read") {
          const path = stringOf(nestedInput.path)
          if (path) files.push(fileOpOf(id, message.id, part.time.created, "read", path, nested, nestedStatus, { lines: numberOf(nestedInput.limit) }))
        } else if (nested === "write") {
          const path = stringOf(nestedInput.path)
          if (path) files.push(fileOpOf(id, message.id, part.time.created, "write", path, nested, nestedStatus, { additions: lineCount(String(nestedInput.content ?? "")) }))
        } else if (nested === "edit") {
          const path = stringOf(nestedInput.path)
          if (path)
            files.push(
              fileOpOf(id, message.id, part.time.created, "write", path, nested, nestedStatus, {
                additions: lineCount(String(nestedInput.newString ?? "")),
                deletions: lineCount(String(nestedInput.oldString ?? "")),
              }),
            )
        } else if (nested === "grep" || nested === "glob") {
          const path = stringOf(nestedInput.path) ?? stringOf(nestedInput.pattern) ?? nested
          files.push(fileOpOf(id, message.id, part.time.created, "search", path, nested, nestedStatus, { detail: stringOf(nestedInput.pattern) }))
        }
      })
    }
  // The step snapshot also lists writes no file tool reported, e.g. a shell command's output file.
  const changed = message.snapshot?.files
  if (changed !== undefined && changed.length > 0) {
    const seen = new Set(files.filter((row) => row.kind === "write").map((row) => pathKeyOf(row.path, workspace)))
    for (const path of changed) {
      const key = pathKeyOf(path, workspace)
      if (seen.has(key)) continue
      seen.add(key)
      files.push(
        fileOpOf(`${message.id}:snapshot:${key}`, message.id, message.time.completed ?? message.time.created, "write", path, "snapshot", "completed"),
      )
    }
  }
  return { commands, files }
}

/** One message's commands and files, reused without a part walk once its tools have settled. */
export function cachedToolScanOf(message: SessionMessageInfo, workspace: string | undefined): ToolScan {
  if (message.type !== "assistant") return { commands: [], files: [] }
  const snapshot = snapshotKeyOf(message)
  const settled = toolScanSettled.get(message)
  if (
    settled !== undefined &&
    settled.created === message.time.created &&
    settled.workspace === workspace &&
    settled.snapshot === snapshot &&
    message.time.completed !== undefined
  ) {
    return settled.value
  }
  const { key, stable } = toolScanKeyOf(message, workspace)
  const cached = toolScanCache.get(message.id)
  if (cached !== undefined && cached.key === key) {
    if (stable) {
      toolScanSettled.set(message, { created: message.time.created, workspace, snapshot, value: cached.value })
    }
    return cached.value
  }
  const value = toolScanOfMessage(message, workspace)
  if (stable) {
    toolScanCache.set(message.id, { key, value })
    toolScanSettled.set(message, { created: message.time.created, workspace, snapshot, value })
    if (toolScanCache.size > 2048) {
      const oldest = toolScanCache.keys().next().value as string
      toolScanCache.delete(oldest)
    }
  }
  return value
}

export function buildToolScan(messages: readonly SessionMessageInfo[], workspace?: string): ToolScan {
  const commands: CommandRow[] = []
  const files: FileOpRow[] = []
  for (const message of messages) {
    if (message.type !== "assistant") continue
    const entry = cachedToolScanOf(message, workspace)
    for (const row of entry.commands) commands.push(row)
    for (const row of entry.files) files.push(row)
  }
  return { commands, files }
}

export function buildFileOps(messages: readonly SessionMessageInfo[]): FileOpRow[] {
  return buildToolScan(messages).files
}

export function groupFileOps(ops: readonly FileOpRow[], root?: string): FileRow[] {
  const files = new Map<string, { reads: number; writes: number; searches: number; additions: number; deletions: number; ops: FileOpRow[] }>()
  for (const op of ops) {
    const key = pathKeyOf(op.path, root)
    const entry = files.get(key) ?? { reads: 0, writes: 0, searches: 0, additions: 0, deletions: 0, ops: [] }
    if (op.kind === "read") entry.reads += 1
    else if (op.kind === "write") entry.writes += 1
    else entry.searches += 1
    entry.additions += op.additions
    entry.deletions += op.deletions
    entry.ops.push(op)
    files.set(key, entry)
  }
  return [...files.entries()]
    .map(([path, entry]) => ({ path, ...entry, ops: [...entry.ops].sort((left, right) => right.at - left.at) }))
    .sort(
      (left, right) =>
        right.writes - left.writes ||
        right.additions + right.deletions - (left.additions + left.deletions) ||
        right.reads - left.reads ||
        left.path.localeCompare(right.path),
    )
}

