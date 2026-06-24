export type CatalogItem = {
  sku: string
  priceCents: number
}

export const catalog: CatalogItem[] = [
  { sku: 'agent-seat', priceCents: 1200 },
  { sku: 'baseline-pack', priceCents: 800 },
]
