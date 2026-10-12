// Combo members table — the "pin is missing" hint.
//
// A member whose prefix matches no provider still renders as a row, but its
// catalog pin can never be applied, so its capabilities come from generic
// rules. The hint must appear in exactly that case and nowhere else.
// Rendered with react-dom/server (the test env is node; no DOM library).
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { MembersTable } = await import("../../src/shared/components/ModelDetailModal.js");

const member = (overrides = {}) => ({
  raw: "agent-router/gpt-6-astra",
  resolved: "agent-router/gpt-6-astra",
  name: "gpt-6-astra",
  kind: "llm",
  capabilities: { contextWindow: 1000000, maxOutput: 128000 },
  pricing: null,
  ...overrides,
});

const render = (members) => renderToStaticMarkup(createElement(MembersTable, { members }));

describe("MembersTable pin hint", () => {
  it("shows the hint when the member's provider is missing", () => {
    const html = render([member({ providerMissing: true })]);
    expect(html).toContain("pin is missing");
  });

  it("hides the hint for a resolved member", () => {
    expect(render([member()])).not.toContain("pin is missing");
  });

  it("shows the existing pin line, not the hint, when a pin is attached", () => {
    const html = render([member({
      catalogRef: { source: "user", provider: "*", pattern: "gpt-6-astra-agentrouter" },
    })]);
    expect(html).toContain("[user] * / gpt-6-astra-agentrouter");
    expect(html).not.toContain("pin is missing");
  });

  it("prefers the `unresolved` badge over the hint for a member that resolves to nothing", () => {
    const html = render([member({ unresolved: true, providerMissing: true, capabilities: null })]);
    expect(html).toContain("unresolved");
    expect(html).not.toContain("pin is missing");
  });

  it("still renders the nested-combo marker", () => {
    const html = render([member({ kind: "combo", raw: "inner" })]);
    expect(html).toContain("nested combo");
  });
});
