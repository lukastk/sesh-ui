// Per-agent transcript JSONL → normalized bubbles {role, text, thinking}. The three agents
// each write a DIFFERENT JSONL schema, so there's a typed parser per agent_kind with a raw
// skip for anything unrecognized. Shared by HeadlessChat (its source of truth) and RpcChat
// (its history + reconciliation backbone). A normalized sesh-side chat stream would replace
// all three (PLAN backlog) — until then this is the ONE place the schemas are decoded.

function mk(role, text, thinking) {
  if (!text && !thinking) return null
  return { role, text: text || '', thinking: thinking || '' }
}

const PARSERS = {
  // pi: {type:"message", message:{role, content:[{type:"text"|"thinking", text/thinking}]}}
  pi(o) {
    if (o.type !== 'message' || !o.message) return null
    const c = o.message.content || []
    return mk(o.message.role,
      c.filter((x) => x.type === 'text').map((x) => x.text).join('\n'),
      c.filter((x) => x.type === 'thinking').map((x) => x.thinking).join('\n'))
  },
  // claude: {type:"user"|"assistant", message:{role, content: string | [{type:"text",text}]}}
  claude(o) {
    // A message SENT WHILE CLAUDE IS MID-TURN is queued, recorded as
    // {type:"queue-operation", operation:"enqueue", content:"<text>"} — NOT a normal user
    // turn (claude consumes the enqueue when it processes the message and writes no separate
    // user entry). Without this, a queued send is invisible in the transcript view even though
    // the agent received and answered it. Render the enqueue as the user's message.
    if (o.type === 'queue-operation') {
      return o.operation === 'enqueue' && typeof o.content === 'string' ? mk('user', o.content) : null
    }
    if (o.type !== 'user' && o.type !== 'assistant') return null
    const content = o.message?.content
    if (typeof content === 'string') return mk(o.message.role, content)
    const arr = content || []
    return mk(o.message?.role,
      arr.filter((x) => x.type === 'text').map((x) => x.text).join('\n'),
      arr.filter((x) => x.type === 'thinking').map((x) => x.thinking).join('\n'))
  },
  // codex: {type:"response_item", payload:{type:"message", role, content:[{type:"input_text"|"output_text", text}]}}
  codex(o) {
    if (o.type !== 'response_item' || o.payload?.type !== 'message') return null
    const role = o.payload.role
    if (role !== 'user' && role !== 'assistant') return null
    const text = (o.payload.content || [])
      .filter((x) => x.type === 'input_text' || x.type === 'output_text').map((x) => x.text).join('\n')
    if (role === 'user' && /^\s*<(environment_context|permissions)/.test(text)) return null
    return mk(role, text)
  },
}

// Parse transcript JSONL lines into normalized {role, text, thinking} bubbles for the agent.
export function parseTranscript(lines, agentKind = 'pi') {
  const p = PARSERS[agentKind] || PARSERS.pi
  const out = []
  for (const raw of lines || []) {
    let o
    try { o = JSON.parse(raw) } catch { continue }
    const m = p(o)
    if (m) out.push(m)
  }
  return out
}
