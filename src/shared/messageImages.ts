import type { SessionMessageInfo } from "@opencode/client"
import { fileTokensOf, imageTokensOf, isImageMime } from "./imageTokens.ts"
import { imageSizeOf } from "./media.ts"

/** Attachment rows on a message carry base64 data; the size may come from the bytes or the row. */
interface AttachmentLike {
  readonly name?: string
  readonly mime?: string
  readonly data?: string
  readonly width?: number
  readonly height?: number
}

function sizeOf(attachment: AttachmentLike): { width: number; height: number } | undefined {
  if (typeof attachment.width === "number" && typeof attachment.height === "number") {
    return attachment.width > 0 && attachment.height > 0
      ? { width: attachment.width, height: attachment.height }
      : undefined
  }
  return imageSizeOf(attachment.data, attachment.mime)
}

function bytesOfBase64(data: string): number {
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1
  const payload = comma >= 0 ? data.slice(comma + 1) : data
  if (payload === "") return 0
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0
  return Math.max(0, Math.floor((payload.length * 3) / 4) - padding)
}

function filesOf(message: SessionMessageInfo): readonly unknown[] {
  const files = (message as unknown as { readonly files?: readonly unknown[] }).files
  return Array.isArray(files) ? files : []
}

/**
 * Tokens for a message's image attachments, from their pixel size rather than
 * their base64 length. Text-only messages return zero.
 */
export function imageTokensOfMessage(message: SessionMessageInfo): { readonly tokens: number; readonly count: number } {
  let tokens = 0
  let count = 0
  for (const raw of filesOf(message)) {
    if (typeof raw !== "object" || raw === null) continue
    const file = raw as AttachmentLike
    if (!isImageMime(file.mime)) continue
    const size = sizeOf(file)
    tokens += size === undefined ? imageTokensOf({ width: 1024, height: 1024 }) : imageTokensOf(size)
    count += 1
  }
  return { tokens, count }
}

/**
 * Tokens for every attachment on a message: images use the pixel grid, other
 * files use their identity because their contents are not inlined.
 */
export function attachmentTokensOfMessage(message: SessionMessageInfo): number {
  let tokens = 0
  for (const raw of filesOf(message)) {
    if (typeof raw !== "object" || raw === null) continue
    const file = raw as AttachmentLike
    if (isImageMime(file.mime)) {
      const size = sizeOf(file)
      tokens += size === undefined ? imageTokensOf({ width: 1024, height: 1024 }) : imageTokensOf(size)
    } else {
      tokens += fileTokensOf({
        name: file.name,
        mime: file.mime,
        bytes: file.data === undefined ? undefined : bytesOfBase64(file.data),
      })
    }
  }
  return tokens
}
