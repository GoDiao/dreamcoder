# Design System: Market

> Category: Media & Consumer
> Bright white canvas, a violet accent, large rounded cards and friendly type for consumer apps, shops and landing pages.

## 1. Visual Theme & Atmosphere

Bright white canvas, a violet accent, large rounded cards and friendly type for consumer apps, shops and landing pages.

- **Mood:** friendly and energetic
- **Visual style:** bright, rounded, playful
- **Color stance:** white canvas with tinted surfaces
- **Best for:** consumer apps, shops, product and campaign pages

## 2. Color

- **Background:** `#ffffff` (`--bg`): the page.
- **Surface:** `#f7f5ff` (`--surface`): cards and lifted containers; `#fff4e5` (`--surface-warm`) is the third tier.
- **Text:** `#17142b` (`--fg`), `#3b3558` (`--fg-2`) for secondary text, `#6b6785` (`--muted`) for captions, `#8f8ba8` (`--meta`) for metadata.
- **Border:** `#e3dff5` (`--border`), `#efecfa` (`--border-soft`) for inner separators.
- **Accent:** `#6d3df0` (`--accent`) with `#ffffff` (`--accent-on`) on top of it.
- **State:** success `#12a150`, warning `#e08a00`, danger `#e5384f`.

- Use the accent for the primary action and one highlight per screen.
- Never write a color value in a page: take it from `var(--*)` in `tokens.css`.

## 3. Typography

- **Display:** "Avenir Next", "Segoe UI", system-ui, sans-serif
- **Body:** "Avenir Next", "Segoe UI", system-ui, sans-serif
- **Mono:** ui-monospace, "SF Mono", Menlo, monospace
- **Scale:** 12px / 14px / 16px / 19px / 26px / 36px / 52px / 72px (`--text-xs` to `--text-4xl`)
- **Line height:** body 1.55, headings 1.08; display tracking -0.025em.
- One humanist sans for everything. Headlines are bold with tight tracking; body is regular at 16px. Numbers in prices are bold.

## 4. Spacing & Grid

- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 48 (`--space-1` to `--space-12`).
- **Sections:** 96px vertical padding on desktop, 68px on tablet, 48px on phone.
- **Container:** 1160px wide with 40px, 28px and 16px side gutters.

## 5. Layout & Composition

- One idea per section; headline, support text, then the action.
- Separate groups with space first, borders second, shadows last.
- Radii: 10px for controls, 16px for cards, 28px for featured containers (`--radius-sm`, `--radius-md`, `--radius-lg`).

## 6. Components

- Buttons and chips are pills; the primary is a violet fill with white text. Cards use the tinted surface with a 28px radius and the raised shadow on hover. Icons sit in soft circles.
- Inputs have visible labels, a clear focus ring (`--focus-ring`) and plain error text.

## 7. Motion & Interaction

- Spring-like scale to 1.02 on hover, 220ms. Keep page transitions to fades.
- Hover, focus-visible, active and disabled states must all exist.

## 8. Voice & Brand

- Warm and short. Address the reader as "you". Buttons say what happens next.

## 9. Anti-patterns

- Do not use the violet on text smaller than 14px without checking contrast.
- Do not stack more than two tinted surfaces.
- Do not use sharp corners.
- Do not introduce a color, font or radius that is not in `tokens.css`.
