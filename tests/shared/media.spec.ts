import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { compose } from "../../src/shared/estimate.ts"
import { imageTokensOf } from "../../src/shared/imageTokens.ts"
import { imageSizeOf } from "../../src/shared/media.ts"

const png = (width: number, height: number): string => {
  const head = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0)
  head.writeUInt32BE(13, 8)
  Buffer.from("IHDR").copy(head, 12)
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return head.toString("base64")
}

const gif = (width: number, height: number): string => {
  const head = Buffer.alloc(13)
  head.write("GIF89a", 0, "ascii")
  head.writeUInt16LE(width, 6)
  head.writeUInt16LE(height, 8)
  return head.toString("base64")
}

const image = (width: number, height: number, mime = "image/png") => ({
  type: "media",
  media: { type: "image", source: { type: "base64", data: png(width, height), mediaType: mime } },
})

test("image size is read from PNG and GIF headers", () => {
  assert.deepEqual(imageSizeOf(png(1920, 1080), "image/png"), { width: 1920, height: 1080 })
  assert.deepEqual(imageSizeOf(gif(320, 200), "image/gif"), { width: 320, height: 200 })
  assert.equal(imageSizeOf("not base64 at all", "image/png"), undefined)
})

test("image tokens follow the pixel grid and stay capped", () => {
  const small = imageTokensOf({ width: 100, height: 100 })
  const large = imageTokensOf({ width: 1920, height: 1080 })
  const huge = imageTokensOf({ width: 4000, height: 3000 })
  assert.ok(small > 0 && small < large)
  assert.ok(large < 1024)
  assert.ok(huge <= 1024)
})

test("a screenshot no longer costs its base64 length", () => {
  const result = compose({
    system: [],
    tools: {},
    messages: [{ role: "user", content: [image(1920, 1080)] }],
  })
  assert.ok(result.total < 1200, `expected under 1200 tokens, got ${result.total}`)
  assert.equal(result.byCategory.user, result.total)
})

test("text next to an image no longer drops the image", () => {
  const result = compose({
    system: [],
    tools: {},
    messages: [{ role: "user", content: [{ type: "text", text: "describe this" }, image(1280, 720)] }],
  })
  assert.ok(result.total > 300, `expected the image to count, got ${result.total}`)
  assert.equal(
    result.items.some((item) => item.name === "Image"),
    true,
  )
})

test("a base64 payload without a readable header falls back to the cap", () => {
  const result = compose({
    system: [],
    tools: {},
    messages: [{ role: "user", content: [{ type: "file", mime: "image/png", name: "shot.png", data: "A".repeat(400_000) }] }],
  })
  assert.ok(result.total <= 1100, `expected the image cap, got ${result.total}`)
})

const jpeg = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(19)
  Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x11, 0x08,
  ]).copy(bytes, 0)
  bytes.writeUInt16BE(height, 13)
  bytes.writeUInt16BE(width, 15)
  return bytes
}

const gifBytes = (width: number, height: number, signature = "GIF89a"): Buffer => {
  const bytes = Buffer.alloc(13)
  bytes.write(signature, 0, "ascii")
  bytes.writeUInt16LE(width, 6)
  bytes.writeUInt16LE(height, 8)
  return bytes
}

const webp = (chunk: "VP8 " | "VP8L" | "VP8X" | "XXXX", patch: (bytes: Buffer) => void): Buffer => {
  const bytes = Buffer.alloc(32)
  bytes.write("RIFF", 0, "ascii")
  bytes.write("WEBP", 8, "ascii")
  bytes.write(chunk, 12, "ascii")
  patch(bytes)
  return bytes
}

