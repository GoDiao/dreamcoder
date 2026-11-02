# Design System: Office

> Category: Professional & Corporate
> Cool grey neutrals, a steady blue accent, compact type and small radii for business software, reports and internal tools.

## 1. Visual Theme & Atmosphere

Cool grey neutrals, a steady blue accent, compact type and small radii for business software, reports and internal tools.

- **Mood:** steady and trustworthy
- **Visual style:** clean, compact, neutral
- **Color stance:** white cards on a cool grey page
- **Best for:** business software, reports, admin and internal tools

## 2. Color

- **Background:** `#f5f7fa` (`--bg`): the page.
- **Surface:** `#ffffff` (`--surface`): cards and lifted containers; `#eaeff6` (`--surface-warm`) is the third tier.
- **Text:** `#0f172a` (`--fg`), `#334155` (`--fg-2`) for secondary text, `#64748b` (`--muted`) for captions, `#94a3b8` (`--meta`) for metadata.
- **Border:** `#d5dce6` (`--border`), `#e6ebf2` (`--border-soft`) for inner separators.
- **Accent:** `#1d4ed8` (`--accent`) with `#ffffff` (`--accent-on`) on top of it.
- **State:** success `#15803d`, warning `#b45309`, danger `#b91c1c`.

- Use the accent for the primary action and one highlight per screen.
- Never write a color value in a page: take it from `var(--*)` in `tokens.css`.

## 3. Typography

- **Display:** "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif
- **Body:** "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif
- **Mono:** ui-monospace, "SF Mono", Menlo, monospace
- **Scale:** 11px / 12px / 14px / 16px / 20px / 26px / 34px / 46px (`--text-xs` to `--text-4xl`)
- **Line height:** body 1.5, headings 1.15; display tracking -0.01em.
- System sans at 14px for body, 12px for table headers in uppercase with letter spacing. Headlines are semibold, never display weights.

## 4. Spacing & Grid

- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 48 (`--space-1` to `--space-12`).
- **Sections:** 72px vertical padding on desktop, 52px on tablet, 36px on phone.
- **Container:** 1120px wide with 32px, 24px and 16px side gutters.

## 5. Layout & Composition

- One idea per section; headline, support text, then the action.
- Separate groups with space first, borders second, shadows last.
- Radii: 4px for controls, 6px for cards, 10px for featured containers (`--radius-sm`, `--radius-md`, `--radius-lg`).

## 6. Components

- Buttons have a 6px radius; the primary is the blue fill. Tables use 1px row borders, zebra striping is off. Form fields are 36px high with visible labels above.
- Inputs have visible labels, a clear focus ring (`--focus-ring`) and plain error text.

## 7. Motion & Interaction

- Color transitions only, 130ms. No decorative animation.
- Hover, focus-visible, active and disabled states must all exist.

## 8. Voice & Brand

- Neutral and exact. Use the product nouns the user knows; avoid exclamation marks.

## 9. Anti-patterns

- Do not use more than two weights on one screen.
- Do not rely on color alone for status.
- Do not use shadows to separate rows.
- Do not introduce a color, font or radius that is not in `tokens.css`.
