// threadView — a client-side evaluator for the `sesh tui` "view" predicate language, so the Threads
// screen can offer the same saved Tab-cycle filters as `[[tui.views]]` in ~/.sesh/config.toml.
//
// WHY here and not from the daemon: sesh-ui is a pure client and the daemon does NOT expose
// config.toml's `[[tui.views]]` over its API (it owns naming/routing/state, not arbitrary config
// readout). So views are defined + persisted in the UI (localStorage). The two DEFAULT_VIEWS mirror
// the examples shipped in the sample config; reading the user's OWN config views would need a sesh
// API addition (e.g. surfacing tui.views via /v1/ui-config) — see the note reported to the orchestrator.
//
// Grammar (mirrors sesh's tui selectors/atoms):
//   atoms:    headful headless busy idle attached detached archived ticketed
//   fields:   head busy attachment archived tickets agent machine name cwd id tags
//   compare:  <field> = <value> | != | ~ (contains) | !~       (case-insensitive)
//   boolean:  and / or / not / ( … )    (a bare field is truthy: `tags`, `tickets`)

const ATOMS = {
  headful:  (r) => r.head === 'headful',
  headless: (r) => r.head === 'headless',
  busy:     (r) => r.busy === 'busy',
  idle:     (r) => r.busy === 'idle',
  attached: (r) => r.attachment === 'attached',
  detached: (r) => r.attachment === 'detached',
  archived: (r) => !!r.archived,
  ticketed: (r) => (r.tickets_open || 0) > 0,
}

const FIELDS = {
  head:       (r) => r.head,
  busy:       (r) => r.busy,
  attachment: (r) => r.attachment,
  archived:   (r) => (r.archived ? 'archived' : ''),
  tickets:    (r) => String(r.tickets_open || 0),
  agent:      (r) => r.agent_kind,
  machine:    (r) => r.machine,
  name:       (r) => r.name || '',
  cwd:        (r) => r.cwd_rel || r.cwd || '',
  id:         (r) => r.id || '',
  tags:       (r) => r.tags || [],
}

export const VIEW_ATOMS = Object.keys(ATOMS)
export const VIEW_FIELDS = Object.keys(FIELDS)

// Tokenize: the comparison operators, parens, or a bare word/value (no whitespace, paren or op chars).
function tokenize(s) {
  const re = /\s*(!=|!~|=|~|\(|\)|[^\s()=~!]+)/g
  const toks = []
  let m
  while ((m = re.exec(s)) !== null) toks.push(m[1])
  return toks
}

// Compile <field> <op> <value> into a row predicate. Arrays (tags): positive ops = "any matches",
// negative ops = "none matches".
function makeCompare(key, op, val) {
  const get = FIELDS[key]
  const needle = val.toLowerCase()
  const positive = op === '=' || op === '~'
  const contains = op === '~' || op === '!~'
  const matchOne = (hay) => {
    const h = String(hay).toLowerCase()
    return contains ? h.includes(needle) : h === needle
  }
  return (row) => {
    const v = get(row)
    const any = Array.isArray(v) ? v.some(matchOne) : matchOne(v)
    return positive ? any : !any
  }
}

// Recursive-descent parser → a (row) => boolean. Throws on a malformed filter (loud, caught by the UI).
function parse(toks) {
  let i = 0
  const peek = () => toks[i]
  const next = () => toks[i++]
  const lc = (t) => (t || '').toLowerCase()

  const parseExpr = () => parseOr()
  function parseOr() {
    let left = parseAnd()
    while (lc(peek()) === 'or') { next(); const r = parseAnd(), l = left; left = (row) => l(row) || r(row) }
    return left
  }
  function parseAnd() {
    let left = parseNot()
    while (lc(peek()) === 'and') { next(); const r = parseNot(), l = left; left = (row) => l(row) && r(row) }
    return left
  }
  function parseNot() {
    if (lc(peek()) === 'not') { next(); const inner = parseNot(); return (row) => !inner(row) }
    return parsePrimary()
  }
  function parsePrimary() {
    const t = peek()
    if (t === '(') { next(); const e = parseExpr(); if (peek() !== ')') throw new Error('expected )'); next(); return e }
    if (t === undefined) throw new Error('unexpected end of filter')
    const word = next()
    const key = lc(word)
    const op = peek()
    if (op === '=' || op === '!=' || op === '~' || op === '!~') {
      next()
      const val = next()
      if (val === undefined) throw new Error(`expected a value after "${op}"`)
      if (!(key in FIELDS)) throw new Error(`unknown field "${word}"`)
      return makeCompare(key, op, val)
    }
    if (key in ATOMS) return ATOMS[key]
    if (key in FIELDS) { const get = FIELDS[key]; return (row) => { const v = get(row); return Array.isArray(v) ? v.length > 0 : !!v && v !== '0' } }
    throw new Error(`unknown term "${word}"`)
  }

  const fn = parseExpr()
  if (i < toks.length) throw new Error(`unexpected "${toks[i]}"`)
  return fn
}

// Compile a filter string → { ok:true, fn } or { ok:false, error }. Never throws.
export function compileView(filter) {
  try {
    const toks = tokenize(filter || '')
    if (!toks.length) throw new Error('empty filter')
    return { ok: true, fn: parse(toks) }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
}

// Mirror the two examples from the sample [[tui.views]] config.
export const DEFAULT_VIEWS = [
  { name: 'ticketed', filter: 'ticketed and not archived' },
  { name: 'unticketed', filter: 'not ticketed and not archived' },
]
