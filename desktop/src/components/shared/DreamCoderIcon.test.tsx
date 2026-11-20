import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import detailedIcon from '../../../electron/build/app-icon-flat.svg'
import smallIcon from '../../../electron/build/app-icon-small.svg'
import { DreamCoderIcon } from './DreamCoderIcon'

function iconSource(size: number) {
  const { container } = render(<DreamCoderIcon size={size} />)
  return container.querySelector('img')?.getAttribute('src') ?? ''
}

describe('DreamCoderIcon', () => {
  it('uses the simplified master at 32px and below', () => {
    expect(iconSource(16)).toBe(smallIcon)
    expect(iconSource(32)).toBe(smallIcon)
  })

  it('uses the detailed master from 40px up', () => {
    expect(iconSource(40)).toBe(detailedIcon)
    expect(iconSource(56)).toBe(detailedIcon)
  })
})
