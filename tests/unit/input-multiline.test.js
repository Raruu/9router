// Shared Input component — the `multiline` prop must render a textarea with the
// same field chrome, without leaking input-only attributes.
// Rendered with react-dom/server (the test env is node; no DOM library).
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const { default: Input } = await import("../../src/shared/components/Input.js");

const render = (props) => renderToStaticMarkup(createElement(Input, props));

describe("Input multiline", () => {
  it("renders a textarea with the requested row count", () => {
    const html = render({ multiline: true, rows: 4, value: "long text", onChange: () => {} });
    expect(html).toContain("<textarea");
    expect(html).toContain('rows="4"');
    expect(html).not.toContain("<input");
  });

  it("defaults to three rows", () => {
    expect(render({ multiline: true, value: "", onChange: () => {} })).toContain('rows="3"');
  });

  it("never forwards an input type attribute to the textarea", () => {
    const html = render({ multiline: true, type: "number", min: 1, max: 5, value: "", onChange: () => {} });
    expect(html).not.toContain('type="number"');
    expect(html).not.toContain('min="1"');
  });

  it("keeps label, hint and error chrome identical to the single-line variant", () => {
    const html = render({ multiline: true, label: "Instructions", hint: "Plain text", value: "", onChange: () => {} });
    expect(html).toContain("Instructions");
    expect(html).toContain("Plain text");
    expect(html).toContain("resize-y");

    const errored = render({ multiline: true, label: "Instructions", error: "Required", value: "", onChange: () => {} });
    expect(errored).toContain("Required");
    expect(errored).toContain("ring-1");
  });

  it("still renders a single-line input by default", () => {
    const html = render({ value: "x", onChange: () => {} });
    expect(html).toContain("<input");
    expect(html).toContain('type="text"');
    expect(html).not.toContain("<textarea");
  });
});
