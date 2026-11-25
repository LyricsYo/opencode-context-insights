import assert from "node:assert/strict"
import { describe, test } from "vitest"
import type { PanelProps } from "@opencode/plugin/gui"
import { createFilePreview } from "../../../src/client/models/filePreview.ts"
import { makePluginContext, mount } from "../helpers/mount.tsx"
import { makeSessionProps, settle } from "../helpers/session.ts"

const files = [
  { path: "a.ts", reads: 1, writes: 0, searches: 0, additions: 0, deletions: 0, ops: [] },
  { path: "D:/abs/b.ts", reads: 1, writes: 0, searches: 0, additions: 0, deletions: 0, ops: [] },
]

function probe(ctx: never, props: PanelProps, view: "overview" | "browser" = "browser") {
  let model: ReturnType<typeof createFilePreview> | undefined
  const mounted = mount(() => {
    model = createFilePreview({
      props,
      view: () => view,
      revision: () => 1,
      shownFiles: () => files,
      fileLimit: () => 10,
    })
    return <span />
  }, ctx)
  assert.ok(model)
  return { model, ...mounted }
}

describe("createFilePreview", () => {
  test("checks the visible files and records missing ones", async () => {
    const ctx = makePluginContext({
      links: {
        open: () => true,
        exists: async (input: { href: string }) => input.href === "D:/repo/a.ts",
      },
    })
    const view = probe(ctx, makeSessionProps())
    await settle()

    assert.equal(view.model.fileMissing().get("a.ts"), true)
    assert.equal(view.model.fileMissing().get("D:/abs/b.ts"), false)
    view.dispose()
  })

  test("opens a relative path under the server directory", () => {
    const opened: Array<{ href: string; exact: boolean }> = []
    const ctx = makePluginContext({
      links: {
        open: (input: { href: string; exact: boolean }) => {
          opened.push(input)
          return true
        },
        exists: async () => true,
      },
    })
    const view = probe(ctx, makeSessionProps())

    view.model.previewFile("src/a.ts")
    assert.deepEqual(opened.map(({ href, exact }) => ({ href, exact })), [{ href: "D:/repo/src/a.ts", exact: true }])
    view.dispose()
  })

  test("keeps an absolute path as-is and refreshes it when the host cannot open it", async () => {
    const external: string[] = []
    let exists = false
    const ctx = makePluginContext({
      links: {
        open: () => {
          throw new Error("gone")
        },
        exists: async () => exists,
      },
      system: { copy: async () => {}, openExternal: (uri: string) => external.push(uri) },
    })
    const view = probe(ctx, makeSessionProps())

    view.model.previewFile("D:/abs/b.ts")
    await settle()
    assert.deepEqual(external, ["file:///D:/abs/b.ts"])
    assert.equal(view.model.fileMissing().get("D:/abs/b.ts"), false)

    exists = true
    view.model.previewFile("D:/abs/b.ts")
    await settle()
    assert.equal(view.model.fileMissing().get("D:/abs/b.ts"), true)
    view.dispose()
  })

  test("leaves files unvisited outside the browser tab", async () => {
    let checked = 0
    const ctx = makePluginContext({
      links: {
        open: () => true,
        exists: async () => {
          checked += 1
          return true
        },
      },
    })
    const view = probe(ctx, makeSessionProps(), "overview")
    await settle()

    assert.equal(checked, 0)
    assert.equal(view.model.fileMissing().size, 0)
    view.dispose()
  })

  test("checks each shown file once per check set", async () => {
    const checked: string[] = []
    const ctx = makePluginContext({
      links: {
        open: () => true,
        exists: async (input: { href: string }) => {
          checked.push(input.href)
          return true
        },
      },
    })
    const view = probe(ctx, makeSessionProps())
    await settle()
    assert.deepEqual(checked, ["D:/repo/a.ts", "D:/abs/b.ts"])
    view.dispose()
  })

  test("forgets a file whose existence check failed so a later pass retries", async () => {
    const { createSignal } = await import("solid-js")
    const [revision, setRevision] = createSignal(1)
    let attempts = 0
    const ctx = makePluginContext({
      links: {
        open: () => true,
        exists: async () => {
          attempts += 1
          if (attempts <= 2) throw new Error("host gone")
          return true
        },
      },
    })
    let model: ReturnType<typeof createFilePreview> | undefined
    const mounted = mount(() => {
      model = createFilePreview({
        props: makeSessionProps(),
        view: () => "browser",
        revision,
        shownFiles: () => files,
        fileLimit: () => 10,
      })
      return <span />
    }, ctx)
    await settle()
    assert.ok(model)
    assert.equal(model.fileMissing().size, 0)
    assert.equal(attempts, 2)

    // Both failed checks left the set, so a new revision asks again.
    setRevision(2)
    await settle()
    assert.equal(attempts, 4)
    assert.equal(model.fileMissing().get("a.ts"), true)
    assert.equal(model.fileMissing().get("D:/abs/b.ts"), true)
    mounted.dispose()
  })

  test("refreshes the cached check when the host cannot open a file", async () => {
    const ctx = makePluginContext({
      links: {
        open: () => {
          throw new Error("gone")
        },
        exists: async () => Promise.reject(new Error("offline")),
      },
      system: { copy: async () => {}, openExternal: () => {} },
    })
    const view = probe(ctx, makeSessionProps())
    await settle()
    view.model.previewFile("a.ts")
    await settle()
    assert.equal(view.model.fileMissing().size, 0)
    view.dispose()
  })

  test("previews an absolute POSIX path and a trailing-separator directory", () => {
    const opened: string[] = []
    const props = makeSessionProps()
    ;(props.session as unknown as { directory: string }).directory = "/repo/"
    const ctx = makePluginContext({
      links: {
        open: (input: { href: string }) => {
          opened.push(input.href)
          return true
        },
        exists: async () => true,
      },
    })
    const view = probe(ctx, props)
    view.model.previewFile("/etc/hosts")
    view.model.previewFile("./src/./a.ts")
    assert.deepEqual(opened, ["/etc/hosts", "/repo/src/./a.ts"])
    view.dispose()
  })

  test("keeps a UNC path as-is", () => {
    const opened: string[] = []
    const ctx = makePluginContext({
      links: {
        open: (input: { href: string }) => {
          opened.push(input.href)
          return true
        },
        exists: async () => true,
      },
    })
    const view = probe(ctx, makeSessionProps())
    view.model.previewFile(String.raw`\\\\server\\share\\a.ts`)
    view.model.previewFile("a/b.ts")
    assert.deepEqual(opened, [String.raw`\\\\server\\share\\a.ts`, "D:/repo/a/b.ts"])
    view.dispose()
  })

  test("tracks the visible files up to the limit and keeps a repeated result", async () => {
    const { createSignal } = await import("solid-js")
    const [revision, setRevision] = createSignal(1)
    let calls = 0
    const ctx = makePluginContext({
      links: {
        open: () => true,
        exists: async () => {
          calls += 1
          return true
        },
      },
    })
    const files = [
      { path: "a.ts", reads: 1, writes: 0, searches: 0, additions: 0, deletions: 0, ops: [] },
      { path: "b.ts", reads: 1, writes: 0, searches: 0, additions: 0, deletions: 0, ops: [] },
    ]
    let model: ReturnType<typeof createFilePreview> | undefined
    const mounted = mount(() => {
      model = createFilePreview({
        props: makeSessionProps(),
        view: () => "browser",
        revision,
        shownFiles: () => files,
        fileLimit: () => 1,
      })
      return <span />
    }, ctx)
    await settle()
    assert.ok(model)
    assert.equal(calls, 1)
    assert.equal(model.fileMissing().get("a.ts"), true)
    assert.equal(model.fileMissing().has("b.ts"), false)
    const current = model.fileMissing()

    // A new revision walks the same paths again but the check set skips them.
    setRevision(2)
    await settle()
    assert.equal(calls, 1)
    assert.equal(model.fileMissing(), current)

    // The same answer lands again after a cleared set: the map is kept by identity.
    model.clearChecks()
    setRevision(3)
    await settle()
    assert.equal(calls, 2)
    assert.equal(model.fileMissing(), current)
    mounted.dispose()
  })
})
