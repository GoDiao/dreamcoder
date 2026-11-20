import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Resvg } from '@resvg/resvg-js'

export type IconImage = { size: number; png: Uint8Array }

const desktopRoot = path.resolve(import.meta.dirname, '..')
const buildDir = path.join(desktopRoot, 'electron', 'build')
const iconsDir = path.join(buildDir, 'icons')

const MAC_TILE = { offset: 100, size: 824, canvas: 1024, radius: 185 }
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICO_SMALL_MAX = 32
const ICONSET: Array<{ name: string; size: number; small: boolean }> = [
  { name: 'icon_16x16', size: 16, small: true },
  { name: 'icon_16x16@2x', size: 32, small: true },
  { name: 'icon_32x32', size: 32, small: true },
  { name: 'icon_32x32@2x', size: 64, small: true },
  { name: 'icon_128x128', size: 128, small: false },
  { name: 'icon_128x128@2x', size: 256, small: false },
  { name: 'icon_256x256', size: 256, small: false },
  { name: 'icon_256x256@2x', size: 512, small: false },
  { name: 'icon_512x512', size: 512, small: false },
  { name: 'icon_512x512@2x', size: 1024, small: false },
]

function svgParts(svg: string) {
  const match = svg.match(/<svg\b[^>]*\bviewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>\s*$/)
  if (!match?.[1] || !match[2]) throw new Error('master SVG needs a root <svg> with a viewBox')
  return { viewBox: match[1], body: match[2] }
}

export function pixelTile(pixels: number) {
  const { size, canvas } = MAC_TILE
  const parity = pixels % 2
  const tile = Math.round((pixels * size / canvas - parity) / 2) * 2 + parity
  return { tile, offset: (pixels - tile) / 2 }
}

export function onMacGrid(smallSvg: string, pixels: number) {
  const { viewBox, body } = svgParts(smallSvg)
  const { tile, offset } = pixelTile(pixels)
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${pixels} ${pixels}"><svg x="${offset}" y="${offset}" width="${tile}" height="${tile}" viewBox="${viewBox}">${body}</svg></svg>`
}

export function tileOnly(appSvg: string) {
  const { body } = svgParts(appSvg)
  const { offset, size, radius } = MAC_TILE
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${offset} ${offset} ${size} ${size}"><defs><clipPath id="tile-only"><rect x="${offset}" y="${offset}" width="${size}" height="${size}" rx="${radius}"/></clipPath></defs><g clip-path="url(#tile-only)">${body}</g></svg>`
}

export function render(svg: string, size: number): Uint8Array {
  return new Resvg(svg, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng()
}

export function packIco(images: IconImage[]): Uint8Array {
  const headerSize = 6 + images.length * 16
  const total = headerSize + images.reduce((sum, image) => sum + image.png.length, 0)
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  view.setUint16(2, 1, true)
  view.setUint16(4, images.length, true)
  let offset = headerSize
  images.forEach((image, index) => {
    const entry = 6 + index * 16
    view.setUint8(entry, image.size >= 256 ? 0 : image.size)
    view.setUint8(entry + 1, image.size >= 256 ? 0 : image.size)
    view.setUint16(entry + 4, 1, true)
    view.setUint16(entry + 6, 32, true)
    view.setUint32(entry + 8, image.png.length, true)
    view.setUint32(entry + 12, offset, true)
    out.set(image.png, offset)
    offset += image.png.length
  })
  return out
}

function readMaster(name: string) {
  return readFileSync(path.join(buildDir, name), 'utf8')
}

function write(file: string, data: Uint8Array) {
  writeFileSync(file, data)
  console.log(`wrote ${path.relative(desktopRoot, file)}`)
}

function writeIcns(file: string, imageFor: (size: number, small: boolean) => Uint8Array) {
  if (process.platform !== 'darwin') throw new Error('icon.icns is built with iconutil, which only runs on macOS')
  const workDir = mkdtempSync(path.join(tmpdir(), 'dreamcoder-icons-'))
  try {
    const iconset = path.join(workDir, 'icon.iconset')
    mkdirSync(iconset)
    for (const { name, size, small } of ICONSET) {
      writeFileSync(path.join(iconset, `${name}.png`), imageFor(size, small))
    }
    const result = spawnSync('iconutil', ['-c', 'icns', iconset, '-o', file], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(`iconutil failed: ${result.stderr || result.error?.message}`)
    console.log(`wrote ${path.relative(desktopRoot, file)}`)
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}

function generate() {
  const app = readMaster('app-icon.svg')
  const small = readMaster('app-icon-small.svg')
  const tray = readMaster('tray-icon.svg')
  const tile = tileOnly(app)
  write(path.join(buildDir, 'app-icon-tile.svg'), new TextEncoder().encode(`${tile}\n`))

  const appPng = render(app, 1024)
  write(path.join(buildDir, 'app-icon.png'), appPng)
  write(path.join(desktopRoot, 'public', 'app-icon.png'), appPng)

  writeIcns(path.join(iconsDir, 'icon.icns'), (size, useSmall) => render(useSmall ? onMacGrid(small, size) : app, size))

  write(
    path.join(iconsDir, 'icon.ico'),
    packIco(ICO_SIZES.map((size) => ({
      size,
      png: render(size <= ICO_SMALL_MAX ? small : tile, size),
    }))),
  )

  write(path.join(iconsDir, 'tray.png'), render(small, 16))
  write(path.join(iconsDir, 'tray@2x.png'), render(small, 32))
  write(path.join(iconsDir, 'trayTemplate.png'), render(tray, 18))
  write(path.join(iconsDir, 'trayTemplate@2x.png'), render(tray, 36))
}

if (import.meta.main) generate()
