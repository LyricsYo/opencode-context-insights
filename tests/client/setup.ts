import { afterEach } from "vitest"

// jsdom lacks these; a deterministic frame keeps mount-time effects testable.
globalThis.requestAnimationFrame = (callback: FrameRequestCallback) =>
  setTimeout(() => callback(performance.now()), 0) as unknown as number
globalThis.cancelAnimationFrame = (handle: number) => clearTimeout(handle)

if (typeof globalThis.ResizeObserver !== "function") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver
}

afterEach(() => {
  document.body.replaceChildren()
})
