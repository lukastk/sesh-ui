// Friendly labels for new-thread cwd quick-pick entries. PURE string parse — no boxyard dependency.
// ~/dev box dirs are indices like `20260620_tbmxs5__pi-rpc-set-model` (8-digit date + "_" + short id
// + "__" + slug); for those the label is the slug (last "__" segment) with the raw index as a
// subtitle. Anything that doesn't match the index pattern (~/mysetup repos, ".claude", …) shows raw.
const BOX_INDEX = /^\d{8}_[a-z0-9]+__.+/i

export function dirLabel(name) {
  if (BOX_INDEX.test(name)) return { label: name.split('__').pop(), sub: name }
  return { label: name, sub: null }
}

// A friendly header for a cwd root: "~/mysetup" → "mysetup", "~/dev" → "boxes (~/dev)".
export function rootHeader(root) {
  const base = String(root).replace(/^~\/?/, '') || 'home'
  return base === 'dev' ? `boxes (${root})` : base
}
