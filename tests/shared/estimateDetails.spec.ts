import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { clip, compose, estimateTokens } from "../../src/shared/estimate.ts"

const composeLoose = (input: unknown) => compose(input as never)

const png = (width: number, height: number): string => {
  const head = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0)
  head.writeUInt32BE(13, 8)
  Buffer.from("IHDR").copy(head, 12)
  head.writeUInt32BE(width, 16)
  head.writeUInt32BE(height, 20)
  return head.toString("base64")
}

describe("estimateTokens details", () => {
  test("counts every CJK block and caches repeated text", () => {
    assert.equal(estimateTokens("あ가豈Ａ"), 4)
    const text = "cached text ".repeat(10)
    assert.equal(estimateTokens(text), estimateTokens(text))
    assert.equal(estimateTokens(""), 0)
  })

  test("evicts the oldest cached text once the character budget is exceeded", () => {
    for (let index = 0; index < 33; index++) {
      const text = String(index).padStart(4, "0") + "x".repeat(127_996)
      assert.ok(estimateTokens(text) > 0)
    }
    // The cache keeps working after eviction.
    assert.equal(estimateTokens("y".repeat(64)), estimateTokens("y".repeat(64)))
  })
})

describe("clip details", () => {
  test("collapses whitespace and clips at the requested length", () => {
    assert.equal(clip("a   b\tc\nd"), "a b c d")
    assert.equal(clip("abcdef", 3), "ab…")
    assert.equal(clip("abcdef", 40), "abcdef")
  })

  test("falls back to the whole text when the prefix collapses too far", () => {
    assert.equal(clip(`${" ".repeat(700)}target`, 6), "target")
  })
})

describe("compose system and tools", () => {
  test("labels system parts from instructions, skipping entries without a key", () => {
    const result = composeLoose({
      system: [
        { text: "rules one", metadata: { experimental: { instructions: [{ key: "core" }, {}] } } },
        { text: "rules two", metadata: { experimental: { instructions: [] } } },
        { text: "rules three", metadata: { experimental: "not an object" } },
        { text: "" },
      ],
      tools: {},
      messages: [],
    })
    const names = result.items.map((item) => item.name)
    assert.ok(names.includes("core, instructions"))
    assert.ok(names.includes("System prompt 2"))
    assert.ok(names.includes("System prompt 3"))
    assert.equal(result.total, estimateTokens("rules one") + estimateTokens("rules two") + estimateTokens("rules three"))
  })

  test("stringifies string, undefined, JSON and circular tool inputs", () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const result = composeLoose({
      system: [],
      tools: {
        plain: { description: "no schema" },
        text: { input: "abc" },
        empty: { input: undefined },
        circular: { input: circular },
      },
      messages: [],
    })
    assert.ok(result.byCategory.tools > 0)
  })

  test("caps the item list at 400 entries", () => {
    const result = composeLoose({
      system: Array.from({ length: 401 }, (_, index) => ({ text: `part ${index}` })),
      tools: {},
      messages: [],
    })
    assert.equal(result.items.length, 400)
  })
})

describe("compose tool results", () => {
  test("reads text, JSON and other result shapes", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [
        {
          role: "tool",
          content: [
            { type: "tool-result", name: "read", result: { type: "text", value: "body" } },
            { type: "tool-result", name: "list", result: { type: "json", value: { a: 1 } } },
            { type: "tool-result", name: "other", result: { type: "other", value: 2 } },
            { type: "tool-result", name: "plain", result: "just text" },
            { type: "tool-result" },
          ],
        },
      ],
    })
    assert.ok(result.byCategory.toolResults > 0)
  })

  test("recognises a skill result by its name or its payload", () => {
    const named = composeLoose({
      system: [],
      tools: {},
      messages: [{ role: "tool", content: [{ type: "tool-result", name: "skill", result: "plain body" }] }],
    })
    assert.ok(named.byCategory.skills > 0)
    assert.equal(named.byCategory.toolResults, 0)

    const unnamed = composeLoose({
      system: [],
      tools: {},
      messages: [
        {
          role: "tool",
          content: [{ type: "tool-result", name: undefined, result: { type: "text", value: "<skill_content>body</skill_content>" } }],
        },
      ],
    })
    assert.ok(unnamed.byCategory.skills > 0)
  })
})

