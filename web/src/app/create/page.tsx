'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits } from 'viem'
import { TEMISBLOCK_ADDRESS, USDC_ADDRESS, USDC_DECIMALS } from '@/lib/config'
import { TEMISBLOCK_ABI, ERC721_ABI } from '@/lib/abi'
import { ArrowLeft, CheckCircle2, Loader2, ArrowRight } from 'lucide-react'
import Link from 'next/link'

export default function CreateAuction() {
    const { isConnected } = useAccount()
    const router = useRouter()

    const [nftAddress, setNftAddress] = useState('')
    const [tokenId, setTokenId] = useState('')
    const [reservePrice, setReservePrice] = useState('')
    const [durationVal, setDurationVal] = useState('24')
    const [timeUnit, setTimeUnit] = useState<'Hours' | 'Days'>('Hours')

    // Approval State
    const { writeContract: approve, data: approveTxHash, isPending: isApproving } = useWriteContract()
    const { isLoading: isWaitingApprove, isSuccess: isApproved } = useWaitForTransactionReceipt({ hash: approveTxHash })

    // Create Auction State
    const { writeContract: createAuction, data: createTxHash, isPending: isCreating } = useWriteContract()
    const { isLoading: isWaitingCreate, isSuccess: isFinished } = useWaitForTransactionReceipt({ hash: createTxHash })

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
        const multiplier = timeUnit === 'Days' ? 86400 : 3600;
        const durationSecs = BigInt(Math.floor(Number(durationVal) * multiplier))

        createAuction({
            address: TEMISBLOCK_ADDRESS,
            abi: TEMISBLOCK_ABI,
            functionName: 'createAuction',
            args: [
                nftAddress as `0x${string}`,
                BigInt(tokenId),
                USDC_ADDRESS,
                reserveAmount,
                durationSecs
            ]
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
        <div className="max-w-2xl mx-auto relative relative z-10">
            <Link href="/" className="inline-flex items-center text-[#666] hover:text-white font-mono text-xs uppercase tracking-widest mb-12 transition-colors">
                <ArrowLeft size={14} className="mr-2" />
                Return to Index
            </Link>

            <div className="mb-12">
                <h1 className="text-5xl md:text-7xl font-extrabold uppercase leading-[0.85] font-display tracking-tighter break-words text-white">
                    DEPLOY<br />ASSET
                </h1>
                <p className="text-[#888] font-mono text-sm mt-6">
                    Initialize a high-frequency auction. <strong className="text-white">You must be the owner of the NFT to list it.</strong> Escrow your NFT into the zero-gas settlement layer. Min duration: 1 Hour. Max: 30 Days.
                </p>
            </div>

            <div className="space-y-6">
                <div className="flex flex-col gap-2">
                    <label className="font-mono text-xs uppercase tracking-widest text-[#666]">NFT Contract Address</label>
                    <input
                        type="text"
                        disabled={disableInputs}
                        value={nftAddress}
                        onChange={e => setNftAddress(e.target.value)}
                        placeholder="0x... (e.g. TemisArtifacts Address)"
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
                        placeholder="ID of the token you own (e.g. 1)"
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

                <div className="pt-8 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Step 1: Approve */}
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

                    {/* Step 2: Transact */}
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
                    <p className="text-center font-mono text-xs text-[#F5D90A] animate-pulse mt-4">Awaiting network confirmation...</p>
                )}
            </div>
        </div>
    )
}
