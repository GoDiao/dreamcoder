import type { ReadonlyDeep } from 'type-fest'

export type DeepImmutable<T> = ReadonlyDeep<T>

export type Permutations<T, Member = T> = [T] extends [never]
  ? []
  : Member extends Member
    ? [Member, ...Permutations<Exclude<T, Member>>]
    : never
