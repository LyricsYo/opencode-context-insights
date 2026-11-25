import assert from "node:assert/strict"
import { describe, test } from "vitest"
import { commandRowOf, commandStatusOf, statusOf } from "../../src/shared/commandInternals.ts"

function row(command: string, extra: Partial<Parameters<typeof commandRowOf>[0]> = {}) {
  return commandRowOf({
    id: "c1",
    messageID: "m1",
    at: 0,
    tool: "shell",
    command,
    status: "completed",
    ...extra,
  })
}

describe("program parsing", () => {
  test("normalises quoted, absolute and Windows executables", () => {
    assert.equal(row('"/usr/bin/npm" test').program, "npm")
    assert.equal(row("C:\\tools\\git.exe status").program, "git")
    assert.equal(row("C:\\tools\\build.cmd /x").program, "build")
    assert.equal(row("scripts\\run.bat").program, "run")
  })

  test("skips assignments, wrappers and their flags", () => {
    assert.deepEqual(row("FOO=1 BAR+=2 npm test").programs, ["npm"])
    assert.deepEqual(row("sudo -u root npm test").programs, ["npm"])
    assert.deepEqual(row("env -i FOO=1 npm test").programs, ["npm"])
    assert.deepEqual(row("timeout 10s npm test").programs, ["npm"])
    assert.deepEqual(row("nice -n 5 npm test").programs, ["npm"])
    assert.deepEqual(row("stdbuf -o L npm test").programs, ["npm"])
    assert.deepEqual(row("2>/dev/null npm test").programs, ["npm"])
    assert.deepEqual(row("> out.txt npm test").programs, ["npm"])
  })

  test("collapses shell heads and navigation to shell, keeping only real programs", () => {
    assert.deepEqual(row("if [ -f x ]; then npm test; fi").programs, ["shell"])
    assert.deepEqual(row("cd /tmp").programs, ["cd"])
    assert.deepEqual(row("cd /tmp && npm test").programs, ["npm"])
    assert.deepEqual(row("@'literal'").programs, ["shell"])
    assert.deepEqual(row('@"literal"').programs, ["shell"])
    assert.deepEqual(row("sudo sudo sudo sudo sudo sudo sudo sudo sudo npm test").programs, ["shell"])
    assert.deepEqual(row("> > npm").programs, ["shell"])
    assert.deepEqual(row("sudo -u").programs, ["shell"])
    assert.deepEqual(row("sudo -E npm test").programs, ["npm"])
    assert.deepEqual(row("timeout").programs, ["shell"])
    assert.deepEqual(row("& echo hi").programs, ["echo"])
    assert.deepEqual(row("").programs, ["shell"])
  })

  test("splits on newlines, semicolons, pipelines and logical operators", () => {
    assert.deepEqual(row("npm test && echo done").programs, ["npm", "echo"])
    assert.deepEqual(row("npm test || echo failed").programs, ["npm", "echo"])
    assert.deepEqual(row("npm test |& cat").programs, ["npm", "cat"])
    assert.deepEqual(row("npm test; echo done").programs, ["npm", "echo"])
    assert.deepEqual(row("npm test\necho done").programs, ["npm", "echo"])
    assert.deepEqual(row("npm test & echo done").programs, ["npm", "echo"])
    assert.deepEqual(row("npm test >& out").programs, ["npm"])
    assert.deepEqual(row("npm test &> out").programs, ["npm"])
  })

  test("ignores separators inside quotes and handles an escaped quote", () => {
    assert.deepEqual(row('echo "a && b | c; d"').programs, ["echo"])
    assert.deepEqual(row("echo 'a && b'").programs, ["echo"])
    assert.deepEqual(row('echo "a \\" b" && npm test').programs, ["echo", "npm"])
  })

  test("deduplicates repeated programs", () => {
    assert.deepEqual(row("npm test && npm run build && npm publish").programs, ["npm"])
  })
})

