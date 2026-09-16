// Decides whether a user-defined model catalog rule is still referenced.
// A rule is USED when a custom model pins it via catalogRef, or when its
// provider scope + pattern matches any "provider/model" form referenced by
// combos, aliases, mitm targets, pricing overrides, capacity lists or
// disabled entries. Forms stored under a custom node's display prefix are
// canonicalized to the node id first, since rule providers are node ids.
import { matchCatalogPattern } from "@/lib/modelCatalog/resolution.js";
import { flattenReferenceMap, pricingTableForms, capacityAdapterForms } from "./modelUsage.js";

export function collectCatalogForms(usage) {
  const prefixToId = new Map();
  for (const node of usage?.nodes || []) {
    if (node?.prefix && node?.id) {
      prefixToId.set(String(node.prefix).toLowerCase(), String(node.id).toLowerCase());
    }
  }
  const forms = new Set();
  const add = (raw) => {
    if (typeof raw !== "string" || !raw.includes("/")) return;
    const separator = raw.indexOf("/");
    const rawProvider = raw.slice(0, separator).toLowerCase();
    const model = raw.slice(separator + 1);
    if (!model) return;
    forms.add(`${prefixToId.get(rawProvider) || rawProvider}/${model}`);
  };
  for (const combo of usage?.combos || []) {
    for (const member of combo?.models || []) add(member);
  }
  for (const target of usage?.aliasTargets || []) add(target);
  for (const target of flattenReferenceMap(usage?.mitmAlias)) add(target);
  for (const form of pricingTableForms(usage?.userPricing)) add(form);
  for (const form of capacityAdapterForms(usage?.capacityAdapter)) add(form);
  for (const [provider, ids] of Object.entries(usage?.disabled || {})) {
    for (const id of ids || []) add(`${provider}/${id}`);
  }
  return forms;
}

export function partitionCatalogRules(rules, usage) {
  const pins = new Set(
    (usage?.customModels || []).map(
      (pin) => `${String(pin.provider || "*").toLowerCase()}|${String(pin.pattern || "").toLowerCase()}`,
    ),
  );
  const forms = [...collectCatalogForms(usage)];
  const used = [];
  const unused = [];
  for (const rule of rules || []) {
    const provider = String(rule.provider || "*").toLowerCase();
    const pattern = String(rule.pattern || "");
    if (pins.has(`${provider}|${pattern.toLowerCase()}`)) {
      used.push(rule);
      continue;
    }
    const referenced = forms.some((form) => {
      const separator = form.indexOf("/");
      if (provider !== "*" && provider !== form.slice(0, separator)) return false;
      const model = form.slice(separator + 1);
      return matchCatalogPattern(pattern, model) || matchCatalogPattern(pattern, form);
    });
    (referenced ? used : unused).push(rule);
  }
  return { used, unused };
}