describe("imageSizeOf formats", () => {
  test("reads JPEG frame dimensions after skipping other markers", () => {
    assert.deepEqual(imageSizeOf(jpeg(640, 480), "image/jpg"), { width: 640, height: 480 })
    const bytes = Buffer.from([
      0xff, 0xd8, 0x00, 0xff, 0x01, 0xff, 0xd0, 0xff, 0xd8,
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0xe0, 0x02, 0x80, 0x00,
    ])
    assert.deepEqual(imageSizeOf(bytes, "image/jpeg"), { width: 640, height: 480 })
  })

  test("rejects broken or sizeless JPEGs", () => {
    assert.equal(imageSizeOf(Buffer.from([0xff, 0xd8]), "image/jpeg"), undefined)
    assert.equal(imageSizeOf(Buffer.alloc(19), "image/jpeg"), undefined)
    const badLength = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01, 0, 0, 0, 0, 0, 0])
    assert.equal(imageSizeOf(badLength, "image/jpeg"), undefined)
    const noFrame = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0, 0, 0xff, 0xd9, 0, 0, 0, 0, 0, 0, 0, 0])
    assert.equal(imageSizeOf(noFrame, "image/jpeg"), undefined)
    assert.equal(imageSizeOf(jpeg(0, 480), "image/jpeg"), undefined)
    const skipsPastEnd = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x64, 0, 0, 0, 0, 0, 0])
    assert.equal(imageSizeOf(skipsPastEnd, "image/jpeg"), undefined)
  })

  test("reads the three WebP chunk layouts", () => {
    const vp8 = webp("VP8 ", (bytes) => {
      bytes.writeUInt16LE(320, 26)
      bytes.writeUInt16LE(200, 28)
    })
    assert.deepEqual(imageSizeOf(vp8, "image/webp"), { width: 320, height: 200 })

    const bits = (639 & 0x3fff) | ((359 & 0x3fff) << 14)
    const vp8l = webp("VP8L", (bytes) => bytes.writeInt32LE(bits, 21))
    assert.deepEqual(imageSizeOf(vp8l, "image/webp"), { width: 640, height: 360 })

    const vp8x = webp("VP8X", (bytes) => {
      bytes.writeUIntLE(799, 24, 3)
      bytes.writeUIntLE(499, 27, 3)
    })
    assert.deepEqual(imageSizeOf(vp8x, "image/webp"), { width: 800, height: 500 })
  })

  test("rejects short, mismatched or unknown WebP payloads", () => {
    assert.equal(imageSizeOf(Buffer.alloc(20), "image/webp"), undefined)
    const notRiff = webp("VP8 ", () => {})
    notRiff.write("RIFX", 0, "ascii")
    assert.equal(imageSizeOf(notRiff, "image/webp"), undefined)
    const unknown = webp("XXXX", () => {})
    assert.equal(imageSizeOf(unknown, "image/webp"), undefined)
    const zero = webp("VP8 ", (bytes) => {
      bytes.writeUInt16LE(0, 26)
      bytes.writeUInt16LE(0, 28)
    })
    assert.equal(imageSizeOf(zero, "image/webp"), undefined)
  })

  test("rejects short, wrong-signature or empty GIFs", () => {
    assert.equal(imageSizeOf(Buffer.alloc(8), "image/gif"), undefined)
    assert.equal(imageSizeOf(gifBytes(10, 10, "GIF00a"), "image/gif"), undefined)
    assert.equal(imageSizeOf(gifBytes(0, 10), "image/gif"), undefined)
    assert.deepEqual(imageSizeOf(gifBytes(10, 20, "GIF87a"), "image/gif"), { width: 10, height: 20 })
  })

  test("rejects short, unsignatured or empty PNGs", () => {
    assert.equal(imageSizeOf(Buffer.alloc(20), "image/png"), undefined)
    assert.equal(imageSizeOf(Buffer.alloc(24), "image/png"), undefined)
    assert.equal(imageSizeOf(png(0, 1080), "image/png"), undefined)
  })

  test("accepts bytes, data URLs and any mime, and rejects unusable input", () => {
    assert.deepEqual(imageSizeOf(Buffer.from(png(1920, 1080), "base64")), { width: 1920, height: 1080 })
    assert.deepEqual(imageSizeOf(`data:image/png;base64,${png(800, 600)}`), { width: 800, height: 600 })
    assert.equal(imageSizeOf(undefined), undefined)
    assert.equal(imageSizeOf(""), undefined)
    assert.equal(imageSizeOf("A".repeat(8), "image/png"), undefined)
  })
})
