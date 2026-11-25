import assert from "node:assert/strict"
import { describe, test } from "vitest"
import {
  IMAGE_TOKEN_CAP,
  fileTokensOf,
  imageTokensFor,
  imageTokensOf,
  isImageMime,
  isTextualMime,
} from "../../src/shared/imageTokens.ts"

const png = (width: number, height: number): string => {
  const head = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0)
  head.writeUInt32BE(13, 8)
  Buffer.from("IHDR").copy(head, 12)
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return head.toString("base64")
}

describe("imageTokensOf", () => {
  test("pads small images to the minimum area", () => {
    const small = imageTokensOf({ width: 100, height: 100 })
    assert.ok(small > 0)
    assert.ok(small < imageTokensOf({ width: 544, height: 544 }) + 10)
  })

  test("caps large images", () => {
    assert.ok(imageTokensOf({ width: 1920, height: 1080 }) <= IMAGE_TOKEN_CAP)
    assert.ok(imageTokensOf({ width: 4000, height: 3000 }) <= IMAGE_TOKEN_CAP)
    assert.equal(imageTokensOf({ width: 4000, height: 3000 }), 1001)
  })

  test("fits an extreme aspect ratio into the token budget", () => {
    const tokens = imageTokensOf({ width: 1, height: 100_000 })
    assert.ok(tokens > 0)
    assert.ok(tokens <= IMAGE_TOKEN_CAP)
  })

  test("keeps a one-pixel image positive", () => {
    assert.ok(imageTokensOf({ width: 1, height: 1 }) >= 3)
  })
})

describe("imageTokensFor", () => {
  test("uses the decoded size when the bytes expose it", () => {
    assert.equal(imageTokensFor(png(1280, 720), "image/png"), imageTokensOf({ width: 1280, height: 720 }))
  })

  test("falls back to the cap without a readable header", () => {
    assert.equal(imageTokensFor(undefined, "image/png"), IMAGE_TOKEN_CAP)
    assert.equal(imageTokensFor("garbage", "image/png"), IMAGE_TOKEN_CAP)
  })
})

describe("fileTokensOf", () => {
  test("counts the identity handle, not the payload", () => {
    const withBytes = fileTokensOf({ name: "a.pdf", mime: "application/pdf", bytes: 2048 })
    const without = fileTokensOf({ name: "a.pdf", mime: "application/pdf" })
    assert.ok(withBytes >= 8)
    assert.ok(without >= 8)
    assert.ok(withBytes >= without)
  })

  test("fills in neutral defaults", () => {
    const tokens = fileTokensOf({})
    assert.ok(tokens >= 8)
  })
})

describe("mime checks", () => {
  test("recognises images only with the image prefix", () => {
    assert.equal(isImageMime("image/png"), true)
    assert.equal(isImageMime("text/plain"), false)
    assert.equal(isImageMime(undefined), false)
  })

  test("recognises textual and document mimes", () => {
    assert.equal(isTextualMime("text/markdown"), true)
    assert.equal(isTextualMime("application/json"), true)
    assert.equal(isTextualMime("application/pdf"), true)
    assert.equal(isTextualMime("application/octet-stream"), false)
    assert.equal(isTextualMime(undefined), false)
  })
})
