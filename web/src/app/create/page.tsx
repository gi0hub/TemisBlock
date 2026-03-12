'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useWriteContract, useWaitForTransactionReceipt, usePublicClient } from 'wagmi'
import { parseUnits } from 'viem'
import { TEMISBLOCK_ADDRESS, USDC_ADDRESS, USDC_DECIMALS } from '@/lib/config'
import { TEMISBLOCK_ABI, ERC721_ABI } from '@/lib/abi'
import { ArrowLeft, CheckCircle2, Loader2, ArrowRight, ImageOff } from 'lucide-react'
import Link from 'next/link'

// Resolve any tokenURI format to an image URL
async function resolveNftImage(tokenURI: string): Promise<string | null> {
    let url = tokenURI
    if (url.startsWith('ipfs://')) url = url.replace('ipfs://', 'https://ipfs.io/ipfs/')
    if (url.startsWith('ar://')) url = url.replace('ar://', 'https://arweave.net/')

    // Direct image URI
    if (url.match(/\.(jpeg|jpg|gif|png|svg|webp)$/i)) return url

    if (!url.startsWith('http')) return null

    try {
        const res = await fetch(url)
        const contentType = res.headers.get('content-type')
        if (contentType && contentType.includes('image')) return url
        const text = await res.text()
        const data = JSON.parse(text)
        let img = data.image || data.image_url
        if (!img) return null
        if (img.startsWith('ipfs://')) img = img.replace('ipfs://', 'https://ipfs.io/ipfs/')
        if (img.startsWith('ar://')) img = img.replace('ar://', 'https://arweave.net/')
        return img
    } catch {
        return null
    }
}

