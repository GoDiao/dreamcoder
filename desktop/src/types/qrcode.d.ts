declare module 'qrcode' {
  type ToDataURLOptions = {
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
    margin?: number
    scale?: number
    width?: number
    color?: {
      dark?: string
      light?: string
    }
  }

  const QRCode: {
    toDataURL(text: string, options?: ToDataURLOptions): Promise<string>
  }

  export default QRCode
}
