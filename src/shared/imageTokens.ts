import { imageSizeOf } from "./media.ts"

/** Provider convention: a 14px patch, downsampled 3x, so one grid cell covers 42px. */
const CELL = 42
const MAX_IMAGE_TOKENS = 1024
/** Small images are padded to this area before the grid is counted. */
const MIN_PIXELS = 544 * 544

interface ImageSize {
  readonly width: number
  readonly height: number
}

const gridCells = (pixels: number) => Math.max(1, Math.ceil(pixels / CELL))
/** One cell per row plus one sentinel cell per row, plus the two global cells. */
const gridTokens = (gridHeight: number, gridWidth: number) => gridHeight * (gridWidth + 1) + 2

/** Small images are padded up to the minimum area, keeping the aspect ratio. */
function padded(size: ImageSize): ImageSize {
  const area = size.width * size.height
  if (area >= MIN_PIXELS) return size
  const scale = Math.sqrt(MIN_PIXELS / area)
  return { width: Math.max(1, Math.round(size.width * scale)), height: Math.max(1, Math.round(size.height * scale)) }
}

function solve(size: ImageSize, budget: number): ImageSize {
  const aspect = size.height / size.width
  const idealWidth = Math.sqrt((budget - 2) / aspect + 0.25) - 0.5
  if (idealWidth >= 1) {
    const gridWidth = Math.max(1, Math.trunc(idealWidth))
    const gridHeight = Math.max(1, Math.trunc((budget - 2) / (gridWidth + 1)))
    return { width: gridWidth * CELL, height: gridHeight * CELL }
  }
  return { width: CELL, height: Math.max(CELL, (budget - 2) * CELL) }
}

/** Image tokens from the pixel grid, capped per image. */
export function imageTokensOf(size: ImageSize): number {
  const scaled = padded(size)
  const direct = gridTokens(gridCells(scaled.height), gridCells(scaled.width))
  if (direct <= MAX_IMAGE_TOKENS) return direct
  const fitted = solve(size, MAX_IMAGE_TOKENS)
  return Math.min(MAX_IMAGE_TOKENS, gridTokens(gridCells(fitted.height), gridCells(fitted.width)))
}

/**
 * Tokens for an image attachment. Uses the decoded pixel size when the bytes
 * expose it; otherwise a fixed cost, never the encoded byte count.
 */
export function imageTokensFor(data: string | Uint8Array | undefined, mime: string | undefined): number {
  const size = imageSizeOf(data, mime)
  return size === undefined ? MAX_IMAGE_TOKENS : imageTokensOf(size)
}

const TEXTUAL = /^(?:text\/|application\/(?:json|xml|yaml|x-yaml|javascript|typescript|pdf))/

/** Non-image attachments are summarised by identity, not by their base64 payload. */
export function fileTokensOf(file: {
  readonly name?: string
  readonly bytes?: number
  readonly mime?: string
}): number {
  const name = file.name ?? "file"
  const mime = file.mime ?? "application/octet-stream"
  const bytes = file.bytes
  const identity =
    bytes === undefined ? `${mime} ${JSON.stringify(name)}` : `${mime} ${JSON.stringify(name)} (${bytes} bytes)`
  const handle = `[File ${identity} is attached; its contents are not inlined in this request.]`
  return Math.max(8, Math.ceil(handle.length / 4))
}

export function isImageMime(mime: string | undefined): boolean {
  return mime !== undefined && mime.startsWith("image/")
}

export function isTextualMime(mime: string | undefined): boolean {
  return mime !== undefined && TEXTUAL.test(mime)
}

export const IMAGE_TOKEN_CAP = MAX_IMAGE_TOKENS
