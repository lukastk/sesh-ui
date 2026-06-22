// Subsequence fuzzy match shared by the fzf-style filters (threads, tickets). The query's chars
// must appear in order anywhere in the text; an earlier first-hit and tighter gaps rank higher.
// Returns a score (lower = better) or null for no match. Empty query → 0 (everything matches).
export function fuzzyScore(query, text) {
  const q = (query || '').trim().toLowerCase()
  if (!q) return 0
  const t = (text || '').toLowerCase()
  let ti = 0, first = -1, gaps = 0
  for (const ch of q) {
    const idx = t.indexOf(ch, ti)
    if (idx < 0) return null
    if (first < 0) first = idx
    if (ti > 0 && idx > ti) gaps += idx - ti
    ti = idx + 1
  }
  return first + gaps
}
