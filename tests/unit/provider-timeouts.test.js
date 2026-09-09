import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveProviderTimeouts } from "../../open-sse/config/timeouts.js";
import { pipeWithDisconnect } from "../../open-sse/utils/streamHandler.js";

describe("resolveProviderTimeouts", () => {
  it("keeps valid positive numbers and drops everything else", () => {
    expect(resolveProviderTimeouts({
      connectMs: 2000,
      firstChunkMs: 0,
      stallMs: -5,
      extra: 10,
    })).toEqual({ connectMs: 2000 });
  });

  it("returns an empty object for missing or malformed input", () => {
    expect(resolveProviderTimeouts(null)).toEqual({});
    expect(resolveProviderTimeouts(undefined)).toEqual({});
    expect(resolveProviderTimeouts([])).toEqual({});
    expect(resolveProviderTimeouts("fast")).toEqual({});
    expect(resolveProviderTimeouts({ connectMs: "2000", stallMs: NaN })).toEqual({});
  });
});

function makeController() {
  return {
    signal: new AbortController().signal,
    startTime: Date.now(),
    isConnected: () => true,
    handleComplete: vi.fn(),
    handleError: vi.fn(),
    handleDisconnect: vi.fn(),
    abort: vi.fn(),
  };
}

describe("pipeWithDisconnect first-chunk timeout", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("aborts when no chunk arrives within the first-chunk timeout", async () => {
    const controller = makeController();
    const response = new Response(new ReadableStream({}));
    pipeWithDisconnect(response, new TransformStream(), controller, null, 360000, 50);

    await vi.advanceTimersByTimeAsync(60);
    expect(controller.handleError).toHaveBeenCalledTimes(1);
    expect(controller.handleError.mock.calls[0][0].message).toBe("first chunk timeout");
    expect(controller.abort).toHaveBeenCalled();
  });

  it("does not fire once a chunk has arrived", async () => {
    const controller = makeController();
    const response = new Response(new ReadableStream({
      start(c) {
        c.enqueue(new TextEncoder().encode("data: hello\n\n"));
        c.close();
      },
    }));
    const out = pipeWithDisconnect(response, new TransformStream(), controller, null, 360000, 50);

    const reader = out.getReader();
    const read = reader.read();
    await vi.advanceTimersByTimeAsync(10);
    await read;
    reader.releaseLock();

    await vi.advanceTimersByTimeAsync(360000);
    expect(controller.handleError).not.toHaveBeenCalled();
  });
});
