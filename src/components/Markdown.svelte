<script>
  // Render Markdown (GFM) for chat/transcript bubbles. marked ESCAPES raw HTML by default, so the
  // {@html} output is safe without a sanitizer (we never enable `html`). If raw HTML is ever enabled,
  // pipe through DOMPurify first.
  import { marked } from 'marked'

  let { text = '' } = $props()
  let html = $derived(marked.parse(text || '', { gfm: true, breaks: true }))
</script>

<div class="md">{@html html}</div>

<style>
  .md { white-space: normal; word-break: break-word; }
  .md :global(> :first-child) { margin-top: 0; }
  .md :global(> :last-child) { margin-bottom: 0; }
  .md :global(p) { margin: 0 0 0.5em; }
  .md :global(a) { color: #7aa2f7; }
  .md :global(code) { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.92em;
    background: #0b0c12; padding: 1px 4px; border-radius: 4px; }
  .md :global(pre) { background: #0b0c12; border: 1px solid #232433; border-radius: 7px;
    padding: 9px 11px; overflow-x: auto; margin: 0.5em 0; }
  .md :global(pre code) { background: none; padding: 0; font-size: 0.88em; }
  .md :global(ul), .md :global(ol) { margin: 0.35em 0; padding-left: 1.4em; }
  .md :global(li) { margin: 0.15em 0; }
  .md :global(h1), .md :global(h2), .md :global(h3), .md :global(h4) { font-size: 1.08em; font-weight: 600; margin: 0.6em 0 0.3em; }
  .md :global(blockquote) { border-left: 2px solid #565f89; margin: 0.4em 0; padding-left: 9px; color: #9aa5ce; }
  .md :global(table) { border-collapse: collapse; margin: 0.4em 0; }
  .md :global(th), .md :global(td) { border: 1px solid #2a2b3d; padding: 3px 8px; }
  .md :global(img) { max-width: 100%; border-radius: 6px; }
  .md :global(hr) { border: 0; border-top: 1px solid #2a2b3d; margin: 0.6em 0; }
</style>
