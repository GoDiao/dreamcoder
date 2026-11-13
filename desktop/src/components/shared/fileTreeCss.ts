export const FILE_TREE_CSS = `
  :host {
    --trees-bg-override: transparent;
    --trees-fg-override: var(--foreground);
    --trees-fg-muted-override: var(--muted-foreground);
    --trees-selected-bg-override: var(--selected);
    --trees-hover-bg-override: var(--hover);
    --trees-border-color-override: var(--border);
    --trees-focus-ring-color-override: var(--ring);
    --trees-font-family-override: var(--font-body);
    --trees-font-size-override: 0.75rem;
    --trees-border-radius-override: 0.375rem;
  }
  [data-truncate-content='visible'] { overflow: hidden; text-overflow: ellipsis; }
  [data-truncate-marker] { display: none; }
`
