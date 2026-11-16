const MAX_SIDE = 1600

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error ?? new Error('Could not read image'))
    r.readAsDataURL(blob)
  })
}

function extFor(type: string): string {
  switch (type) {
    case 'image/png':
      return 'png'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    case 'image/svg+xml':
      return 'svg'
    default:
      return 'jpg'
  }
}

/** Downscale (if needed) and store an image file via the main process. Returns the media:// URL. */
export async function saveImageFile(file: Blob): Promise<string> {
  let blob: Blob = file
  let ext = extFor(file.type)
  const animatedOrVector = file.type === 'image/gif' || file.type === 'image/svg+xml'
  if (!animatedOrVector) {
    try {
      const bmp = await createImageBitmap(file)
      const longest = Math.max(bmp.width, bmp.height)
      const big = longest > MAX_SIDE
      // Re-encode photos to JPEG to keep the collection small; keep PNG as PNG.
      const isPng = file.type === 'image/png'
      if (big || (!isPng && file.type !== 'image/jpeg' && file.type !== 'image/webp')) {
        const scale = big ? MAX_SIDE / longest : 1
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bmp.width * scale))
        canvas.height = Math.max(1, Math.round(bmp.height * scale))
        const ctx = canvas.getContext('2d')
        if (ctx) {
          if (!isPng) {
            ctx.fillStyle = '#ffffff'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
          }
          ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height)
          const out = await new Promise<Blob | null>((res) =>
            canvas.toBlob(res, isPng ? 'image/png' : 'image/jpeg', 0.9)
          )
          if (out) {
            blob = out
            ext = isPng ? 'png' : 'jpg'
          }
        }
      }
      bmp.close()
    } catch {
      // fall back to the original bytes
    }
  }
  return window.api.saveMedia(await blobToBase64(blob), ext)
}

export function imageFilesFrom(list: FileList | DataTransferItemList | null | undefined): File[] {
  const out: File[] = []
  if (!list) return out
  for (let i = 0; i < list.length; i++) {
    const item = list[i]
    const file = item instanceof File ? item : (item as DataTransferItem).kind === 'file' ? (item as DataTransferItem).getAsFile() : null
    if (file && file.type.startsWith('image/')) out.push(file)
  }
  return out
}
