import { useMemo } from 'react'
import { parseDiffFromFile } from '@pierre/diffs'
import { useUIStore } from '../../stores/uiStore'
import { PierreDiffSurface } from '../shared/PierreDiffSurface'

type Props = { filePath: string; oldString: string; newString: string }

export default function DiffViewerBody({ filePath, oldString, newString }: Props) {
  const theme = useUIStore((state) => state.theme)
  const fileDiff = useMemo(() => parseDiffFromFile(
    { name: filePath, contents: oldString },
    { name: filePath, contents: newString },
  ), [filePath, oldString, newString])
  return <PierreDiffSurface fileDiff={fileDiff} theme={theme} />
}
