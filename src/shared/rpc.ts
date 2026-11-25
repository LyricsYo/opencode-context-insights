import { Rpc } from "@opencode/plugin/rpc"

/** Larger fleets are split by the client; the host never expands one request past this. */
export const HEADERS_MANY_MAX = 64

export const ContextRpc = Rpc.define({
  id: "opencode-context-insights",
  events: {},
  methods: {
    hello: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      } as const,
      output: { type: "object" } as const,
    },
    prices: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      } as const,
      output: { type: "object" } as const,
    },
    snapshot: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      } as const,
      output: { type: "object" } as const,
    },
    header: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" }, at: { type: "number" } },
        required: ["sessionID", "at"],
        additionalProperties: false,
      } as const,
      output: { type: "object" } as const,
    },
    headers: {
      input: {
        type: "object",
        properties: { sessionID: { type: "string" } },
        required: ["sessionID"],
        additionalProperties: false,
      } as const,
      output: { type: "object" } as const,
    },
    headersMany: {
      input: {
        type: "object",
        properties: {
          sessionIDs: { type: "array", items: { type: "string" } },
        },
        required: ["sessionIDs"],
        additionalProperties: false,
      } as const,
      output: { type: "object" } as const,
    },
  },
})
