import { useEffect, useState } from 'react'

// 二维码组件
export function QRCodeDisplay({ data }: { data: { serverUrl: string; qrUrl: string } }) {
  const [qrImage, setQrImage] = useState<string | null>(null)

  useEffect(() => {
    if (!data) return

    // 动态导入 qrcode-generator
    import('qrcode-generator').then((QRCode) => {
      const qr = QRCode.default(0, 'M')
      qr.addData(data.qrUrl)
      qr.make()

      // 生成 SVG
      const cellSize = 4
      const margin = 8
      const size = qr.getModuleCount() * cellSize + margin * 2

      let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
      svg += `<rect width="${size}" height="${size}" fill="white"/>`

      for (let row = 0; row < qr.getModuleCount(); row++) {
        for (let col = 0; col < qr.getModuleCount(); col++) {
          if (qr.isDark(row, col)) {
            svg += `<rect x="${margin + col * cellSize}" y="${margin + row * cellSize}" width="${cellSize}" height="${cellSize}" fill="black"/>`
          }
        }
      }
      svg += '</svg>'

      setQrImage(`data:image/svg+xml;base64,${btoa(svg)}`)
    })
  }, [data])

  if (!qrImage) return null

  return (
    <div className="flex flex-col items-center">
      <img src={qrImage} alt="QR Code" className="w-48 h-48" />
    </div>
  )
}
