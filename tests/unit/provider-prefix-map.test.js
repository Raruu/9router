// buildProviderIdByPrefix — every prefix form a combo member or dashboard model
// string can carry must map back to a provider id.
//
// The node layer exists because a custom node's connections can all be
// deactivated while its models and catalog pins remain: a combo member pointing
// at that node must still resolve to its id, or the member's pinned capabilities
// are silently replaced by provider-agnostic catalog rules.
import { describe, it, expect } from "vitest";

import { buildProviderIdByPrefix } from "../../src/lib/providerPrefixMap.js";

const NODE_ID = "openai-compatible-chat-abc123";
const conn = (provider, prefix, extra = {}) => ({
  provider,
  providerSpecificData: { prefix, ...extra },
});
const node = (id, prefix) => ({ id, prefix });

describe("buildProviderIdByPrefix", () => {
  it("resolves built-in provider ids and aliases", () => {
    const map = buildProviderIdByPrefix([]);
    expect(map.get("anthropic")).toBe("anthropic");
    expect(map.get("cx")).toBe("codex");
  });

  it("resolves a node prefix from the node list alone (no connections)", () => {
    const map = buildProviderIdByPrefix([], [node(NODE_ID, "agent-router")]);
    expect(map.get("agent-router")).toBe(NODE_ID);
  });

  it("resolves a node prefix even when only inactive connections exist", () => {
    // /v1/models filters to active connections; the node layer is what keeps an
    // inactive node's prefix resolvable. The caller passes unfiltered nodes.
    const map = buildProviderIdByPrefix([], [node(NODE_ID, "agent-router")]);
    expect(map.get("agent-router")).toBe(NODE_ID);
  });

  it("never lets a node prefix override a built-in id or alias", () => {
    const map = buildProviderIdByPrefix([], [node(NODE_ID, "cx"), node("node-2", "anthropic")]);
    expect(map.get("cx")).toBe("codex");
    expect(map.get("anthropic")).toBe("anthropic");
  });

  it("lets a connection prefix win over a node with the same prefix", () => {
    const map = buildProviderIdByPrefix(
      [conn("anthropic-compatible-xyz", "shared-prefix")],
      [node(NODE_ID, "shared-prefix")],
    );
    expect(map.get("shared-prefix")).toBe("anthropic-compatible-xyz");
  });

  it("keeps the first node when two nodes share a prefix", () => {
    const map = buildProviderIdByPrefix([], [node(NODE_ID, "dup"), node("node-2", "dup")]);
    expect(map.get("dup")).toBe(NODE_ID);
  });

  it("ignores malformed nodes and blank prefixes", () => {
    const map = buildProviderIdByPrefix([], [
      null,
      { id: NODE_ID },
      { prefix: "no-id" },
      node(NODE_ID, "   "),
      node("", "empty-id"),
    ]);
    expect(map.get("no-id")).toBeUndefined();
    expect(map.size).toBeGreaterThan(0); // built-ins still present
  });

  it("omitting the node list keeps the previous behavior", () => {
    const withArg = buildProviderIdByPrefix([], []);
    const withoutArg = buildProviderIdByPrefix([]);
    expect([...withoutArg.entries()]).toEqual([...withArg.entries()]);
  });

  it("still maps connection prefixes and provider aliases", () => {
    const map = buildProviderIdByPrefix([conn("openai-compatible-chat-xyz", "my-node")]);
    expect(map.get("my-node")).toBe("openai-compatible-chat-xyz");
  });
});
