import type { CatalogItem } from './catalog'
import type { User } from './user'

export function calculateTotalCents(items: CatalogItem[], user: User) {
  const subtotal = items.reduce((sum, item) => sum + item.priceCents, 0)
  return subtotal - user.discountPercent
}
