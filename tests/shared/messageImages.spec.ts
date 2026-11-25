import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { attachmentTokensOfMessage, imageTokensOfMessage } from "../../src/shared/messageImages.ts"
import { fileTokensOf, imageTokensOf } from "../../src/shared/imageTokens.ts"

const FALLBACK = imageTokensOf({ width: 1024, height: 1024 })

const png = (width: number, height: number): string => {
  const head = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0)
  head.writeUInt32BE(13, 8)
  Buffer.from("IHDR").copy(head, 12)
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return head.toString("base64")
}

const message = (files: unknown): SessionMessageInfo => ({ id: "m1", type: "user", text: "look", files }) as unknown as SessionMessageInfo

describe("imageTokensOfMessage", () => {
  test("returns zero for messages without a file list", () => {
    assert.deepEqual(imageTokensOfMessage(message(undefined)), { tokens: 0, count: 0 })
    assert.deepEqual(imageTokensOfMessage(message([])), { tokens: 0, count: 0 })
    assert.deepEqual(imageTokensOfMessage(message("nope")), { tokens: 0, count: 0 })
    assert.deepEqual(imageTokensOfMessage(message([null])), { tokens: 0, count: 0 })
  })

  test("uses attachment dimensions when both are positive", () => {
    const result = imageTokensOfMessage(message([{ mime: "image/png", width: 1920, height: 1080 }]))
    assert.equal(result.count, 1)
    assert.ok(result.tokens > 0 && result.tokens <= 1024)
  })

  test("ignores non-image and text attachments", () => {
    const result = imageTokensOfMessage(
      message([
        { mime: "application/pdf", width: 10, height: 10 },
        { mime: "text/plain", data: "aGk=" },
        { mime: "image/png", width: 0, height: 10 },
      ]),
    )
    assert.deepEqual(result, { tokens: FALLBACK, count: 1 })
  })

  test("reads the pixel size from the bytes when dimensions are absent", () => {
    const result = imageTokensOfMessage(message([{ mime: "image/png", data: png(1280, 720) }]))
    assert.equal(result.count, 1)
    assert.ok(result.tokens > 300)
  })

  test("falls back to the cap for unreadable image bytes", () => {
    const result = imageTokensOfMessage(message([{ mime: "image/png", data: "not base64" }]))
    assert.deepEqual(result, { tokens: FALLBACK, count: 1 })
  })

  test("sums multiple images", () => {
    const result = imageTokensOfMessage(
      message([
        { mime: "image/png", width: 100, height: 100 },
        { mime: "image/jpeg", width: 200, height: 200 },
      ]),
    )
    assert.equal(result.count, 2)
    assert.ok(result.tokens >= 2)
  })
})

describe("attachmentTokensOfMessage", () => {
  test("counts images and file identities together", () => {
    const image = imageTokensOf({ width: 100, height: 100 })
    const pdf = fileTokensOf({ name: "a.pdf", mime: "application/pdf", bytes: 2 })
    const text = fileTokensOf({ name: "b.txt", mime: "text/plain" })
    const dataUrl = fileTokensOf({ name: "c.pdf", mime: "application/pdf", bytes: 2 })
    const empty = fileTokensOf({ name: "d.pdf", mime: "application/pdf", bytes: 0 })
    const padded = fileTokensOf({ name: "e.pdf", mime: "application/pdf", bytes: 1 })
    const unpadded = fileTokensOf({ name: "f.pdf", mime: "application/pdf", bytes: 3 })
    const tokens = attachmentTokensOfMessage(
      message([
        { mime: "image/png", width: 100, height: 100 },
        { name: "a.pdf", mime: "application/pdf", data: "aGk=" },
        { name: "b.txt", mime: "text/plain" },
        { mime: "image/png", data: "not base64" },
        { name: "c.pdf", mime: "application/pdf", data: "data:application/pdf;base64,aGk=" },
        { name: "d.pdf", mime: "application/pdf", data: "data:," },
        { name: "e.pdf", mime: "application/pdf", data: "aGk==" },
        { name: "f.pdf", mime: "application/pdf", data: "aGk" },
      ]),
    )
    assert.equal(tokens, image + pdf + text + FALLBACK + dataUrl + empty + padded + unpadded)
  })

  test("returns zero for messages without a file list", () => {
    assert.equal(attachmentTokensOfMessage(message(undefined)), 0)
    assert.equal(attachmentTokensOfMessage(message([])), 0)
    assert.equal(attachmentTokensOfMessage(message("nope")), 0)
    assert.equal(attachmentTokensOfMessage(message([null, 3])), 0)
  })
})
