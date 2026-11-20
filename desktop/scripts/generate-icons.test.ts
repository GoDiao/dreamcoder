import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { Resvg } from '@resvg/resvg-js'
import { describe, expect, it } from 'vitest'

import { onMacGrid, packIco, pixelTile, render, tileOnly } from './generate-icons'

const buildDir = path.resolve(import.meta.dirname, '..', 'electron', 'build')
const master = (name: string) => readFileSync(path.join(buildDir, name), 'utf8')

function pngSize(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength)
  return [view.getUint32(16), view.getUint32(20)]
}

function alphaAt(svg: string, size: number, x: number, y: number) {
  const pixels = new Uint8Array(new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().pixels)
  return pixels[(y * size + x) * 4 + 3]
}

describe('generate-icons', () => {
  it('packs PNG images into an ICO directory with 256 stored as 0', () => {
    const images = [16, 256].map((size) => ({ size, png: render(master('app-icon-small.svg'), size) }))
    const ico = packIco(images)
    const view = new DataView(ico.buffer)
    expect(view.getUint16(2, true)).toBe(1)
    expect(view.getUint16(4, true)).toBe(2)
    expect(view.getUint8(6)).toBe(16)
    expect(view.getUint8(22)).toBe(0)
    images.forEach((image, index) => {
      const entry = 6 + index * 16
      const length = view.getUint32(entry + 8, true)
      const offset = view.getUint32(entry + 12, true)
      expect(length).toBe(image.png.length)
      expect(ico.slice(offset, offset + length)).toEqual(new Uint8Array(image.png))
    })
  })

  it('sizes the macOS grid tile to the nearest whole pixels that keep it centred', () => {
    expect(pixelTile(16)).toEqual({ tile: 12, offset: 2 })
    expect(pixelTile(32)).toEqual({ tile: 26, offset: 3 })
    expect(pixelTile(64)).toEqual({ tile: 52, offset: 6 })
  })

  it('places the simplified master inside the macOS icon grid with sharp tile edges', () => {
    for (const pixels of [16, 32, 64]) {
      const grid = onMacGrid(master('app-icon-small.svg'), pixels)
      const { tile, offset } = pixelTile(pixels)
      const middle = Math.floor(pixels / 2)
      expect(pngSize(render(grid, pixels))).toEqual([pixels, pixels])
      expect(alphaAt(grid, pixels, offset - 1, middle)).toBe(0)
      expect(alphaAt(grid, pixels, offset, middle)).toBe(255)
      expect(alphaAt(grid, pixels, offset + tile - 1, middle)).toBe(255)
      expect(alphaAt(grid, pixels, offset + tile, middle)).toBe(0)
      expect(alphaAt(grid, pixels, middle, offset - 1)).toBe(0)
      expect(alphaAt(grid, pixels, middle, offset)).toBe(255)
    }
  })

  it('crops the finished master to its tile without the drop shadow', () => {
    const tile = tileOnly(master('app-icon.svg'))
    expect(alphaAt(tile, 103, 51, 51)).toBe(255)
    expect(alphaAt(tile, 103, 0, 102)).toBe(0)
  })

  it('ships every tray image the app loads', () => {
    for (const name of ['tray.png', 'tray@2x.png', 'trayTemplate.png', 'trayTemplate@2x.png']) {
      expect(existsSync(path.join(buildDir, 'icons', name))).toBe(true)
    }
  })
})
