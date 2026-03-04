import Link from 'next/link'
import { Terminal, CircleDashed } from 'lucide-react'

export default function MarketplaceList() {
  // Mock data for the listing. Note our contract currently uses ID 0 for the demo.
  const auctions = [
    { id: 0, title: 'OBSIDIAN CORE FRAGMENT', status: 'LIVE', price: '0.00 USDC', isReal: true },
    { id: 1, title: 'VOID ANOMALY #8', status: 'UPCOMING', price: '—', isReal: false },
    { id: 2, title: 'SYNTHETIC ECHO', status: 'CLOSED', price: '450.00 USDC', isReal: false },
    { id: 3, title: 'NEURAL GLITCH V.4', status: 'UPCOMING', price: '—', isReal: false },
    { id: 4, title: 'CRIMSON DATABLOCK', status: 'CLOSED', price: '120.00 USDC', isReal: false }
  ];

  return (
    <div className="space-y-12">
      {/* Header Hero */}
      <div className="border border-[#333] bg-black p-8 md:p-16 flex flex-col items-center justify-center text-center relative overflow-hidden min-h-[300px] mb-12">
        <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/stardust.png')] opacity-10" />
        <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-[#F5D90A] opacity-[0.03] blur-[150px] pointer-events-none" />

        <h1 className="text-6xl md:text-9xl font-extrabold uppercase font-display tracking-tighter mix-blend-difference relative z-10 leading-[0.8]">
          MARKET<br />INDEX
        </h1>
        <p className="text-[#888] font-mono uppercase tracking-widest mt-8 text-sm relative z-10">
          High-Frequency Zero-Gas Asset Exchange
        </p>
      </div>

      {/* Grid */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-[#333] border border-[#333]">
        {auctions.map((item) => (
          <div key={item.id} className={`bg-[#050505] p-6 flex flex-col h-[400px] justify-between group transition-colors relative ${item.isReal ? 'hover:bg-[#0A0A0A]' : 'opacity-60 grayscale'}`}>
            <div className="flex justify-between items-center border-b border-[#222] pb-4 mb-4">
              <span className="text-xs uppercase font-mono tracking-widest text-[#888]">Lot No. 0{item.id}</span>
              {item.status === 'LIVE' ? (
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 bg-[#F5D90A] animate-pulse" />
                  <span className="text-[10px] text-[#F5D90A] uppercase tracking-widest font-bold">LIVE</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <CircleDashed size={10} className="text-[#666]" />
                  <span className="text-[10px] text-[#666] uppercase tracking-widest">{item.status}</span>
                </div>
              )}
            </div>

            <div className={`flex-1 flex items-center justify-center border border-[#111] mb-6 relative overflow-hidden transition-colors ${item.isReal ? 'group-hover:border-[#333]' : ''}`}>
              <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/stardust.png')] opacity-10" />
              <Terminal className={`text-[#222] transition-colors relative z-10 ${item.status === 'LIVE' ? 'group-hover:text-[#F5D90A]/50' : ''}`} size={64} />
            </div>

            <div className="space-y-4 relative z-10">
              <h2 className="font-display text-xl uppercase font-bold tracking-tight">{item.title}</h2>
              <div className="flex items-center justify-between">
                <span className="font-mono text-[#666] text-xs">ASK / VOL</span>
                <span className="font-mono text-white text-lg">{item.price}</span>
              </div>
            </div>

            {/* Overlay link for live auctions */}
            {item.isReal && (
              <Link href={`/auction/${item.id}`} className="absolute inset-0 z-20">
                <span className="sr-only">View Auction</span>
              </Link>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
