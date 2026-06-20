// Per-agent model-name HINTS for the model pickers. The model field is FREE-TEXT pass-through —
// any string the agent accepts is allowed (no client-side restriction). These just seed a <datalist>
// of common aliases for convenience. There is no daemon endpoint to enumerate models (pi's
// `--list-models` is a local CLI, not exposed on the HTTP API), so these are a small curated set;
// the user can always type anything else.
export const MODEL_SUGGESTIONS = {
  pi: ['opus', 'sonnet', 'haiku', 'claude-opus-4-8', 'claude-sonnet-4-6', 'gpt-5.5'],
  claude: ['opus', 'sonnet', 'haiku', 'opusplan'],
  codex: ['gpt-5.5', 'gpt-5', 'o3', 'o4-mini'],
}

export const modelSuggestions = (agent) => MODEL_SUGGESTIONS[agent] || []