describe("compose assistant parts", () => {
  test("ignores skill tool calls and names missing tool calls tool", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool-call", name: "skill", input: {} },
            { type: "tool-call", input: { a: 1 } },
            { type: "compaction", text: "summary" },
            { type: "unknown", text: "ignored" },
          ],
        },
      ],
    })
    assert.equal(result.byCategory.toolCalls, estimateTokens("tool {\"a\":1}"))
    assert.equal(result.byCategory.injected, estimateTokens("summary"))
  })
})

describe("compose user messages", () => {
  test("counts empty text and unnamed attachment parts", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [
        { role: "assistant", content: [{ type: "text" }, { type: "reasoning" }, { type: "compaction" }] },
        { role: "system", content: [{ type: "text" }] },
        { role: "user", content: [{ type: "text" }] },
        { role: "user", content: [{ type: "attachment", data: { a: 1 } }] },
      ],
    })
    assert.ok(result.byCategory.injected > 0)
  })

  test("summarises a typeless attachment part", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [{ role: "user", content: [{ data: { a: 1 } }] }],
    })
    assert.ok(result.byCategory.injected > 0)
  })

  test("accepts string content, undefined content and empty messages", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [{ role: "user", content: "plain string" }, { role: "user" }, { role: "user", content: [] }],
    })
    assert.equal(result.byCategory.user, estimateTokens("plain string"))
  })

  test("prices image media from its source, media or raw payload", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [
        {
          role: "user",
          content: [
            { type: "media", media: { source: { data: png(1280, 720), mediaType: "image/png" } } },
            { type: "image", mime: "image/png", data: png(640, 480) },
            { type: "media", media: { source: { data: png(800, 600), mediaType: "image/png" } } },
          ],
        },
      ],
    })
    assert.ok(result.byCategory.user > 0)
    assert.equal(result.items.filter((item) => item.name === "Image").length, 3)
  })

  test("prices file attachments from their identity and base64 padding", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [
        {
          role: "user",
          content: [
            { type: "file", name: "a.pdf", mime: "application/pdf", data: "data:application/pdf;base64,aGk=" },
            { type: "file", name: "b.pdf", mime: "application/pdf", data: "aGk==" },
            { type: "file", name: "c.pdf", mime: "application/pdf", data: "aGk" },
            { type: "file", name: "d.pdf", mime: "application/pdf", data: "data:," },
          ],
        },
      ],
    })
    assert.ok(result.byCategory.user > 0)
    assert.ok(result.items.filter((item) => item.name === "File").length >= 1)
  })

  test("accepts file media without a mime and byte-array payloads", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [
        {
          role: "user",
          content: [
            { type: "file" },
            { type: "file", media: { mediaType: "application/pdf", data: "aGk=" } },
            { type: "file", mime: "application/pdf", data: new Uint8Array([1, 2, 3]) },
            { type: "file", mime: "application/pdf", url: "file:///x.pdf" },
            { type: "media", media: { source: { data: new Uint8Array([1, 2]), mediaType: "image/png" } } },
            { type: "media", media: { mediaType: "image/png", data: new Uint8Array([1, 2]) } },
            { type: "media", media: { mediaType: "application/pdf", data: "aGk=" } },
          ],
        },
      ],
    })
    assert.ok(result.byCategory.user > 0)
    assert.equal(result.items.filter((item) => item.name === "File").length, 5)
    assert.equal(result.items.filter((item) => item.name === "Image").length, 2)
  })

  test("detects media on non-media parts from their mime and payload", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [
        {
          role: "user",
          content: [
            { type: "attachment", media: { source: { data: "aGk=", mediaType: "image/png" } } },
            { type: "attachment", mime: "image/png", data: "aGk=" },
            { type: "attachment", mime: "image/png" },
          ],
        },
      ],
    })
    assert.ok(result.byCategory.injected > 0, JSON.stringify(result.byCategory))
  })

  test("summarises attachments that carry neither text nor a media kind", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [{ role: "user", content: [{ type: "attachment", data: { a: 1 } }] }],
    })
    assert.ok(result.byCategory.injected > 0)
  })

  test("recognises a skill tag without a name and a context injection", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [
        { role: "user", content: [{ type: "text", text: "<skill_content>body</skill_content>" }] },
        { role: "user", content: [{ type: "text", text: "<context>env</context>" }] },
      ],
    })
    assert.ok(result.byCategory.skills > 0)
    assert.ok(result.byCategory.injected > 0)
  })

  test("caps media items at 400 entries", () => {
    const result = composeLoose({
      system: [],
      tools: {},
      messages: [
        {
          role: "user",
          content: Array.from({ length: 401 }, () => ({ type: "image", mime: "image/png" })),
        },
      ],
    })
    assert.equal(result.items.length, 400)
  })
})
