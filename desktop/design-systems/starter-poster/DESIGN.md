# Design System: Poster

> Category: Bold & Expressive
> Cream paper, heavy black outlines, hard offset shadows and a loud orange accent for campaigns, events and bold portfolios.

## 1. Visual Theme & Atmosphere

Cream paper, heavy black outlines, hard offset shadows and a loud orange accent for campaigns, events and bold portfolios.

- **Mood:** loud and confident
- **Visual style:** bold, graphic, high contrast
- **Color stance:** cream paper, black ink, one loud accent
- **Best for:** campaigns, events, launches, expressive portfolios

## 2. Color

- **Background:** `#fff8e1` (`--bg`): the page.
- **Surface:** `#ffffff` (`--surface`): cards and lifted containers; `#ffe9a8` (`--surface-warm`) is the third tier.
- **Text:** `#111111` (`--fg`), `#2b2b2b` (`--fg-2`) for secondary text, `#5c5c5c` (`--muted`) for captions, `#7a7a7a` (`--meta`) for metadata.
- **Border:** `#111111` (`--border`), `#d8cfa9` (`--border-soft`) for inner separators.
- **Accent:** `#ff4d00` (`--accent`) with `#111111` (`--accent-on`) on top of it.
- **State:** success `#00a86b`, warning `#ffb000`, danger `#e00000`.

- Use the accent for the primary action and one highlight per screen.
- Never write a color value in a page: take it from `var(--*)` in `tokens.css`.

## 3. Typography

- **Display:** "Arial Black", "Helvetica Neue", Impact, sans-serif
- **Body:** "Helvetica Neue", Arial, system-ui, sans-serif
- **Mono:** ui-monospace, "SF Mono", Menlo, monospace
- **Scale:** 12px / 14px / 17px / 20px / 28px / 44px / 72px / 112px (`--text-xs` to `--text-4xl`)
- **Line height:** body 1.5, headings 0.98; display tracking -0.03em.
- Headlines in the heavy display stack, all caps allowed, tight leading (0.98). Body in the plain sans at 17px. Keep headlines short.

## 4. Spacing & Grid

- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 48 (`--space-1` to `--space-12`).
- **Sections:** 96px vertical padding on desktop, 64px on tablet, 44px on phone.
- **Container:** 1240px wide with 40px, 28px and 16px side gutters.

## 5. Layout & Composition

- One idea per section; headline, support text, then the action.
- Separate groups with space first, borders second, shadows last.
- Radii: 0px for controls, 2px for cards, 6px for featured containers (`--radius-sm`, `--radius-md`, `--radius-lg`).

## 6. Components

- Every box has a 2px black border and the hard offset shadow; buttons press down by moving the shadow. The primary button is the orange fill with black text. No rounded corners beyond 6px.
- Inputs have visible labels, a clear focus ring (`--focus-ring`) and plain error text.

## 7. Motion & Interaction

- Snap, not ease: 130ms steps; shadow offset collapses on press.
- Hover, focus-visible, active and disabled states must all exist.

## 8. Voice & Brand

- Short imperatives and big claims. One idea per headline.

## 9. Anti-patterns

- Do not soften shadows with blur.
- Do not use more than one accent color.
- Do not set long paragraphs in the display face.
- Do not introduce a color, font or radius that is not in `tokens.css`.
