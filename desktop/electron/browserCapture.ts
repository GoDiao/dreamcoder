export const THUMBNAIL_WIDTH = 320
export const THUMBNAIL_QUALITY = 70

export type CaptureImage = {
  getSize(): { width: number; height: number }
  resize(options: { width: number }): CaptureImage
  toJPEG(quality: number): Buffer
}

export type CaptureRect = { x: number; y: number; width: number; height: number }

export type GuestContents = {
  isDestroyed(): boolean
  hostWebContents: unknown
  session: unknown
  getURL(): string
  capturePage(rect?: CaptureRect): Promise<CaptureImage>
  printToPDF(options: Record<string, unknown>): Promise<Buffer>
  executeJavaScriptInIsolatedWorld(worldId: number, scripts: Array<{ code: string }>): Promise<unknown>
}

type GuestIdentity = Pick<GuestContents, 'isDestroyed' | 'hostWebContents' | 'session'>

export type GuestLookup<T extends GuestIdentity> = {
  fromId: (id: number) => T | null | undefined
  getMainWebContents: () => unknown
  browserSession: unknown
}

export function findGuest<T extends GuestIdentity>(lookup: GuestLookup<T>, id: number): T {
  const contents = lookup.fromId(id)
  if (!contents || contents.isDestroyed()) throw new Error(`web contents ${id} does not exist`)
  const main = lookup.getMainWebContents()
  if (!main || contents.hostWebContents !== main) throw new Error(`web contents ${id} is not a guest of the main window`)
  if (contents.session !== lookup.browserSession) throw new Error(`web contents ${id} does not use the browser partition`)
  return contents
}

export async function captureThumbnail(contents: GuestContents, clip?: CaptureRect): Promise<string> {
  const image = await contents.capturePage(clip)
  const { width, height } = image.getSize()
  if (width === 0 || height === 0) throw new Error('the page has nothing to capture yet')
  const small = width > THUMBNAIL_WIDTH ? image.resize({ width: THUMBNAIL_WIDTH }) : image
  return small.toJPEG(THUMBNAIL_QUALITY).toString('base64')
}
