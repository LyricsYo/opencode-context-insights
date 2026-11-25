

/**
 * Image dimensions from the first bytes of an encoded image.
 *
 * The request payload carries the pixels but not the size, and the token
 * estimate depends on the size, not on the encoded byte count.
 */

export interface ImageSize {
  readonly width: number
  readonly height: number
}

const HEAD_BYTES = 1024

function headOf(data: string | Uint8Array, bytes = HEAD_BYTES): Uint8Array | undefined {
  if (data instanceof Uint8Array) return data.subarray(0, bytes)
  const comma = data.startsWith("data:") ? data.indexOf(",") : -1
  const payload = comma >= 0 ? data.slice(comma + 1) : data
  const take = Math.min(payload.length, Math.ceil(bytes / 3) * 4)
  const chunk = payload.slice(0, take - (take % 4))
  try {
    const binary = atob(chunk)
    const out = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) out[index] = binary.charCodeAt(index)
    return out
  } catch {
    return undefined
  }
}

const be16 = (bytes: Uint8Array, at: number) => (bytes[at] << 8) | bytes[at + 1]
const be32 = (bytes: Uint8Array, at: number) =>
  ((bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]) >>> 0
const le16 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8)
const le24 = (bytes: Uint8Array, at: number) => bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16)

function pngSize(bytes: Uint8Array): ImageSize | undefined {
  if (bytes.length < 24) return undefined
  if (bytes[0] !== 0x89 || bytes[1] !== 0x50 || bytes[2] !== 0x4e || bytes[3] !== 0x47) return undefined
  const width = be32(bytes, 16)
  const height = be32(bytes, 20)
  return width > 0 && height > 0 ? { width, height } : undefined
}

function gifSize(bytes: Uint8Array): ImageSize | undefined {
  const signature = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5])
  if (signature !== "GIF87a" && signature !== "GIF89a") return undefined
  const width = le16(bytes, 6)
  const height = le16(bytes, 8)
  return width > 0 && height > 0 ? { width, height } : undefined
}

/** JPEG stores the frame size in a SOFn segment whose offset depends on the preceding segments. */
function jpegSize(bytes: Uint8Array): ImageSize | undefined {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined
  let at = 2
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1
      continue
    }
    const marker = bytes[at + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2
      continue
    }
    const length = be16(bytes, at + 2)
    if (length < 2) return undefined
    const isFrame =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    if (isFrame) {
      const height = be16(bytes, at + 5)
      const width = be16(bytes, at + 7)
      return width > 0 && height > 0 ? { width, height } : undefined
    }
    at += 2 + length
  }
  return undefined
}

function webpSize(bytes: Uint8Array): ImageSize | undefined {
  if (bytes.length < 30) return undefined
  const riff = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  const webp = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])
  if (riff !== "RIFF" || webp !== "WEBP") return undefined
  const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15])
  if (chunk === "VP8 ") {
    const width = le16(bytes, 26) & 0x3fff
    const height = le16(bytes, 28) & 0x3fff
    return width > 0 && height > 0 ? { width, height } : undefined
  }
  if (chunk === "VP8L") {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1
    return { width, height }
  }
  if (chunk === "VP8X") {
    const width = le24(bytes, 24) + 1
    const height = le24(bytes, 27) + 1
    return { width, height }
  }
  return undefined
}

export function imageSizeOf(data: string | Uint8Array | undefined, mime?: string): ImageSize | undefined {
  if (data === undefined) return undefined
  const bytes = headOf(data)
  if (bytes === undefined || bytes.length < 10) return undefined
  if (mime === undefined || mime.includes("png")) {
    const size = pngSize(bytes)
    if (size !== undefined) return size
  }
  if (mime === undefined || mime.includes("gif")) {
    const size = gifSize(bytes)
    if (size !== undefined) return size
  }
  if (mime === undefined || mime.includes("jpeg") || mime.includes("jpg")) {
    const size = jpegSize(bytes)
    if (size !== undefined) return size
  }
  if (mime === undefined || mime.includes("webp")) {
    const size = webpSize(bytes)
    if (size !== undefined) return size
  }
  return undefined
}
