import { describe, it, expect } from "vitest";
import {
  buildUsedFormSet,
  flattenReferenceMap,
  pricingTableForms,
  capacityAdapterForms,
  isRowUsed,
  partitionRowsByUsage,
} from "../../src/shared/utils/modelUsage.js";

const rows = [
  { id: "a" },
  { id: "b" },
  { id: "c" },
  { id: "d" },
];
const forms = (row) => [`prov/${row.id}`, `alias/${row.id}`];

describe("modelUsage", () => {
  it("marks rows used by combos, aliases, mitm, pricing, capacity and disabled", () => {
    const used = buildUsedFormSet({
      combos: [{ models: ["prov/a", "other/x"] }],
      aliasTargets: ["prov/b"],
      mitmTargets: ["alias/c"],
      pricingForms: ["prov/d"],
      capacityForms: [],
      disabledForms: [],
    });
    const { used: usedRows, unused } = partitionRowsByUsage(rows, forms, used);
    expect(usedRows.map((r) => r.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(unused).toEqual([]);
  });

  it("leaves unreferenced rows unused", () => {
    const used = buildUsedFormSet({
      combos: [{ models: ["prov/a"] }],
      aliasTargets: [],
      mitmTargets: [],
      pricingForms: [],
      capacityForms: [],
      disabledForms: ["prov/b"],
    });
    expect(isRowUsed(forms(rows[0]), used)).toBe(true);
    expect(isRowUsed(forms(rows[1]), used)).toBe(true);
    expect(isRowUsed(forms(rows[2]), used)).toBe(false);
    const { used: usedRows, unused } = partitionRowsByUsage(rows, forms, used);
    expect(usedRows.map((r) => r.id)).toEqual(["a", "b"]);
    expect(unused.map((r) => r.id)).toEqual(["c", "d"]);
  });

  it("flattens nested reference maps and pricing/capacity shapes", () => {
    expect(flattenReferenceMap({ tool: { from: "prov/a" }, empty: {} })).toEqual(["prov/a"]);
    expect(flattenReferenceMap(null)).toEqual([]);
    expect(pricingTableForms({ prov: { a: { input: 1 } } })).toEqual(["prov/a"]);
    expect(capacityAdapterForms({ vision: { models: ["prov/a"] }, pdf: {} })).toEqual(["prov/a"]);
    expect(capacityAdapterForms(null)).toEqual([]);
  });
});
