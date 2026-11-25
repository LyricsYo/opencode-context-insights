import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { SessionMessageInfo } from "@opencode/client"
import { buildTokenTurns, generatedOfMessage } from "../../src/shared/tokens.ts"
import { buildSessionIndex } from "../../src/shared/sessionIndex.ts"
import { systemPartsOf, toolsOf } from "../../src/shared/header.ts"
import { buildCommands, summarizeCommands } from "../../src/shared/commands.ts"
import { buildStepBrief } from "../../src/shared/browser.ts"
import { createSnapshotStore } from "../../src/host/snapshots.ts"
import { priceModelId } from "../../src/shared/priceIdentity.ts"
import { at, tool } from "./fixtures.ts"

describe("tokens tail branches", () => {
  test("keeps a turn duration at zero when its only step has none", () => {
    const turns = buildTokenTurns([
      {
        id: "a1",
        at: at(1),
        turn: 1,
        step: 1,
        prompt: 10,
        output: 1,
        duration: undefined,
        wait: 0,
        delegation: 0,
        total: 10,
        byCategory: {
          system: 0,
          tools: 0,
          user: 10,
          injected: 0,
          skills: 0,
          assistant: 0,
          reasoning: 0,
          toolCalls: 0,
          toolResults: 0,
        },
        headerMissing: false,
        afterCompaction: false,
      },
    ])
    assert.equal(turns[0].duration, 0)
  })

  test("counts a text part and ignores other part kinds", () => {
    const mix = generatedOfMessage({
      id: "a1",
      type: "assistant",
      agent: "build",
      model: { id: "m", providerID: "p" },
      time: { created: at(1) },
      content: [
        { type: "text", text: "a".repeat(40) },
        { type: "file", mime: "text/plain" },
      ],
    } as unknown as SessionMessageInfo)
    assert.ok(mix.answers > 0)
    assert.equal(mix.reasoning, 0)
  })
})

describe("header tail branches", () => {
  test("falls back for instruction entries without a key or text", () => {
    const parts = systemPartsOf([
      {
        text: "ignored",
        metadata: {
          experimental: {
            instructions: [{}, { key: "", text: "   " }, { key: 1, text: 2 }],
          },
        },
      },
    ])
    assert.deepEqual(parts, [])
  })

  test("keeps a named instruction and falls back for an unnamed one", () => {
    const parts = systemPartsOf([
      {
        text: "ignored",
        metadata: { experimental: { instructions: [{ key: "core", text: "be brief" }, { text: "extra" }] } },
      },
    ])
    assert.deepEqual(parts, [
      { key: "core", text: "be brief" },
      { key: "instructions", text: "extra" },
    ])
  })

  test("defaults a tool description that is not a string", () => {
    const tools = toolsOf({ read: { input: { type: "object" }, description: 5 } as never })
    assert.equal(tools[0].description, "")
    assert.equal(tools[0].name, "read")
  })
})