describe("commandPreview", () => {
  test("strips a cd into the workspace and keeps the rest of the line", () => {
    assert.equal(row("cd D:\\repo && npm test", { workspace: "D:\\repo" }).preview, "npm test")
    assert.equal(row('cd "D:\\repo\\" && npm test', { workspace: "D:/repo" }).preview, "npm test")
    assert.equal(row("cd /repo; npm test", { workspace: "/repo/" }).preview, "npm test")
  })

  test("keeps the cd when it targets another directory or the workspace is unknown", () => {
    assert.equal(row("cd /other && npm test", { workspace: "/repo" }).preview, "cd /other && npm test")
    assert.equal(row("cd /repo && npm test").preview, "npm test")
    assert.equal(row("cd /repo && npm test", { workspace: "" }).preview, "npm test")
  })

  test("shows only the first line", () => {
    assert.equal(row("npm test\nnpm run build").preview, "npm test")
    assert.equal(row("npm test\r\nmore").preview, "npm test")
  })
})

describe("commandShape", () => {
  test("counts lines and recognises heredocs and inline interpreters", () => {
    assert.equal(row("npm test\nnpm run\nmore").lines, 3)
    assert.equal(row("cat <<EOF\nbody\nEOF").heredoc, true)
    assert.equal(row("cat <<-'EOF'\nbody").heredoc, true)
    assert.equal(row("node -e \"console.log(1)\"").inline, true)
    assert.equal(row("python3 -c 'print(1)'").inline, true)
    assert.equal(row("bun -e 'x'").inline, true)
    assert.equal(row("npm test").heredoc, false)
    assert.equal(row("npm test").inline, false)
  })
})

describe("status mapping", () => {
  test("commandStatusOf prefers the tool state and falls back to the exit code", () => {
    assert.equal(commandStatusOf({ status: "running" }, undefined), "running")
    assert.equal(commandStatusOf({ status: "error" }, 0), "failed")
    assert.equal(commandStatusOf({ status: "failed" }, 0), "failed")
    assert.equal(commandStatusOf({ status: "completed" }, 2), "failed")
    assert.equal(commandStatusOf({ status: "completed" }, 0), "completed")
    assert.equal(commandStatusOf({}, undefined), "completed")
  })

  test("statusOf reads metadata and normalises an error state", () => {
    assert.deepEqual(statusOf({ metadata: { status: "completed", exit: 0 } }), { status: "completed", exit: 0 })
    assert.deepEqual(statusOf({ status: "error" }), { status: "failed", exit: undefined })
    assert.deepEqual(statusOf({}), { status: "unknown", exit: undefined })
    assert.deepEqual(statusOf({ status: "running", metadata: "nope" }), { status: "running", exit: undefined })
  })
})

describe("commandRowOf", () => {
  test("keeps optional metadata and output measurements", () => {
    const command = row("npm test", {
      description: "run tests",
      workdir: "D:/repo",
      background: true,
      timeoutMs: 5000,
      nested: true,
      truncated: true,
      duration: 1200,
      exit: 1,
      status: "failed",
      output: "a\r\nb\nc",
    })
    assert.equal(command.description, "run tests")
    assert.equal(command.workdir, "D:/repo")
    assert.equal(command.background, true)
    assert.equal(command.truncated, true)
    assert.equal(command.nested, true)
    assert.equal(command.timeoutMs, 5000)
    assert.equal(command.duration, 1200)
    assert.equal(command.exit, 1)
    assert.equal(command.status, "failed")
    assert.equal(command.outChars, 6)
    assert.equal(command.outLines, 3)
  })

  test("defaults flags to false and reports an empty output as zero lines", () => {
    const command = row("npm test")
    assert.equal(command.background, false)
    assert.equal(command.truncated, false)
    assert.equal(command.nested, false)
    assert.equal(command.output, "")
    assert.equal(command.outChars, 0)
    assert.equal(command.outLines, 0)
  })

  test("does not count a trailing newline as an extra output line", () => {
    assert.equal(row("npm test", { output: "a\r\nb\r\n" }).outLines, 2)
  })
})