export default function CreateAuction() {
    const { isConnected } = useAccount()
    const router = useRouter()
    const publicClient = usePublicClient()

    const [nftAddress, setNftAddress] = useState('')
    const [tokenId, setTokenId] = useState('')
    const [reservePrice, setReservePrice] = useState('')
    const [durationVal, setDurationVal] = useState('24')
    const [timeUnit, setTimeUnit] = useState<'Hours' | 'Days'>('Hours')

    // Live NFT Preview state
    const [previewImage, setPreviewImage] = useState<string | null>(null)
    const [previewName, setPreviewName] = useState<string | null>(null)
    const [previewLoading, setPreviewLoading] = useState(false)

    // Approval State
    const { writeContract: approve, data: approveTxHash, isPending: isApproving } = useWriteContract()
    const { isLoading: isWaitingApprove, isSuccess: isApproved } = useWaitForTransactionReceipt({ hash: approveTxHash })

    // Create Auction State
    const { writeContract: createAuction, data: createTxHash, isPending: isCreating } = useWriteContract()
    const { isLoading: isWaitingCreate, isSuccess: isFinished } = useWaitForTransactionReceipt({ hash: createTxHash })

    const isValidAddress = nftAddress.startsWith('0x') && nftAddress.length === 42
    const isValidTokenId = tokenId !== '' && !isNaN(Number(tokenId))

    // Dynamically fetch NFT preview from chain when contract + tokenId change
    useEffect(() => {
        if (!isValidAddress || !isValidTokenId || !publicClient) {
            setPreviewImage(null)
            setPreviewName(null)
            return
        }
        let cancelled = false
        const fetchPreview = async () => {
            setPreviewLoading(true)
            setPreviewImage(null)
            setPreviewName(null)
            try {
                const name = await publicClient.readContract({
                    address: nftAddress as `0x${string}`,
                    abi: ERC721_ABI,
                    functionName: 'name',
                    args: []
                }).catch(() => null)

                const tokenURI = await publicClient.readContract({
                    address: nftAddress as `0x${string}`,
                    abi: ERC721_ABI,
                    functionName: 'tokenURI',
                    args: [BigInt(tokenId)]
                }).catch(() => null)

                if (cancelled) return
                if (name) setPreviewName(name as string)
                if (tokenURI) {
                    const img = await resolveNftImage(tokenURI as string)
                    if (!cancelled) setPreviewImage(img)
                }
            } catch {
                // Silently fail preview
            } finally {
                if (!cancelled) setPreviewLoading(false)
            }
        }
        const timer = setTimeout(fetchPreview, 600)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [nftAddress, tokenId, isValidAddress, isValidTokenId, publicClient])

    const handleApprove = () => {
        if (!nftAddress || !tokenId) return
        approve({
            address: nftAddress as `0x${string}`,
            abi: ERC721_ABI,
            functionName: 'approve',
            args: [TEMISBLOCK_ADDRESS, BigInt(tokenId)]
        })
    }

    const handleCreate = () => {
        if (!nftAddress || !tokenId || !reservePrice || !durationVal || !isApproved) return
        const reserveAmount = parseUnits(reservePrice.replace(',', '.'), USDC_DECIMALS)
        const multiplier = timeUnit === 'Days' ? 86400 : 3600
        const durationSecs = BigInt(Math.floor(Number(durationVal) * multiplier))
        createAuction({
            address: TEMISBLOCK_ADDRESS,
            abi: TEMISBLOCK_ABI,
            functionName: 'createAuction',
            args: [nftAddress as `0x${string}`, BigInt(tokenId), USDC_ADDRESS, reserveAmount, durationSecs]
        })
    }

    if (!isConnected) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center border border-[#333] p-12 bg-[#050505] relative overflow-hidden">
                <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/stardust.png')] opacity-10" />
                <h1 className="text-4xl font-display uppercase tracking-tighter z-10 mb-4">ACCESS DENIED</h1>
                <p className="text-[#888] font-mono text-sm z-10">Wallet connection required to deploy assets.</p>
            </div>
        )
    }

    if (isFinished) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[50vh] text-center border border-[#333] p-12 bg-[#050505] relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-[#F5D90A]" />
                <CheckCircle2 size={64} className="text-[#F5D90A] mb-6" />
                <h1 className="text-4xl font-display uppercase tracking-tighter z-10 mb-4">AUCTION DEPLOYED</h1>
                <p className="text-[#888] font-mono text-sm z-10 max-w-md mx-auto mb-8">
                    Your asset has been successfully escrowed into the TemisBlock vault and is now indexed for zero-gas bidding.
                </p>
                <button onClick={() => router.push('/')} className="border border-[#F5D90A] text-[#F5D90A] px-8 py-3 font-mono text-xs uppercase tracking-widest hover:bg-[#F5D90A] hover:text-black transition-colors">
                    Return to Index
                </button>
            </div>
        )
    }

    const disableInputs = isApproving || isWaitingApprove || isApproved || isCreating || isWaitingCreate

    return (
        <div className="relative z-10">
            <Link href="/" className="inline-flex items-center text-[#666] hover:text-white font-mono text-xs uppercase tracking-widest mb-12 transition-colors">
                <ArrowLeft size={14} className="mr-2" />
                Return to Index
            </Link>

            <div className="grid lg:grid-cols-2 gap-px bg-[#333] border border-[#333]">

                {/* LEFT: Live NFT Preview */}
                <div className="bg-[#050505] p-8 flex flex-col gap-6">
                    <div>
                        <h1 className="text-5xl md:text-7xl font-extrabold uppercase leading-[0.85] font-display tracking-tighter text-white">
                            DEPLOY<br />ASSET
                        </h1>
                        <p className="text-[#888] font-mono text-xs mt-4 max-w-xs">
                            Enter your NFT contract address and Token ID. Preview loads automatically from the blockchain.
                        </p>
                    </div>

                    {/* Live Preview Panel */}
                    <div className="border border-[#333] aspect-square relative flex items-center justify-center overflow-hidden bg-[#0A0A0A]">
                        {previewLoading ? (
                            <div className="flex flex-col items-center gap-3">
                                <Loader2 size={32} className="animate-spin text-[#F5D90A]" />
                                <span className="text-[#666] font-mono text-xs uppercase tracking-widest">Fetching from chain...</span>
                            </div>
                        ) : previewImage ? (
                            <img
                                src={previewImage}
                                alt="NFT Preview"
                                className="w-full h-full object-cover"
                                onError={() => setPreviewImage(null)}
                            />
                        ) : (
                            <div className="flex flex-col items-center gap-3 text-center p-6">
                                <ImageOff size={40} className="text-[#333]" />
                                <span className="text-[#555] font-mono text-xs uppercase tracking-widest">
                                    {isValidAddress && isValidTokenId ? 'No image found' : 'Preview will appear here'}
                                </span>
                            </div>
                        )}
                    </div>

                    {previewName && (
                        <p className="font-display font-bold uppercase tracking-tight text-lg truncate">
                            {previewName} <span className="text-[#F5D90A]">#{tokenId}</span>
                        </p>
                    )}
                </div>

                {/* RIGHT: Form */}
                <div className="bg-black p-8 flex flex-col justify-center space-y-6">
                    <div className="flex flex-col gap-2">
                        <label className="font-mono text-xs uppercase tracking-widest text-[#666]">NFT Contract Address</label>
                        <input
                            type="text"
                            disabled={disableInputs}
                            value={nftAddress}
                            onChange={e => setNftAddress(e.target.value)}
                            placeholder="0x..."
                            className="bg-transparent border border-[#333] p-4 font-mono text-white focus:border-[#F5D90A] focus:outline-none transition-colors disabled:opacity-50"
                        />
                    </div>

                    <div className="flex flex-col gap-2">
                        <label className="font-mono text-xs uppercase tracking-widest text-[#666]">Token ID</label>
                        <input
                            type="number"
                            disabled={disableInputs}
                            value={tokenId}
                            onChange={e => setTokenId(e.target.value)}
                            placeholder="e.g. 1"
                            className="bg-transparent border border-[#333] p-4 font-mono text-white focus:border-[#F5D90A] focus:outline-none transition-colors disabled:opacity-50"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-6">
                        <div className="flex flex-col gap-2">
                            <label className="font-mono text-xs uppercase tracking-widest text-[#666]">Reserve Price (USDC)</label>
                            <input
                                type="number"
                                disabled={disableInputs}
                                step="0.01"
                                value={reservePrice}
                                onChange={e => setReservePrice(e.target.value)}
                                placeholder="0.00"
                                className="bg-transparent border border-[#333] p-4 font-mono text-white focus:border-[#F5D90A] focus:outline-none transition-colors disabled:opacity-50"
                            />
                        </div>
                        <div className="flex flex-col gap-2">
                            <label className="font-mono text-xs uppercase tracking-widest text-[#666]">Duration</label>
                            <div className="flex border border-[#333] focus-within:border-[#F5D90A] transition-colors">
                                <input
                                    type="number"
                                    disabled={disableInputs}
                                    min="1"
                                    max={timeUnit === 'Days' ? "30" : "720"}
                                    value={durationVal}
                                    onChange={e => setDurationVal(e.target.value)}
                                    className="bg-transparent p-4 w-full font-mono text-white focus:outline-none disabled:opacity-50"
                                />
                                <select
                                    disabled={disableInputs}
                                    value={timeUnit}
                                    onChange={e => setTimeUnit(e.target.value as 'Hours' | 'Days')}
                                    className="bg-black text-[#888] font-mono text-xs uppercase tracking-widest px-4 border-l border-[#333] focus:outline-none cursor-pointer"
                                >
                                    <option value="Hours">Hours</option>
                                    <option value="Days">Days</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    <div className="pt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <button
                            onClick={handleApprove}
                            disabled={isApproved || isApproving || isWaitingApprove || !nftAddress || !tokenId}
                            className={`p-4 font-mono text-xs uppercase tracking-widest flex items-center justify-between border transition-all ${isApproved
                                ? 'bg-[#333] border-[#333] text-[#888] cursor-not-allowed'
                                : 'border-[#F5D90A] text-[#F5D90A] hover:bg-[#F5D90A] hover:text-black'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <span>1. Approve Escrow</span>
                            {isApproving || isWaitingApprove ? <Loader2 size={16} className="animate-spin" /> : (isApproved ? <CheckCircle2 size={16} /> : <ArrowRight size={16} />)}
                        </button>

                        <button
                            onClick={handleCreate}
                            disabled={!isApproved || isCreating || isWaitingCreate || !reservePrice || !durationVal}
                            className={`p-4 font-mono text-xs uppercase tracking-widest flex items-center justify-between transition-all ${!isApproved
                                ? 'bg-transparent border border-[#333] text-[#666] cursor-not-allowed'
                                : 'bg-[#F5D90A] text-black hover:bg-white'
                                } disabled:opacity-50 disabled:cursor-not-allowed`}
                        >
                            <span>2. Execute & List</span>
                            {isCreating || isWaitingCreate ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
                        </button>
                    </div>

                    {(isWaitingApprove || isWaitingCreate) && (
                        <p className="text-center font-mono text-xs text-[#F5D90A] animate-pulse">Awaiting network confirmation...</p>
                    )}
                </div>
            </div>
        </div>
    )
}
