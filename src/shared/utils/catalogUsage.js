// Shapes the user catalog rules for the dashboard Clear dialog. A rule is
// "bound" when a custom model is pinned to it via catalogRef (source "user") —
// the model's catalog selection, shown as its pattern rather than Automatic.
// Clearing a bound rule resets those models to Automatic, so the dialog needs
// the split up front to show counts and decide what a scope would remove.
//
// Deliberately narrower than "referenced": combos, aliases, mitm targets,
// pricing overrides and capacity lists are not bindings — they keep resolving
// against whatever remains after a clear.

// Case-insensitive `provider|pattern` identity, matching the repository's pin
// matching. Values are not validated here; a junk legacy pin must still count
// as a binding rather than throw.
export function bindingKey(provider, pattern) {
  return `${String(provider || "*").trim().toLowerCase()}|${String(pattern || "").trim().toLowerCase()}`;
}

export function summarizeClearRules(rules, pins) {
  const bound = new Set(
    (pins || []).map((pin) => bindingKey(pin.provider ?? pin.catalogRef?.provider, pin.pattern ?? pin.catalogRef?.pattern)),
  );

  const empty = () => ({ rules: [], bound: [], unbound: [] });
  const summary = { all: empty(), glob: empty(), exact: empty() };

  for (const rule of rules || []) {
    const isBound = bound.has(bindingKey(rule.provider, rule.pattern));
    summary.all.rules.push(rule);
    (isBound ? summary.all.bound : summary.all.unbound).push(rule);
    const bucket = String(rule.pattern || "").includes("*") ? summary.glob : summary.exact;
    bucket.rules.push(rule);
    (isBound ? bucket.bound : bucket.unbound).push(rule);
  }

  return summary;
}

// Rules a scope would remove, given the "also clear bound patterns" choice.
export function clearScopeRules(summary, scope, includeBound) {
  const bucket = summary?.[scope] || summary?.all;
  if (!bucket) return [];
  return includeBound ? bucket.rules : bucket.unbound;
}
