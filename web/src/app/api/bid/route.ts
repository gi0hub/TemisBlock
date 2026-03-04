import { NextRequest, NextResponse } from 'next/server'
import { verifyBidSignature } from '@/lib/verify'
import { insertBid, getEffectiveEndTime, setEffectiveEndTime, getTopBid } from '@/lib/state'
import { ANTI_SNIPE_WINDOW_MS, ANTI_SNIPE_EXTEND_MS, TEMISBLOCK_ADDRESS, USDC_ADDRESS, CHAIN } from '@/lib/config'
import { TEMISBLOCK_ABI } from '@/lib/abi'
import { createPublicClient, http } from 'viem'
import { Redis } from '@upstash/redis'
import { Ratelimit } from '@upstash/ratelimit'
import type { Address } from 'viem'

// Initialize Ratelimiter: 10 requests per 10 seconds per IP
const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(10, '10 s'),
    analytics: true,
})

export async function POST(req: NextRequest) {
    try {
        const body = await req.json()
        const { auctionId, bidder, amount: amountHex, statePayload, sig, adjudicator, timestamp } = body

        // DDoS Protection: Ratelimit by IP (fallback to 'anonymous' if headers missing)
        const ip = req.headers.get('x-forwarded-for') ?? 'anonymous'
        const { success } = await ratelimit.limit(ip)
        if (!success) {
            return NextResponse.json({ error: 'Too many requests. Please slow down.' }, { status: 429 })
        }

        if (!auctionId || !statePayload || !sig) {
            return NextResponse.json({ error: 'Missing payload fields' }, { status: 400 })
        }

        let amountBig: bigint
        try {
            amountBig = BigInt(statePayload.balance ?? "0")
        } catch (e) {
            return NextResponse.json({ error: 'Invalid balance format in state payload' }, { status: 400 })
        }
        const finalAmountHex = amountHex || `0x${amountBig.toString(16)}`

        if (!adjudicator) {
            return NextResponse.json({ error: 'Missing adjudicator address' }, { status: 400 })
        }

        // Verify EIP-712 signature against Yellow Nitrolite State structure
        const valid = await verifyBidSignature(
            statePayload,
            sig as `0x${string}`,
            adjudicator,
            bidder
        )

        if (!valid) {
            return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
        }

        // Must be higher than current top bid
        const topBid = await getTopBid(auctionId)
        if (topBid) {
            const currentTop = BigInt(topBid.amount || '0')
            if (amountBig <= currentTop) {
                return NextResponse.json({ error: 'Bid amount must be higher than current top bid' }, { status: 400 })
            }
        }

        // Anti-snipe: extend effectiveEndTime if bid arrives in last 5 minutes
        const effectiveEnd = await getEffectiveEndTime(auctionId)
        if (effectiveEnd !== undefined) {
            const now = Date.now()
            if (effectiveEnd - now < ANTI_SNIPE_WINDOW_MS) {
                await setEffectiveEndTime(auctionId, effectiveEnd + ANTI_SNIPE_EXTEND_MS)
            }
        }

        // Validate On-Chain Escrow Balance
        const publicClient = createPublicClient({
            chain: CHAIN,
            transport: http()
        })

        try {
            const onChainBalance = await publicClient.readContract({
                address: TEMISBLOCK_ADDRESS,
                abi: TEMISBLOCK_ABI,
                functionName: 'balances',
                args: [bidder as Address, USDC_ADDRESS]
            }) as bigint

            if (amountBig > onChainBalance) {
                return NextResponse.json({ error: 'Bid amount exceeds deposited escrow balance' }, { status: 400 })
            }
        } catch (e) {
            console.error('[/api/bid] Failed to fetch on-chain balance:', e)
            return NextResponse.json({ error: 'Failed to verify on-chain balance' }, { status: 500 })
        }

        // Store bid
        const stored = await insertBid({
            auctionId,
            bidder,
            amount: amountBig.toString(), // Store numeric string rather than raw bigint for Redis
            amountHex,
            sig,
            timestamp: timestamp ?? Date.now(),
        })

        return NextResponse.json({ ok: true, bid: stored })
    } catch (err) {
        console.error('[/api/bid]', err)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
