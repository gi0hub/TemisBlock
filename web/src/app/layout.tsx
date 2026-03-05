import type { Metadata } from 'next'
import { Syne, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { Providers } from '@/lib/providers'

const syne = Syne({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '600', '800']
})

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono'
})

export const metadata: Metadata = {
  title: 'TEMISBLOCK // 0-GAS',
  description: 'Uncompromising Zero-Gas NFT auctions.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${syne.variable} ${mono.variable} antialiased bg-[#050505] text-[#E5E5E5] min-h-screen selection:bg-white selection:text-black font-mono`}>
        <Providers>
          <header className="border-b border-[#222] bg-[#050505] px-6 py-4 flex items-center justify-between sticky top-0 z-50">
            <div className="flex items-baseline gap-4">
              <span className="text-2xl font-extrabold uppercase tracking-tighter mix-blend-difference font-display text-white">
                TemisBlock
              </span>
              <span className="hidden md:inline-block text-[10px] uppercase tracking-[0.2em] text-[#666]">
                Network: Base Mainnet // Relayer: Active
              </span>
            </div>
            <ConnectButtonClient />
          </header>
          <main className="w-full max-w-[1400px] mx-auto px-4 py-8 md:py-16">{children}</main>
        </Providers>
      </body>
    </html>
  )
}

// Lazy import to avoid SSR issues with wagmi
function ConnectButtonClient() {
  'use client'
  const { ConnectButton } = require('@rainbow-me/rainbowkit')
  return <ConnectButton chainStatus="icon" showBalance={false} accountStatus="address" />
}