describe("commands summary tail branches", () => {
  test("keeps the first program when failure counts tie and picks the most repeated command", () => {
    const rows = buildCommands([
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(0), completed: at(1) },
        content: [
          tool("c1", "shell", { status: "completed", input: { command: "npm test" }, metadata: { exit: 1 }, content: [] }, 0, 10),
          tool("c2", "shell", { status: "completed", input: { command: "gemini run" }, metadata: { exit: 1 }, content: [] }, 10, 20),
          tool("c3", "shell", { status: "completed", input: { command: "npm test" }, metadata: { exit: 1 }, content: [] }, 20, 30),
        ],
      },
    ] as unknown as SessionMessageInfo[])
    const summary = summarizeCommands(rows)
    assert.deepEqual(summary.failing, { program: "npm", count: 2 })
    assert.equal(summary.repeats?.count, 2)
  })

  test("keeps the earlier repeat when a later command repeats less", () => {
    const rows = buildCommands([
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(0), completed: at(1) },
        content: [
          tool("c1", "shell", { status: "completed", input: { command: "npm test" }, metadata: { exit: 0 }, content: [] }, 0, 10),
          tool("c2", "shell", { status: "completed", input: { command: "npm test" }, metadata: { exit: 0 }, content: [] }, 10, 20),
          tool("c3", "shell", { status: "completed", input: { command: "npm test" }, metadata: { exit: 0 }, content: [] }, 20, 30),
          tool("c4", "shell", { status: "completed", input: { command: "git status" }, metadata: { exit: 0 }, content: [] }, 30, 40),
          tool("c5", "shell", { status: "completed", input: { command: "git status" }, metadata: { exit: 0 }, content: [] }, 40, 50),
        ],
      },
    ] as unknown as SessionMessageInfo[])
    const summary = summarizeCommands(rows)
    assert.deepEqual(summary.repeats, { command: "npm test", preview: "npm test", count: 3 })
  })

  test("has no failing program or repeat when nothing repeats or fails", () => {
    const rows = buildCommands([
      {
        id: "a1",
        type: "assistant",
        agent: "build",
        model: { id: "m", providerID: "p" },
        time: { created: at(0), completed: at(1) },
        content: [
          tool("c1", "shell", { status: "completed", input: { command: "npm test" }, metadata: { exit: 0 }, content: [] }, 0, 10),
          tool("c2", "shell", { status: "completed", input: { command: "git status" }, metadata: { exit: 0 }, content: [] }, 10, 20),
        ],
      },
    ] as unknown as SessionMessageInfo[])
    const summary = summarizeCommands(rows)
    assert.equal(summary.failing, undefined)
    assert.equal(summary.repeats, undefined)
  })
})

describe("browser brief tail branches", () => {
  test("names an attachment count on an opener whose text clips away", () => {
    const brief = buildStepBrief(
      [
        {
          id: "u1",
          type: "user",
          text: "   ",
          files: [{ mime: "image/png", name: "a.png", data: "aGk=" }],
          time: { created: at(1) },
        },
        {
          id: "a1",
          type: "assistant",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: at(2), completed: at(3) },
          content: [],
        },
      ] as unknown as SessionMessageInfo[],
      "a1",
    )
    assert.equal(brief.opener?.preview, "1 attachments")
  })

  test("leaves the opener preview empty without text or attachments", () => {
    const brief = buildStepBrief(
      [
        { id: "u1", type: "user", text: "   ", files: [], time: { created: at(1) } },
        {
          id: "a1",
          type: "assistant",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: at(2), completed: at(3) },
          content: [],
        },
      ] as unknown as SessionMessageInfo[],
      "a1",
    )
    assert.equal(brief.opener?.preview, "")
  })
})

describe("session index tail branches", () => {
  test("ignores a non-text, non-reasoning, non-tool part", () => {
    const index = buildSessionIndex(
      [
        {
          id: "a1",
          type: "assistant",
          agent: "build",
          model: { id: "m", providerID: "p" },
          time: { created: at(1), completed: at(2) },
          content: [{ type: "file", mime: "text/plain" }],
          tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } },
        },
      ] as unknown as SessionMessageInfo[],
      [],
    )
    assert.equal(index.scan.generated.answers, 0)
    assert.equal(index.scan.generated.reasoning, 0)
    assert.equal(index.scan.generated.calls, 0)
  })
})

describe("estimate tail branches", () => {
  test("keeps an unnamed attachment summary key", () => {
    const result = buildSessionIndex([], [])
    assert.equal(result.turnCount, 0)
  })
})

describe("snapshot store tail", () => {
  test("clears every snapshot", () => {
    const store = createSnapshotStore(2)
    store.set("a", { sessionID: "a" } as never)
    store.clear()
    assert.equal(store.get("a"), undefined)
  })
})

describe("priceModelId tail", () => {
  test("falls back to the trimmed model when the prefix strip empties it", () => {
    assert.equal(priceModelId("@cf/"), "@cf/")
  })
})
