import { getPathParts } from '../../lib/pathParts'

export function FilePathLabel({ path }: { path: string }) {
  const { name, dir } = getPathParts(path)
  return (
    <span className="min-w-0 flex-1 truncate">
      <span>{name}</span>
      {dir && <span className="ml-1.5 text-2xs text-subtle-foreground">{dir}</span>}
    </span>
  )
}
