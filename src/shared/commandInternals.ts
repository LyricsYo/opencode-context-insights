import type { CommandRow, CommandStatus } from "./commands.ts"
import { lineCount, numberOf, objectOf, stringOf, type JsonRecord } from "./reportInternal.ts"

export const COMMAND_TOOLS = new Set(["shell", "bash", "sh", "terminal", "exec"])
const COMMAND_WRAPPERS = new Set(["env", "sudo", "doas", "command", "exec", "time", "nohup", "nice", "stdbuf", "timeout"])
const SHELL_HEADS = new Set([
  "[",
  "[[",
  "for",
  "if",
  "while",
  "until",
  "case",
  "do",
  "then",
  "else",
  "elif",
  "function",
  "select",
  "coproc",
  "done",
  "fi",
  "esac",
  "export",
  "local",
  "declare",
  "readonly",
  "typeset",
])
const NAVIGATION = /^(?:cd|pushd|popd|set-location|sl)$/i

function normalizeProgram(word: string): string {
  let name = word.trim().replace(/^["']|["']$/g, "")
  const cut = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"))
  if (cut >= 0) name = name.slice(cut + 1)
  if (/\.(?:exe|cmd|bat)$/i.test(name)) name = name.replace(/\.(?:exe|cmd|bat)$/i, "")
  return name.trim()
}

function firstLineOf(text: string): string {
  const cut = text.search(/\r?\n/)
  return (cut < 0 ? text : text.slice(0, cut)).trim()
}

/** Splits on `&&`, `||`, `|`, `;` and newlines, ignoring separators inside quotes. */
function commandSegments(command: string): string[] {
  const segments: string[] = []
  let start = 0
  let quote = ""
  for (let index = 0; index < command.length; index++) {
    const char = command[index]
    if (quote !== "") {
      if (char === "\\" && quote === '"') index++
      else if (char === quote) quote = ""
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (char === "\n" || char === ";") {
      segments.push(command.slice(start, index))
      start = index + 1
      continue
    }
    if (char === "&" && command[index + 1] === "&") {
      segments.push(command.slice(start, index))
      index++
      start = index + 1
      continue
    }
    if (char === "|") {
      segments.push(command.slice(start, index))
      if (command[index + 1] === "|" || command[index + 1] === "&") index++
      start = index + 1
      continue
    }
    if (char === "&") {
      const previous = command[index - 1]
      const next = command[index + 1]
      if (previous === ">" || next === ">") continue
      segments.push(command.slice(start, index))
      start = index + 1
    }
  }
  segments.push(command.slice(start))
  return segments.map((segment) => segment.trim()).filter((segment) => segment !== "")
}

/** Head program of one segment: skips assignments, wrappers and their flags. */
function commandHead(segment: string): string {
  let rest = segment.trim()
  if (rest.startsWith("@'") || rest.startsWith('@"')) return ""
  for (let guard = 0; guard < 8 && rest !== ""; guard++) {
    const word = /^[^\s;|&]+/.exec(rest)?.[0] ?? ""
    const redirect = /^(?:&>>?|\d*[<>])/.exec(word)
    if (redirect !== null) {
      rest = rest.slice(redirect[0].length).trimStart()
      const target = /^[^\s;|&]+/.exec(rest)?.[0]
      if (target !== undefined && !/^(?:&>>?|\d*[<>])/.test(target)) rest = rest.slice(target.length).trimStart()
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*\+?=/.test(word)) {
      rest = rest.slice(word.length).trimStart()
      continue
    }
    const name = normalizeProgram(word)
    if (!COMMAND_WRAPPERS.has(name)) return SHELL_HEADS.has(name.toLowerCase()) ? "shell" : name
    rest = rest.slice(word.length).trimStart()
    for (let flags = 0; flags < 8; flags++) {
      const flag = /^--?[^\s]+/.exec(rest)?.[0]
      if (flag === undefined) break
      rest = rest.slice(flag.length).trimStart()
      if (/^(?:-u|-g|-n|-t|-o|-s|-C|-k|-i|-e)$/.test(flag)) {
        const value = /^[^\s;|&]+/.exec(rest)?.[0]
        if (value !== undefined) rest = rest.slice(value.length).trimStart()
      }
    }
    if (name === "timeout") {
      const duration = /^[^\s;|&]+/.exec(rest)?.[0]
      if (duration !== undefined) rest = rest.slice(duration.length).trimStart()
    }
  }
  return "shell"
}

function commandPrograms(command: string): string[] {
  const names: string[] = []
  const add = (name: string): void => {
    if (name === "" || name === "shell" || NAVIGATION.test(name)) return
    if (!names.includes(name)) names.push(name)
  }
  add(commandHead(command))
  for (const segment of commandSegments(command)) add(commandHead(segment))
  return names.length > 0 ? names : [commandHead(command) || "shell"]
}

function commandPreview(command: string, workspace: string | undefined): string {
  const root = workspace?.replaceAll("\\", "/").replace(/\/+$/, "")
  let text = command
  const match = /^\s*(?:cd|set-location|sl)\s+("[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/i.exec(text)
  if (match !== null) {
    const target = match[1].replace(/^["']|["']$/g, "").replaceAll("\\", "/").replace(/\/+$/, "")
    if (root === undefined || root === "" || target === root) text = text.slice(match[0].length)
  }
  return firstLineOf(text)
}

function commandShape(command: string): { lines: number; heredoc: boolean; inline: boolean } {
  let lines = 1
  for (const char of command) if (char === "\n") lines++
  return {
    lines,
    heredoc: /<<-?\s*['"]?\w/.test(command),
    inline: /(?:^|[|;&]\s*)(?:node|deno|bun|python3?|ruby|perl|php)\s+(?:[^\n|;&]*\s)?-[ec]\s/.test(command),
  }
}

export function commandStatusOf(state: JsonRecord, exit: number | undefined): CommandStatus {
  const raw = stringOf(state.status) ?? "unknown"
  if (raw === "running") return "running"
  if (raw === "error" || raw === "failed") return "failed"
  if (exit !== undefined && exit !== 0) return "failed"
  return "completed"
}

export function statusOf(state: JsonRecord): { status: string; exit?: number } {
  const metadata = objectOf(state.metadata)
  const status = stringOf(metadata?.status) ?? (state.status === "error" ? "failed" : String(state.status ?? "unknown"))
  return { status, exit: numberOf(metadata?.exit) }
}

export function commandRowOf(input: {
  id: string
  messageID: string
  at: number
  tool: string
  nested?: boolean
  command: string
  description?: string
  workdir?: string
  background?: boolean
  timeoutMs?: number
  status: CommandStatus
  exit?: number
  duration?: number
  truncated?: boolean
  output?: string
  workspace?: string
}): CommandRow {
  const command = input.command
  const shape = commandShape(command)
  const programs = commandPrograms(command)
  const output = input.output ?? ""
  return {
    id: input.id,
    messageID: input.messageID,
    at: input.at,
    command,
    preview: commandPreview(command, input.workspace),
    description: input.description,
    workdir: input.workdir,
    tool: input.tool,
    nested: input.nested === true,
    status: input.status,
    exit: input.exit,
    duration: input.duration,
    background: input.background === true,
    truncated: input.truncated === true,
    timeoutMs: input.timeoutMs,
    program: programs[0],
    programs,
    lines: shape.lines,
    heredoc: shape.heredoc,
    inline: shape.inline,
    output,
    outChars: output.length,
    outLines: lineCount(output),
  }
}

