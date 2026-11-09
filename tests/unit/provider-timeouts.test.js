import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_IMAGE_JOB_TIMEOUT_MS,
  defaultImageJobTimeoutMs,
  resolveImageJobTimeoutMs,
  resolveProviderTimeouts,
} from "../../open-sse/config/timeouts.js";
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

  it("does not leak the image job timeout into the chat resolver", () => {
    expect(resolveProviderTimeouts({ imageJobMs: 60000 })).toEqual({});
  });
});

describe("resolveImageJobTimeoutMs", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("defaults to 300s", () => {
    expect(defaultImageJobTimeoutMs()).toBe(300000);
    expect(DEFAULT_IMAGE_JOB_TIMEOUT_MS).toBe(300000);
    expect(resolveImageJobTimeoutMs(null)).toBe(300000);
  });

  it("honours the IMAGE_JOB_TIMEOUT_MS env override", () => {
    vi.stubEnv("IMAGE_JOB_TIMEOUT_MS", "45000");
    expect(defaultImageJobTimeoutMs()).toBe(45000);
    expect(resolveImageJobTimeoutMs(undefined)).toBe(45000);
  });

  it("prefers a per-provider imageJobMs override", () => {
    expect(resolveImageJobTimeoutMs({ imageJobMs: 60000 }, 300000)).toBe(60000);
  });

  it("falls back for missing or invalid overrides", () => {
    expect(resolveImageJobTimeoutMs({ imageJobMs: 0 }, 300000)).toBe(300000);
    expect(resolveImageJobTimeoutMs({ imageJobMs: -1 }, 300000)).toBe(300000);
    expect(resolveImageJobTimeoutMs({ imageJobMs: "60000" }, 300000)).toBe(300000);
    expect(resolveImageJobTimeoutMs({ imageJobMs: Number.NaN }, 300000)).toBe(300000);
    expect(resolveImageJobTimeoutMs("nope", 300000)).toBe(300000);
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
