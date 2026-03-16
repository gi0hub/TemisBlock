import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http } from 'viem'
import { TEMISBLOCK_ADDRESS, USDC_ADDRESS, CHAIN } from '@/lib/config'
import { TEMISBLOCK_ABI } from '@/lib/abi'
import { purgeUnderfundedBids } from '@/lib/state'
import type { Address } from 'viem'

/**
 * POST /api/withdraw-notify
 * Call this after a withdrawal is confirmed on-chain.
 * Fetches the bidder's current escrow balance and purges any bids that are now underfunded.
 *
 * Body: { bidder: string }
 */
export async function POST(req: NextRequest) {
    try {
        const { bidder } = await req.json()

        if (!bidder || typeof bidder !== 'string') {
            return NextResponse.json({ error: 'Missing bidder address' }, { status: 400 })
        }

        const publicClient = createPublicClient({ chain: CHAIN, transport: http() })

        const onChainBalance = await publicClient.readContract({
            address: TEMISBLOCK_ADDRESS,
            abi: TEMISBLOCK_ABI,
            functionName: 'balances',
            args: [bidder as Address, USDC_ADDRESS],
        }) as bigint

        const purged = await purgeUnderfundedBids(bidder, onChainBalance)

        return NextResponse.json({ ok: true, purged, newBalance: onChainBalance.toString() })
    } catch (err) {
        console.error('[/api/withdraw-notify]', err)
        return NextResponse.json({ error: 'Internal error' }, { status: 500 })
    }
}
