// Friendly labels for new-thread cwd quick-pick entries, driven by ui_config.cwd_labels (match→label
// regex rules in the SAME language as config.toml's [[cwd_label]]). No boxyard coupling — sesh is
// box-agnostic; the default rule turns a ~/dev box index into "<boxname> <boxid>".

// Apply the cwd_labels rules to one entry. `path` is the entry's ~-path (root + "/" + name); rules
// run in order, first regex MATCH wins; the label template fills {groupName} (named captures),
// {name} (the raw entry name) and {path} (the ~-path). No match → the raw name.
//
// CRITICAL: the rules are authored Go-style `(?P<name>…)`; JS named groups are `(?<name>…)`, so we
// normalize `(?P<` → `(?<` before compiling — otherwise the default box rule won't compile in JS.
export function applyCwdLabel(name, path, rules) {
  for (const rule of rules || []) {
    if (!rule?.match) continue
    let re
    try { re = new RegExp(rule.match.replace(/\(\?P</g, '(?<')) }
    catch { continue } // skip an uncompilable rule (the daemon validates on save; be defensive here)
    const m = path.match(re)
    if (!m) continue
    const groups = m.groups || {}
    return (rule.label || '').replace(/\{(\w+)\}/g, (_, k) =>
      k === 'name' ? name : k === 'path' ? path : (groups[k] ?? ''))
  }
  return name
}

// A friendly header for a cwd root button: "~/mysetup" → "mysetup", "~/dev" → "boxes (~/dev)".
export function rootHeader(root) {
  const base = String(root).replace(/^~\/?/, '') || 'home'
  return base === 'dev' ? `boxes (${root})` : base
}
