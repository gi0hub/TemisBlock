import Link from 'next/link'
import { AuctionGrid } from '@/components/AuctionGrid'

export default function MarketplaceList() {

  return (
    <div className="space-y-12">
      {/* Header Hero */}
      <div className="border border-[#333] bg-black p-8 md:p-16 flex flex-col items-center justify-center text-center relative overflow-hidden min-h-[300px] mb-12">
        <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/stardust.png')] opacity-10" />
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#F5D90A] opacity-[0.03] blur-[150px] pointer-events-none" />

        <h1 className="text-6xl md:text-9xl font-extrabold uppercase font-display tracking-tighter mix-blend-difference relative z-10 leading-[0.8]">
          MARKET<br />INDEX
        </h1>
        <p className="text-[#888] font-mono uppercase tracking-widest mt-8 text-sm relative z-10 mb-8">
          High-Frequency Zero-Gas Asset Exchange
        </p>
        <Link href="/create" className="relative z-10 border border-[#333] hover:border-[#F5D90A] text-[#F5D90A] bg-black px-6 py-3 font-mono text-xs uppercase tracking-widest transition-colors flex items-center gap-2">
          <span>+ Deploy New Asset</span>
        </Link>
      </div>

      {/* Grid */}
      <AuctionGrid />
    </div>
  )
}
