# HTML Report Format

The architectural review is rendered as a single self-contained HTML file in the OS temp directory. It must work fully offline: embed CSS in the document and render diagrams with semantic HTML and inline SVG. Do not load remote scripts, styles, fonts, images, or other CDN assets. Escape all repository-derived text before inserting it into HTML.

## Scaffold

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"
    />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Architecture review — {{repo name}}</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; }
      body { margin: 0; background: #fafaf9; color: #0f172a; }
      main { width: min(72rem, calc(100% - 3rem)); margin: 0 auto; padding: 3rem 0; }
      .stack { display: grid; gap: 2.5rem; }
      .card { border: 1px solid #e2e8f0; border-radius: .75rem; background: #fff; padding: 1.25rem; }
      .diagram-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }
      .seam { stroke-dasharray: 4 4; }
      .leak { stroke: #dc2626; }
      .deep { background: #0f172a; color: #fff; }
      @media (max-width: 48rem) { .diagram-grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main class="stack">
      <header>...</header>
      <section id="candidates" class="stack">...</section>
      <section id="top-recommendation">...</section>
    </main>
  </body>
</html>
```

## Header

Repo name, date, and a compact legend: solid box = module, dashed line = seam, red arrow = leakage, thick dark box = deep module. No introduction paragraph — straight into the candidates.

## Candidate card

The diagrams carry the weight. Prose is sparse, plain, and uses the glossary terms (from the `/codebase-design` skill) without ceremony.

Each candidate is one `<article>`:

- **Title** — short, names the deepening (e.g. "Collapse the Order intake pipeline").
- **Badge row** — recommendation strength (`Strong` = emerald, `Worth exploring` = amber, `Speculative` = slate), plus a tag for the dependency category (`in-process`, `local-substitutable`, `ports & adapters`, `mock`).
- **Files** — monospaced list using a local CSS class.
- **Before / After diagram** — the centrepiece. Two columns, side by side. See patterns below.
- **Problem** — one sentence. What hurts.
- **Solution** — one sentence. What changes.
- **Wins** — bullets, ≤6 words each. e.g. "Tests hit one interface", "Pricing logic stops leaking", "Delete 4 shallow wrappers".
- **ADR callout** (if applicable) — one line in an amber-tinted box.

No paragraphs of explanation. If the diagram needs a paragraph to be understood, redraw the diagram.

## Diagram patterns

Pick the pattern that fits the candidate. Mix them. Don't make every diagram look the same — variety is part of the point.

### Inline SVG graph (the workhorse for dependencies / call flow)

Use an accessible inline `<svg>` when the point is "X calls Y calls Z, and look at the mess." Include a `<title>` and `<desc>`, define reusable arrow markers, and colour leakage edges red and the deep module dark. A static sequence-style SVG works well for "before: 6 round-trips; after: 1."

```html
<div class="card">
  <svg viewBox="0 0 640 220" role="img" aria-labelledby="graph-title graph-desc">
    <title id="graph-title">Order intake call graph</title>
    <desc id="graph-desc">OrderHandler calls OrderValidator and OrderRepo; pricing leaks across the repository seam.</desc>
    <!-- Rectangles, labels, paths, and arrow markers are all inline. -->
  </svg>
</div>
```

### Hand-built boxes-and-arrows

Modules as `<div>`s with borders and labels. Arrows as inline SVG `<line>` or `<path>` elements positioned absolutely over a relative container. Reach for this when you want the "after" diagram to feel like one thick-bordered deep module with greyed-out internals.

### Cross-section (good for layered shallowness)

Stack horizontal bands (`h-12 border-l-4`) to show layers a call passes through. Before: 6 thin layers each doing nothing. After: 1 thick band labelled with the consolidated responsibility.

### Mass diagram (good for "interface as wide as implementation")

Two rectangles per module — one for interface surface area, one for implementation. Before: interface rectangle is nearly as tall as the implementation rectangle (shallow). After: interface rectangle is short, implementation rectangle is tall (deep).

### Call-graph collapse

Before: a tree of function calls rendered as nested boxes. After: the same tree collapsed into one box, with the now-internal calls shown faded inside it.

## Style guidance

- Lean editorial, not corporate-dashboard. Generous whitespace. Use the system font stack; a local serif stack is optional for headings.
- Colour sparingly: one accent (emerald or indigo) plus red for leakage and amber for warnings.
- Keep diagrams ~320px tall so before/after sits comfortably side by side without scrolling.
- Use small uppercase labels with wider letter spacing inside diagrams — they should read as schematic, not as UI.
- Include no scripts. The report is static, offline, and constrained by its Content Security Policy.

## Top recommendation section

One larger card. Candidate name, one sentence on why, anchor link to its card. That's it.

## Tone

Plain English, concise — but the architectural nouns and verbs come straight from the `/codebase-design` skill. Concision is not an excuse to drift.

**Use exactly:** module, interface, implementation, depth, deep, shallow, seam, adapter, leverage, locality.

**Never substitute:** component, service, unit (for module) · API, signature (for interface) · boundary (for seam) · layer, wrapper (for module, when you mean module).

**Phrasings that fit the style:**

- "Order intake module is shallow — interface nearly matches the implementation."
- "Pricing leaks across the seam."
- "Deepen: one interface, one place to test."
- "Two adapters justify the seam: HTTP in prod, in-memory in tests."

**Wins bullets** name the gain in glossary terms: *"locality: bugs concentrate in one module"*, *"leverage: one interface, N call sites"*, *"interface shrinks; implementation absorbs the wrappers"*. Don't write *"easier to maintain"* or *"cleaner code"* — those terms aren't in the glossary and don't earn their place.

No hedging, no throat-clearing, no "it's worth noting that…". If a sentence could be a bullet, make it a bullet. If a bullet could be cut, cut it. If a term isn't in the `/codebase-design` glossary, reach for one that is before inventing a new one.
