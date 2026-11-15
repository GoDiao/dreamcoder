export function getPathParts(path: string) {
  const segments = path.split('/').filter(Boolean)
  const name = segments.pop() ?? path
  return { name, dir: `${path.startsWith('/') && segments.length > 0 ? '/' : ''}${segments.join('/')}` }
}
