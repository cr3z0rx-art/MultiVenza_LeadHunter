import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: {
    default: 'MultiVenza Intelligence',
    template: '%s — MultiVenza Intelligence',
  },
  description: 'Plataforma de Inteligencia de Mercado para Permisos de Construcción',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'MultiVenza',
  },
  icons: {
    icon:  [{ url: '/icons/icon.svg', type: 'image/svg+xml' }],
    apple: '/icons/icon.svg',
  },
  openGraph: {
    type: 'website',
    title: 'MultiVenza Intelligence',
    description: 'Leads de permisos de construcción — FL · GA · IL',
    siteName: 'MultiVenza Intelligence',
  },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className={inter.variable}>
      <body className="bg-navy-950 text-white antialiased font-sans min-h-screen">
        {children}
      </body>
    </html>
  )
}
