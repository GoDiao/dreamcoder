import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import '@testing-library/jest-dom'
import { ImageGalleryModal } from './ImageGalleryModal'
import { useSettingsStore } from '../../stores/settingsStore'

const settings = useSettingsStore.getState()
afterEach(() => { cleanup(); useSettingsStore.setState(settings, true) })

it.each([['en', 'Previous image', 'Next image'], ['zh', '上一张图片', '下一张图片']] as const)('keeps gallery navigation and thumbnails accessible in %s', (locale, previous, next) => {
  useSettingsStore.setState({ locale })
  const onSelect = vi.fn()
  render(<ImageGalleryModal open images={[{ name: 'First', src: '/one.png' }, { name: 'Second', src: '/two.png' }]} activeIndex={0} onClose={() => {}} onSelect={onSelect} />)
  expect(screen.getByRole('dialog', { name: 'First' })).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: previous }))
  expect(onSelect).toHaveBeenLastCalledWith(1)
  fireEvent.click(screen.getByRole('button', { name: next }))
  expect(onSelect).toHaveBeenLastCalledWith(1)
  const thumbnail = screen.getByRole('button', { name: 'First' })
  expect(thumbnail).toHaveAttribute('aria-pressed', 'true')
  fireEvent.keyDown(document, { key: 'ArrowLeft' })
  expect(onSelect).toHaveBeenLastCalledWith(1)
})
