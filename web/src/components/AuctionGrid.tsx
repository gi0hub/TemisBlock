'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Terminal, CircleDashed } from 'lucide-react'
import { useReadContract } from 'wagmi'
import { formatUnits } from 'viem'
import { TEMISBLOCK_ADDRESS, USDC_DECIMALS } from '@/lib/config'
import { TEMISBLOCK_ABI } from '@/lib/abi'
import { useAuction, useNFTContractReads } from '@/hooks/useTemisBlock'

function AuctionBox({ auctionId }: { auctionId: bigint }) {
    const { data: auctionData } = useAuction(auctionId)
    // struct Auction { seller, nftContract, tokenId, payToken, reservePrice, endTime, feeBps, settled, cancelled }
    const seller = (auctionData as any)?.[0] as `0x${string}` | undefined
    const nftContract = (auctionData as any)?.[1] as `0x${string}` | undefined
    const nftTokenId = ((auctionData as any)?.[2] as bigint) ?? undefined
    const reservePrice = (auctionData as any)?.[4] as bigint | undefined
    const endTime = (auctionData as any)?.[5] as bigint | undefined
    const settled = (auctionData as any)?.[7] as boolean | undefined
    const cancelled = (auctionData as any)?.[8] as boolean | undefined

    const { name: nftName, tokenURI } = useNFTContractReads(nftContract, nftTokenId)
    const [nftImage, setNftImage] = useState<string | undefined>(undefined)

    // Resolve IPFS json metadata to actual image
    useEffect(() => {
        if (!tokenURI) return
        let url = tokenURI
        if (url.startsWith('ipfs://')) {
            url = url.replace('ipfs://', 'https://ipfs.io/ipfs/')
        }

        if (url.startsWith('http')) {
            fetch(url)
                .then(res => res.json())
                .then(data => {
                    let img = data.image || data.image_url
                    if (img && img.startsWith('ipfs://')) {
                        img = img.replace('ipfs://', 'https://ipfs.io/ipfs/')
                    }
                    setNftImage(img)
                })
                .catch(e => console.error("Failed to map tokenURI metadata for grid:", e))
        }
    }, [tokenURI])

    // Determinar estatus
    const now = BigInt(Math.floor(Date.now() / 1000))
    let statusText = 'LIVE'
    let isLive = true

    if (cancelled) {
        statusText = 'CANCELLED'
        isLive = false
    } else if (settled) {
        statusText = 'SETTLED'
        isLive = false
    } else if (endTime && now >= endTime) {
        statusText = 'PENDING'
        isLive = false
    }

    const priceText = reservePrice !== undefined ? `${Number(formatUnits(reservePrice, USDC_DECIMALS)).toFixed(2)} USDC` : '—'
    const titleText = nftName ? nftName.toUpperCase() : 'LOADING...'

    // Always show our self-hosted NFT artwork (same Vercel domain = instant load)
    const actualNftImage = nftImage || '/nft/1.png'

    return (
        <div className={`bg-[#050505] border border-[#333] -mt-px -ml-px p-6 flex flex-col h-[400px] justify-between group transition-colors relative select-none cursor-default ${isLive ? 'hover:bg-[#0A0A0A] z-10 hover:z-20' : 'opacity-60 grayscale'}`}>
            {/* Headers */}
            <div className="flex justify-between items-center border-b border-[#222] pb-4 mb-4">
                <span className="text-xs uppercase font-mono tracking-widest text-[#888]">Lot No. 0{auctionId.toString()}</span>
                {isLive ? (
                    <div className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 bg-[#F5D90A] animate-pulse" />
                        <span className="text-[10px] text-[#F5D90A] uppercase tracking-widest font-bold">LIVE</span>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <CircleDashed size={10} className="text-[#666]" />
                        <span className="text-[10px] text-[#666] uppercase tracking-widest">{statusText}</span>
                    </div>
                )}
            </div>

            {/* Image / Graphic */}
            <div className={`flex-1 flex items-center justify-center border border-[#111] mb-6 relative overflow-hidden transition-colors ${isLive ? 'group-hover:border-[#333]' : ''}`}>
                {actualNftImage ? (
                    <img src={actualNftImage} alt="NFT Box" className="w-[85%] h-[85%] object-cover relative z-10 opacity-80 group-hover:opacity-100 transition-opacity" />
                ) : (
                    <>
                        <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/stardust.png')] opacity-10" />
                        <Terminal className={`text-[#222] transition-colors relative z-10 ${isLive ? 'group-hover:text-[#F5D90A]/50' : ''}`} size={64} />
                    </>
                )}
            </div>

            {/* Footer Text */}
            <div className="space-y-4 relative z-10">
                <h2 className="font-display text-xl uppercase font-bold tracking-tight truncate" title={titleText}>{titleText}</h2>
                <div className="flex items-center justify-between">
                    <span className="font-mono text-[#666] text-xs">RES. PRICE</span>
                    <span className="font-mono text-white text-lg">{priceText}</span>
                </div>
            </div>

            {/* Link overlay */}
            <Link href={`/auction/${auctionId}`} className="absolute inset-0 z-20">
                <span className="sr-only">View Auction</span>
            </Link>
        </div>
    )
}

const DUMMY_AUCTIONS = [
    { id: 'offline-1', title: 'VOID ANOMALY #8', status: 'UPCOMING', price: '—' },
    { id: 'offline-2', title: 'SYNTHETIC ECHO', status: 'CLOSED', price: '450.00 USDC' },
    { id: 'offline-3', title: 'NEURAL GLITCH V.4', status: 'UPCOMING', price: '—' },
    { id: 'offline-4', title: 'CRIMSON DATABLOCK', status: 'CLOSED', price: '120.00 USDC' }
]

function DummyBox({ item }: { item: { id: string, title: string, status: string, price: string } }) {
    return (
        <div className={`bg-[#050505] border border-[#333] -mt-px -ml-px p-6 flex flex-col h-[400px] justify-between group transition-colors relative opacity-60 grayscale select-none cursor-default`}>
            {/* Headers */}
            <div className="flex justify-between items-center border-b border-[#222] pb-4 mb-4">
                <span className="text-xs uppercase font-mono tracking-widest text-[#888]">Lot No. --</span>
                <div className="flex items-center gap-2">
                    <CircleDashed size={10} className="text-[#666]" />
                    <span className="text-[10px] text-[#666] uppercase tracking-widest">{item.status}</span>
                </div>
            </div>

            {/* Image / Graphic */}
            <div className={`flex-1 flex items-center justify-center border border-[#111] mb-6 relative overflow-hidden transition-colors`}>
                <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/stardust.png')] opacity-10" />
                <Terminal className={`text-[#222] transition-colors relative z-10`} size={64} />
            </div>

            {/* Footer Text */}
            <div className="space-y-4 relative z-10">
                <h2 className="font-display text-xl uppercase font-bold tracking-tight truncate" title={item.title}>{item.title}</h2>
                <div className="flex items-center justify-between">
                    <span className="font-mono text-[#666] text-xs">ASK / VOL</span>
                    <span className="font-mono text-white text-lg">{item.price}</span>
                </div>
            </div>
        </div>
    )
}

export function AuctionGrid() {
    const [isMounted, setIsMounted] = useState(false)

    useEffect(() => {
        setIsMounted(true)
    }, [])

    const { data: rawNextId } = useReadContract({
        address: TEMISBLOCK_ADDRESS,
        abi: TEMISBLOCK_ABI,
        functionName: 'nextAuctionId'
    })

    // If nextAuctionId is not fully loaded or we haven't mounted yet, render skeletons and offline pads
    // This prevents React hydration mismatches from leaving dangling skeleton DOM nodes.
    if (!isMounted || rawNextId === undefined) {
        return (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 pl-px pt-px">
                {/* 1 loading stub */}
                {[1].map(i => (
                    <div key={`skel-${i}`} className="bg-[#050505] border border-[#333] -mt-px -ml-px p-6 flex flex-col h-[400px] animate-pulse">
                        <div className="w-full h-4 bg-[#111] mb-8" />
                        <div className="flex-1 w-full bg-[#111] mb-8" />
                        <div className="w-1/2 h-6 bg-[#111]" />
                    </div>
                ))}
                {/* Pad out with dummies immediately so UI does not shift violently */}
                {DUMMY_AUCTIONS.map(item => (
                    <DummyBox key={item.id} item={item} />
                ))}
            </div>
        )
    }

    const nextId = Number(rawNextId)

    // Reverse mapping so newest is first. Empty array if nextId is 0.
    const auctionIds = Array.from({ length: nextId }, (_, i) => BigInt(nextId - 1 - i))

    // Real render mapping
    return (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 pl-px pt-px">
            {auctionIds.map(id => (
                <AuctionBox key={id.toString()} auctionId={id} />
            ))}
            {DUMMY_AUCTIONS.map(item => (
                <DummyBox key={item.id} item={item} />
            ))}
        </div>
    )
}
