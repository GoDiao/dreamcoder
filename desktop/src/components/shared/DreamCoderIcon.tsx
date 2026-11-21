import detailedIcon from '../../../electron/build/app-icon-tile.svg'
import smallIcon from '../../../electron/build/app-icon-small.svg'

const DETAIL_MIN = 40

export function DreamCoderIcon({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src={size >= DETAIL_MIN ? detailedIcon : smallIcon}
      width={size}
      height={size}
      className={className}
      style={{ flexShrink: 0 }}
      alt=""
      draggable={false}
    />
  )
}
