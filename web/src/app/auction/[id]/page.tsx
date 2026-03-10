'use client'

import { useState, useEffect } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { useAccount, usePublicClient, useWalletClient } from 'wagmi'
import { formatUnits, parseUnits } from 'viem'
import { motion, AnimatePresence } from 'framer-motion'
import { ArrowRight, SquareTerminal, CircleDashed, ArrowLeft } from 'lucide-react'

import { useTemisBalance, useDeposit, useWithdrawalRequest, useRequestWithdrawal, useExecuteWithdrawal, useAuction, useNFTContractReads } from '@/hooks/useTemisBlock'
import { useEip712Bid } from '@/hooks/useEip712Bid'
import { useYellowWS } from '@/hooks/useYellowWS'
import { USDC_DECIMALS, USDC_ADDRESS, CHAIN_ID } from '@/lib/config'

function fmt(val: bigint | undefined) {
    if (val === undefined) return '—'
    return Number(formatUnits(val, USDC_DECIMALS)).toFixed(2)
}

function timeLeft(endMs: number) {
    const diff = Math.max(0, endMs - Date.now())
    const h = Math.floor(diff / 3600000)
    const m = Math.floor((diff % 3600000) / 60000)
    const s = Math.floor((diff % 60000) / 1000)
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

export default function AuctionDetail() {
    const params = useParams()
    // Ensure we safely parse the ID from the route. Default to 0n if invalid.
    const auctionIdParam = params?.id as string
    const auctionId = auctionIdParam ? BigInt(auctionIdParam) : 0n

    const { address, isConnected } = useAccount()
    const publicClient = usePublicClient()
    const { data: balance, refetch: refetchBalance } = useTemisBalance()

    const { data: auctionData } = useAuction(auctionId)
    const nftContract = (auctionData as any)?.[1] as `0x${string}` | undefined
    const nftTokenId = ((auctionData as any)?.[2] as bigint) ?? undefined
    const { name: nftName, tokenURI } = useNFTContractReads(nftContract, nftTokenId)

    const [nftImage, setNftImage] = useState<string | undefined>(undefined)

    // Resolve standard ERC721 tokenURI JSON for an image
    useEffect(() => {
        if (!tokenURI) return
        let url = tokenURI
        if (url.startsWith('ipfs://')) {
            url = url.replace('ipfs://', 'https://ipfs.io/ipfs/')
        }

        // If it's a URL we can fetch, try to get the JSON metadata
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
                .catch(e => console.error("Failed to map tokenURI metadata:", e))
        }
    }, [tokenURI])

    // Deposit System
    const { approve, deposit, isPending: isDepositing } = useDeposit()
    const [depositAmt, setDepositAmt] = useState('')

    // Bid System
    const { data: walletClient } = useWalletClient()
    const { status: wsStatus, bids, sendBid, sepoliaConfig, channelId } = useYellowWS(auctionId)
    const [bidAmt, setBidAmt] = useState('')
    const [isSigning, setIsSigning] = useState(false)

    // Withdrawal System
    const { data: withdrawalReq, refetch: refetchWithdrawal } = useWithdrawalRequest()
    const { requestWithdrawal, isPending: isReqWd } = useRequestWithdrawal()
    const { executeWithdrawal, isPending: isExecWd } = useExecuteWithdrawal()
    const [wdAmt, setWdAmt] = useState('')

    const [timer, setTimer] = useState('--:--:--')
    const [effectiveEnd, setEffectiveEnd] = useState<number | null>(null)

    const [activeTab, setActiveTab] = useState<'TRADE' | 'ASSETS'>('TRADE')

    // Global Error State
    const [globalError, setGlobalError] = useState<string | null>(null)
    const showError = (msg: string) => {
        // format message to be cleaner if it's too long
        // specifically for "Failed to submit bid: ..." we can just show the inner error
        let cleanMsg = msg
        try {
            if (msg.includes('Failed to submit bid: ')) {
                cleanMsg = msg.replace('Failed to submit bid: ', '')
            }
        } catch (e) { }
        setGlobalError(cleanMsg)
        setTimeout(() => setGlobalError(null), 5000)
    }

    useEffect(() => {
        async function fetchStatus() {
            const res = await fetch(`/api/status?auctionId=${auctionId.toString()}`)
            if (res.ok) {
                const data = await res.json()
                if (data.effectiveEndTime) setEffectiveEnd(data.effectiveEndTime)
            }
        }
        fetchStatus()
        const interval = setInterval(fetchStatus, 30_000)
        return () => clearInterval(interval)
    }, [auctionId])

    useEffect(() => {
        if (!effectiveEnd) return
        const interval = setInterval(() => setTimer(timeLeft(effectiveEnd)), 1000)
        return () => clearInterval(interval)
    }, [effectiveEnd])

    async function handleDeposit() {
        if (!depositAmt) return
        try {
            const approveHash = await approve(depositAmt)
            if (publicClient && approveHash) {
                await publicClient.waitForTransactionReceipt({ hash: approveHash })
            }
            await deposit(depositAmt)
            setDepositAmt('')
            refetchBalance()
        } catch (e: any) {
            console.error(e)
            showError("Deposit failed: " + (e.shortMessage || e.message))
        }
    }

    async function handleBid() {
        if (!bidAmt || !walletClient || !channelId) return

        try {
            setIsSigning(true)
            const amountUsdcStr = bidAmt.replace(',', '.')
            if (isNaN(Number(amountUsdcStr))) { showError("Invalid amount format"); setIsSigning(false); return }

            const amount = parseUnits(amountUsdcStr, USDC_DECIMALS)

            const statePayload = {
                channelId: channelId as `0x${string}`,
                balance: amount,
                counterparty: sepoliaConfig?.guestAddress || '0x1111111111111111111111111111111111111111',
                nonce: BigInt(Date.now())
            }

            const domain = {
                name: 'Yellow Nitrolite',
                version: '1',
                chainId: CHAIN_ID,
                verifyingContract: sepoliaConfig?.adjudicator || '0x0000000000000000000000000000000000000000',
            } as const

            const types = {
                State: [
                    { name: 'channelId', type: 'bytes32' },
                    { name: 'balance', type: 'uint256' },
                    { name: 'counterparty', type: 'address' },
                    { name: 'nonce', type: 'uint256' }
                ],
            } as const

            const signature = await walletClient.signTypedData({
                domain,
                types,
                primaryType: 'State',
                message: statePayload
            })

            await sendBid(statePayload, signature, address as `0x${string}`)
            setBidAmt('')
            setIsSigning(false)
        } catch (e: any) {
            console.error(e)
            showError("Bid failed: " + (e.shortMessage || e.message))
            setIsSigning(false)
        }
    }

    async function handleRequestWd() {
        if (!wdAmt && !withdrawalReq) return
        try {
            await requestWithdrawal(wdAmt)
            setWdAmt('')
            refetchWithdrawal()
        } catch (e: any) { console.error(e); showError("Failed: " + (e.shortMessage || e.message)) }
    }

    async function handleExecuteWd() {
        try {
            await executeWithdrawal()
            refetchBalance()
            refetchWithdrawal()
        } catch (e: any) { console.error(e); showError("Failed: " + (e.shortMessage || e.message)) }
    }

    const topBid = bids[0]

    // Timelock logic for withdrawals
    const unlockTimeMs = withdrawalReq ? Number((withdrawalReq as any)[1]) * 1000 : 0
    const [timeToUnlock, setTimeToUnlock] = useState(0)

    useEffect(() => {
        if (!unlockTimeMs) return
        const iv = setInterval(() => {
            setTimeToUnlock(Math.max(0, unlockTimeMs - Date.now()))
        }, 1000)
        return () => clearInterval(iv)
    }, [unlockTimeMs])

    // Derived labels
    // The following line was not present in the original document, but is implied by the instruction's context.
    // Adding it here to allow the subsequent injection to be syntactically correct.
    const titleText = nftName ? nftName.toUpperCase() : 'LOADING...'

    // Rely strictly on dynamically resolved metadata from the hook
    const actualNftImage = nftImage

    return (
        <div className="space-y-4 relative">
            {/* Global Error Toast */}
            <AnimatePresence>
                {globalError && (
                    <motion.div
                        initial={{ opacity: 0, y: -20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        className="fixed top-4 left-1/2 -translate-x-1/2 z-50 bg-red-600 text-white px-6 py-3 border-2 border-red-800 shadow-[4px_4px_0px_#450a0a] font-mono text-sm max-w-md w-full flex items-start justify-between"
                    >
                        <span>{globalError}</span>
                        <button onClick={() => setGlobalError(null)} className="ml-4 font-bold hover:text-black">X</button>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Navigation aid */}
            <Link href="/" className="inline-flex items-center text-xs tracking-widest uppercase font-mono text-[#666] hover:text-white transition-colors">
                <ArrowLeft size={14} className="mr-2" /> Return to Index
            </Link>

            <div className="grid lg:grid-cols-2 gap-px bg-[#333] border border-[#333] selection:bg-[#F5D90A] selection:text-black">

                {/* LEFT COLUMN: Editoral Poster */}
                <div className="bg-black flex flex-col justify-between min-h-[600px] p-6 md:p-12 relative overflow-hidden">
                    <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-[#F5D90A] opacity-[0.03] blur-[150px] pointer-events-none" />
                    <div className="space-y-4 relative z-10">
                        <div className="flex items-center justify-between brutal-border py-2 px-3 inline-flex bg-black">
                            <span className="text-xs uppercase tracking-[0.2em] font-bold">Lot No. 0{auctionId.toString()}</span>
                            <CircleDashed size={14} className="text-[#666] ml-4" />
                        </div>
                        <h1 className="text-6xl md:text-8xl font-extrabold uppercase leading-[0.85] font-display tracking-tighter break-words">
                            {nftName ? nftName : 'UNKNOWN\nARTIFACT'}
                        </h1>
                        <p className="max-w-md text-sm text-[#888] leading-relaxed pt-2 font-mono break-all">
                            {nftContract ? `Contract: ${nftContract}` : 'A demonstrative cryptographic artifact showcasing zero-gas, high-frequency bidding capabilities via Yellow Network State Channels and Base Mainnet settlement.'}
                        </p>
                    </div>

                    {/* Abstract structural 'image' OR REAL NFT IMAGE */}
                    <div className="mt-6 w-full aspect-square border border-[#333] relative flex items-center justify-center overflow-hidden bg-[#0A0A0A]">
                        {actualNftImage ? (
                            <img src={actualNftImage} alt="NFT Payload" className="w-full h-full object-cover relative z-10" />
                        ) : (
                            <>
                                <div className="absolute inset-0 bg-[url('https://transparenttextures.com/patterns/stardust.png')] opacity-20" />
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
                                    className="w-3/4 h-3/4 border-t border-l border-white/20 absolute"
                                />
                                <motion.div
                                    animate={{ rotate: -360 }}
                                    transition={{ duration: 80, repeat: Infinity, ease: "linear" }}
                                    className="absolute w-1/2 h-1/2 border-b border-r border-[#F5D90A]/50"
                                />
                                <div className="absolute inset-0 flex items-center justify-center">
                                    <SquareTerminal size={48} className="text-[#333]" />
                                </div>
                            </>
                        )}
                        <div className="absolute bottom-4 left-4 right-4 flex justify-between items-end text-[10px] uppercase font-mono text-[#666] z-20 mix-blend-difference text-white">
                            <span>Token ID: {nftTokenId?.toString() ?? '...'}</span>
                            <span>{nftImage ? 'Verified Base Asset' : 'Unverified Origin'}</span>
                        </div>
                    </div>
                </div>

                {/* RIGHT COLUMN: Terminal & Action */}
                <div className="bg-[#050505] flex flex-col gap-px relative z-10">

                    {/* Telemetry Header */}
                    <div className="grid grid-cols-2 gap-px bg-[#333] border-b border-[#333]">
                        <div className="bg-[#0A0A0A] p-6 space-y-2">
                            <span className="text-[10px] text-[#666] tracking-widest uppercase block">Time Remaining</span>
                            <span className="text-3xl md:text-5xl font-light text-white font-mono tracking-tighter flex items-center">
                                {effectiveEnd ? timer : '—'}
                            </span>
                        </div>
                        <div className="bg-[#0A0A0A] p-6 space-y-2 flex flex-col items-end text-right">
                            <span className="text-[10px] text-[#666] tracking-widest uppercase block">Current Ask</span>
                            <span className="text-3xl md:text-5xl font-light text-[#F5D90A] font-mono tracking-tighter">
                                {topBid ? fmt(BigInt(topBid.amount ?? '0x0')) : '0.00'}
                            </span>
                            <span className="text-[10px] text-[#666]">USDC</span>
                        </div>
                    </div>

                    {/* Operational Panel */}
                    <div className="p-6 md:p-12 space-y-12">
                        <div className="flex items-center justify-between border-b border-[#333] pb-4">
                            <div className="flex gap-4">
                                <button onClick={() => setActiveTab('TRADE')} className={`text-[10px] uppercase tracking-widest font-bold ${activeTab === 'TRADE' ? 'text-white border-b-2 border-white pb-3 -mb-4' : 'text-[#666]'}`}>Trading</button>
                                <button onClick={() => setActiveTab('ASSETS')} className={`text-[10px] uppercase tracking-widest font-bold ${activeTab === 'ASSETS' ? 'text-white border-b-2 border-white pb-3 -mb-4' : 'text-[#666]'}`}>My Assets</button>
                            </div>
                            <div className="space-y-1 text-right">
                                <span className="text-[10px] text-[#666] uppercase tracking-widest block">Escrow Balance</span>
                                <span className="text-lg font-mono">{fmt(balance as bigint | undefined)} USDC</span>
                            </div>
                        </div>

                        {!isConnected ? (
                            <div className="border border-[#333] p-8 text-center bg-[#0A0A0A]">
                                <p className="text-sm text-[#888] mb-6 font-mono uppercase">Wallet connection required.</p>
                                <p className="text-[10px] text-[#F5D90A] mb-2 uppercase tracking-widest">Connect via Header</p>
                            </div>
                        ) : (
                            <div className="bg-[#0A0A0A] border border-[#333] p-6">
                                {activeTab === 'TRADE' ? (
                                    <div className="space-y-8">
                                        <div className="space-y-2">
                                            <h3 className="font-display text-[#F5D90A] uppercase text-lg tracking-widest flex items-center justify-between">
                                                Execute Bid
                                                <div className="flex items-center gap-2 font-mono">
                                                    <div className={`w-1.5 h-1.5 ${wsStatus === 'ready' ? 'bg-[#F5D90A] animate-pulse' : 'bg-red-500'}`} />
                                                    <span className="text-[10px] uppercase text-[#666]">{wsStatus}</span>
                                                </div>
                                            </h3>
                                            <p className="text-[10px] text-[#666] leading-relaxed uppercase pr-4">
                                                Generate zero-gas EIP-712 signature. Broadcast via Yellow Network.
                                            </p>
                                            <p className="text-[10px] text-[#F5D90A] leading-relaxed font-bold font-mono">
                                                In simple terms, your bids cost zero gas :)
                                            </p>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={bidAmt}
                                                    onChange={e => setBidAmt(e.target.value.replace(/[^0-9.,]/g, ''))}
                                                    placeholder="0.00"
                                                    className="w-full bg-transparent border-b border-[#333] py-2 text-3xl font-mono focus:outline-none focus:border-[#F5D90A] text-[#F5D90A] transition-colors placeholder:text-[#F5D90A]/20"
                                                />
                                                <span className="absolute right-0 top-4 text-[10px] text-[#444]">USDC</span>
                                            </div>
                                            {bidAmt && topBid && Number(bidAmt.replace(',', '.')) <= Number(formatUnits(BigInt(topBid.amount ?? '0x0'), USDC_DECIMALS)) && (
                                                <div className="text-red-500 text-xs font-mono mt-1">Bid must be higher than {fmt(BigInt(topBid.amount ?? '0x0'))} USDC</div>
                                            )}
                                            <button
                                                onClick={handleBid}
                                                disabled={isSigning || !bidAmt || wsStatus !== 'ready' || (topBid && Number(bidAmt.replace(',', '.')) <= Number(formatUnits(BigInt(topBid.amount ?? '0x0'), USDC_DECIMALS)))}
                                                className="bg-[#F5D90A] text-black hover:bg-white w-full py-4 mt-6 text-xs tracking-widest uppercase font-bold transition-colors disabled:opacity-50 disabled:bg-[#333] disabled:text-[#666] flex justify-between px-4 items-center cursor-pointer"
                                            >
                                                <span>{isSigning ? 'Awaiting Signature' : 'Sign Payload'}</span>
                                                <ArrowRight size={14} />
                                            </button>
                                        </div>

                                        {/* Onboarding Guide */}
                                        <div className="pt-8 mt-8 border-t border-[#222]">
                                            <h4 className="text-[10px] text-[#F5D90A] uppercase tracking-widest mb-4 font-bold">How to participate</h4>
                                            <ol className="text-xs text-[#888] font-mono leading-relaxed space-y-4 list-decimal pl-4">
                                                <li><strong className="text-white">Deposit USDC:</strong> Head to the "My Assets" tab above and deposit USDC into the secure smart contract. This provides proof of funds without spending it yet. You can withdraw your full balance back to your wallet at any time if you lose.</li>
                                                <li><strong className="text-white">Bid with Zero Gas:</strong> Once deposited, you can sign as many bids as you want here for free. Each signature is validated instantly via Yellow Network State Channels.</li>
                                                <li><strong className="text-white">Settlement:</strong> When the timer ends, our Relayer automatically submits the highest signed bid to the blockchain, transferring the precise USDC amount and sending the NFT payload to the winner.</li>
                                            </ol>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-8">
                                        {/* Deposit */}
                                        <div className="flex flex-col gap-2 pb-6 border-b border-[#222]">
                                            <div className="space-y-2 mb-2">
                                                <h3 className="font-display uppercase text-sm tracking-widest text-white">Deposit to Escrow</h3>
                                                <p className="text-[10px] text-[#666] uppercase">Commit USDC to enable zero-gas bidding.</p>
                                            </div>
                                            <div className="relative">
                                                <input
                                                    type="text"
                                                    value={depositAmt}
                                                    onChange={e => setDepositAmt(e.target.value.replace(/[^0-9.,]/g, ''))}
                                                    placeholder="0.00"
                                                    className="w-full bg-transparent border-b border-[#333] py-2 text-xl font-mono focus:outline-none focus:border-white transition-colors"
                                                />
                                                <span className="absolute right-0 top-3 text-[10px] text-[#444]">USDC</span>
                                            </div>
                                            <button
                                                onClick={handleDeposit}
                                                disabled={isDepositing || !depositAmt}
                                                className="brutal-button w-full py-3 mt-2 text-[10px] tracking-widest uppercase flex justify-between px-4 items-center"
                                            >
                                                <span>{isDepositing ? 'Processing' : 'Execute Deposit'}</span>
                                                <ArrowRight size={12} />
                                            </button>
                                        </div>

                                        {/* Withdraw */}
                                        <div className="flex flex-col gap-2">
                                            <div className="space-y-2 mb-2">
                                                <h3 className="font-display uppercase text-sm tracking-widest text-white">Withdraw Funds</h3>
                                                <p className="text-[10px] text-[#666] uppercase">5 minute anti-griefing timelock applies.</p>
                                            </div>

                                            {withdrawalReq && Number((withdrawalReq as any)[0]) > 0 ? (
                                                <div className="bg-[#111] border border-[#333] p-4 text-center">
                                                    <p className="text-xs text-white font-mono">{fmt((withdrawalReq as any)[0] as bigint)} USDC queued</p>
                                                    {timeToUnlock > 0 ? (
                                                        <p className="text-[10px] text-[#F5D90A] mt-2 font-mono">Unlocks in {Math.ceil(timeToUnlock / 1000)}s</p>
                                                    ) : (
                                                        <button onClick={handleExecuteWd} disabled={isExecWd} className="brutal-button w-full py-2 mt-4 text-[10px]">
                                                            {isExecWd ? 'Executing...' : 'Complete Withdrawal'}
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="relative">
                                                        <input
                                                            type="number"
                                                            value={wdAmt}
                                                            onChange={e => setWdAmt(e.target.value)}
                                                            placeholder="0.00"
                                                            className="w-full bg-transparent border-b border-[#333] py-2 text-xl font-mono focus:outline-none focus:border-white transition-colors"
                                                        />
                                                    </div>
                                                    <button
                                                        onClick={handleRequestWd}
                                                        disabled={isReqWd || !wdAmt}
                                                        className="border border-[#F5D90A] text-[#F5D90A] hover:bg-[#F5D90A] hover:text-black w-full py-3 mt-2 text-[10px] tracking-widest uppercase transition-colors flex justify-center items-center"
                                                    >
                                                        {isReqWd ? 'Requesting...' : 'Request Withdrawal (Timelock)'}
                                                    </button>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                    </div>

                    {/* High-Frequency Feed */}
                    <div className="flex-1 min-h-[300px] border-t border-[#333] bg-[#0A0A0A] p-6 lg:p-12 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-[300px] h-[300px] bg-white opacity-[0.01] blur-[100px] pointer-events-none" />

                        <div className="flex items-center justify-between mb-8 border-b border-[#222] pb-2 relative z-10">
                            <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#666]">Ledger Activity</span>
                            <div className="flex gap-2 items-center">
                                <span className="w-1.5 h-1.5 bg-[#666] animate-pulse rounded-full" />
                                <span className="text-[10px] uppercase font-mono text-[#444]">Live Connection</span>
                            </div>
                        </div>

                        <div className="space-y-4 relative z-10">
                            {bids.length === 0 ? (
                                <div className="text-[#444] text-xs font-mono uppercase tracking-widest h-[200px] flex items-center justify-center border border-dashed border-[#222]">
                                    [ Awaiting Network Signals... ]
                                </div>
                            ) : (
                                <div className="space-y-0 text-sm font-mono overflow-y-auto max-h-[400px] pr-4 custom-scrollbar">
                                    <AnimatePresence initial={false}>
                                        {bids.map((bid, i) => (
                                            <motion.div
                                                key={bid.sig + i}
                                                initial={{ opacity: 0, x: -10, backgroundColor: '#111' }}
                                                animate={{ opacity: 1, x: 0, backgroundColor: 'transparent' }}
                                                transition={{ duration: 0.4 }}
                                                className={`grid grid-cols-12 gap-4 py-3 border-b border-[#222] items-center hover:bg-[#111] transition-colors ${i === 0 ? 'text-white' : 'text-[#666]'}`}
                                            >
                                                <div className="col-span-3 text-[10px] opacity-70">
                                                    {new Date(bid.timestamp).toISOString().split('T')[1].replace('Z', '')}
                                                </div>
                                                <div className="col-span-6 truncate text-xs" title={bid.bidder}>
                                                    {bid.bidder}
                                                </div>
                                                <div className={`col-span-3 text-right flex flex-col ${i === 0 ? 'text-[#F5D90A]' : ''}`}>
                                                    <span className={`text-lg transition-transform ${i === 0 ? 'font-bold scale-110 origin-right' : ''}`}>
                                                        {fmt(BigInt(bid.amount ?? '0x0'))}
                                                    </span>
                                                    {i === 0 && <span className="text-[8px] uppercase tracking-widest text-[#F5D90A]/70">Leading Ask</span>}
                                                </div>
                                            </motion.div>
                                        ))}
                                    </AnimatePresence>
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    )
}
