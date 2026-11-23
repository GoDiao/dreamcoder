import type { Buffer } from 'buffer'

export type SharpInstance = {
  metadata(): Promise<{ width: number; height: number; format: string }>
  resize(
    width: number,
    height: number,
    options?: { fit?: string; withoutEnlargement?: boolean },
  ): SharpInstance
  jpeg(options?: { quality?: number }): SharpInstance
  png(options?: {
    compressionLevel?: number
    palette?: boolean
    colors?: number
  }): SharpInstance
  webp(options?: { quality?: number }): SharpInstance
  toBuffer(): Promise<Buffer>
}

export type SharpFunction = (input: Buffer) => SharpInstance

let imageProcessor: SharpFunction | null = null

export async function getImageProcessor(): Promise<SharpFunction> {
  if (imageProcessor) {
    return imageProcessor
  }

  // Single structural cast: our SharpFunction is a subset of sharp's actual type surface.
  const imported = (await import(
    'sharp'
  )) as unknown as MaybeDefault<SharpFunction>
  imageProcessor = unwrapDefault(imported)
  return imageProcessor
}

// Dynamic import shape varies by module interop mode — ESM yields { default: fn }, CJS yields fn directly.
type MaybeDefault<T> = T | { default: T }

function unwrapDefault<T extends (...args: never[]) => unknown>(
  mod: MaybeDefault<T>,
): T {
  return typeof mod === 'function' ? mod : mod.default
}
