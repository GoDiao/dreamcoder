export function slugify(input: string) {
  return input.toLowerCase().replaceAll(' ', '-')
}
