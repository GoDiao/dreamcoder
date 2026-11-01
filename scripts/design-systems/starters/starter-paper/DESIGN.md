# Design System: Paper

> Category: Editorial
> Warm off-white pages, serif headlines and a single terracotta accent for reading-first articles, portfolios and newsletters.

## 1. Visual Theme & Atmosphere

Warm off-white pages, serif headlines and a single terracotta accent for reading-first articles, portfolios and newsletters.

- **Mood:** quiet and literate
- **Visual style:** editorial, warm, restrained
- **Color stance:** paper surfaces with one accent
- **Best for:** long-form reading, essays, portfolios, newsletters

## 2. Color

- **Background:** `#faf6ee` (`--bg`): the page.
- **Surface:** `#fffdf8` (`--surface`): cards and lifted containers; `#f1eadb` (`--surface-warm`) is the third tier.
- **Text:** `#1f1b16` (`--fg`), `#4a4339` (`--fg-2`) for secondary text, `#7b7266` (`--muted`) for captions, `#9a8f80` (`--meta`) for metadata.
- **Border:** `#dcd3c2` (`--border`), `#ebe4d5` (`--border-soft`) for inner separators.
- **Accent:** `#b4492c` (`--accent`) with `#fffdf8` (`--accent-on`) on top of it.
- **State:** success `#3f7d4e`, warning `#b7791f`, danger `#b3261e`.

- Use the accent for the primary action and one highlight per screen.
- Never write a color value in a page: take it from `var(--*)` in `tokens.css`.

## 3. Typography

- **Display:** "Iowan Old Style", "Palatino Linotype", Georgia, serif
- **Body:** Charter, "Iowan Old Style", Georgia, serif
- **Mono:** ui-monospace, "SF Mono", Menlo, monospace
- **Scale:** 12px / 14px / 17px / 20px / 26px / 36px / 52px / 72px (`--text-xs` to `--text-4xl`)
- **Line height:** body 1.65, headings 1.12; display tracking -0.015em.
- Headlines in the serif display stack, body in the same serif family at 17px with a 1.65 line height. Use italics for emphasis, small caps for labels.

## 4. Spacing & Grid

- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 48 (`--space-1` to `--space-12`).
- **Sections:** 88px vertical padding on desktop, 64px on tablet, 44px on phone.
- **Container:** 720px wide with 32px, 24px and 16px side gutters.

## 5. Layout & Composition

- One idea per section; headline, support text, then the action.
- Separate groups with space first, borders second, shadows last.
- Radii: 2px for controls, 4px for cards, 8px for featured containers (`--radius-sm`, `--radius-md`, `--radius-lg`).

## 6. Components

- Buttons are flat rectangles with a 2px radius; the primary uses the accent fill. Cards are the surface color with a hairline border, no shadow. Links are underlined in the accent color.
- Inputs have visible labels, a clear focus ring (`--focus-ring`) and plain error text.

## 7. Motion & Interaction

- Fade and 2px translate only, 130–220ms. No bouncing or parallax.
- Hover, focus-visible, active and disabled states must all exist.

## 8. Voice & Brand

- Plain, first person, short sentences. Titles are statements, not slogans.

## 9. Anti-patterns

- Do not use more than one accent color.
- Do not set body copy in a sans-serif next to a serif headline.
- Do not add gradients or glossy shadows.
- Do not introduce a color, font or radius that is not in `tokens.css`.
