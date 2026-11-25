import type { SessionInfo, SessionMessageInfo } from "@opencode/client"
import type { PanelProps } from "@opencode/plugin/gui"
import { REQUIRED_HOST_METHODS, HOST_CONTRACT } from "../../../src/shared/host.ts"

export const panelNow = Date.UTC(2026, 10, 16, 8, 41)

export const panelMessages = [
  { id: "u1", type: "user", text: "inspect the repo", time: { created: panelNow } },
  {
    id: "a1",
    type: "assistant",
    agent: "build",
    model: { id: "m", providerID: "p" },
    time: { created: panelNow + 1000, completed: panelNow + 2000 },
    content: [{ type: "text", text: "the answer" }],
    tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
    cost: 0.01,
  },
] as unknown as SessionMessageInfo[]

const sessionInfo = {
  id: "ses_test",
  title: "Demo session",
  agent: "build",
  model: { id: "m", providerID: "p" },
  time: { created: panelNow, updated: panelNow + 2000 },
  tokens: { input: 100, output: 10, reasoning: 0, cache: { read: 0, write: 0 } },
  cost: 0.01,
  location: { directory: "D:/repo" },
  projectID: "p",
} as unknown as SessionInfo

export function makeRpc(overrides: Record<string, unknown> = {}) {
  return {
    hello: async () => ({
      plugin: "opencode-context",
      contract: HOST_CONTRACT,
      storage: 1,
      app: "opencode",
      appVersion: "2.2.6",
      methods: [...REQUIRED_HOST_METHODS, "headersMany", "prices"],
    }),
    prices: async () => ({ entries: [], ready: true, version: 1 }),
    snapshot: async () => ({ snapshot: null }),
    header: async () => ({ header: null }),
    headers: async () => ({ headers: [] }),
    headersMany: async () => ({ headers: {} }),
    ...overrides,
  }
}

/** The routed session and data store a panel render receives from the app. */
export function makeSessionProps(
  messages: SessionMessageInfo[] = panelMessages,
  rpc: Record<string, unknown> = makeRpc(),
): PanelProps {
  const data = {
    listen: () => () => {},
    location: { model: { list: () => [] } },
    session: {
      missing: () => false,
      get: () => sessionInfo,
      list: () => [sessionInfo],
      status: () => "idle",
      sync: async () => {},
      message: {
        list: () => messages,
        sync: async () => {},
        more: () => false,
        loading: () => false,
        loadMore: async () => {},
      },
    },
  }
  const session = {
    id: "ses_test",
    directory: "D:/repo",
    location: { directory: "D:/repo" },
    server: {
      id: "srv_test",
      data,
      client: {
        rpc: () => rpc,
        config: { get: async () => [] },
      },
    },
  }
  return {
    tab: { id: "context", title: "Context" },
    session,
    screen: {},
  } as unknown as PanelProps
}

/** Lets every promise the panel started on mount settle. */
export async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}
