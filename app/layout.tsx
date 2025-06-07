import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Bàn Phím Cử Chỉ Tay',
  description: 'Gõ phím bằng cử chỉ tay qua camera',
  generator: 'v0.dev',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <head>
        {/* Pre-load MediaPipe libraries */}
        <script src="https://cdn.jsdelivr.net/npm/@mediapipe/drawing_utils/drawing_utils.js" defer></script>
        <script src="https://cdn.jsdelivr.net/npm/@mediapipe/hands/hands.js" defer></script>
        <script src="https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js" defer></script>
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
