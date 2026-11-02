# Design System: Console

> Category: Developer Tools
> Dark graphite surfaces, a teal signal color and monospaced details for developer tools, dashboards and technical docs.

## 1. Visual Theme & Atmosphere

Dark graphite surfaces, a teal signal color and monospaced details for developer tools, dashboards and technical docs.

- **Mood:** precise and calm
- **Visual style:** dark, technical, dense
- **Color stance:** dark layers with a signal accent
- **Best for:** developer tools, dashboards, API and CLI documentation

## 2. Color

- **Background:** `#0d1117` (`--bg`): the page.
- **Surface:** `#161b22` (`--surface`): cards and lifted containers; `#1c232d` (`--surface-warm`) is the third tier.
- **Text:** `#e6edf3` (`--fg`), `#c0cad6` (`--fg-2`) for secondary text, `#8b98a8` (`--muted`) for captions, `#6b7787` (`--meta`) for metadata.
- **Border:** `#2b3440` (`--border`), `#202833` (`--border-soft`) for inner separators.
- **Accent:** `#2dd4bf` (`--accent`) with `#04201c` (`--accent-on`) on top of it.
- **State:** success `#3fb950`, warning `#d29922`, danger `#f85149`.

- Use the accent for the primary action and one highlight per screen.
- Never write a color value in a page: take it from `var(--*)` in `tokens.css`.

## 3. Typography

- **Display:** "Inter", system-ui, -apple-system, "Segoe UI", sans-serif
- **Body:** "Inter", system-ui, -apple-system, "Segoe UI", sans-serif
- **Mono:** "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace
- **Scale:** 11px / 12px / 14px / 16px / 20px / 28px / 40px / 56px (`--text-xs` to `--text-4xl`)
- **Line height:** body 1.5, headings 1.1; display tracking -0.02em.
- Sans-serif for prose and headings, monospace for identifiers, commands, numbers and table cells. Keep body at 14px in dense views.

## 4. Spacing & Grid

- **Spacing scale:** 4, 8, 12, 16, 20, 24, 32, 48 (`--space-1` to `--space-12`).
- **Sections:** 80px vertical padding on desktop, 56px on tablet, 40px on phone.
- **Container:** 1180px wide with 32px, 24px and 16px side gutters.

## 5. Layout & Composition

- One idea per section; headline, support text, then the action.
- Separate groups with space first, borders second, shadows last.
- Radii: 4px for controls, 6px for cards, 10px for featured containers (`--radius-sm`, `--radius-md`, `--radius-lg`).

## 6. Components

- Buttons have a 6px radius; the primary is the teal accent with dark text, secondary is a bordered surface. Panels are stacked surfaces separated by 1px borders. Code blocks use the mono stack on the raised surface.
- Inputs have visible labels, a clear focus ring (`--focus-ring`) and plain error text.

## 7. Motion & Interaction

- Short opacity and color transitions, 130–220ms. Status changes may pulse once.
- Hover, focus-visible, active and disabled states must all exist.

## 8. Voice & Brand

- Direct and technical. Labels name the thing: "Deploy", "Logs", "Retry".

## 9. Anti-patterns

- Do not use pure black or pure white.
- Do not use the accent for large fills.
- Do not mix rounded pill buttons into dense tables.
- Do not introduce a color, font or radius that is not in `tokens.css`.
