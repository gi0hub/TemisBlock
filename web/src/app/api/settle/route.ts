import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, createWalletClient, http, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { getTopBid } from '@/lib/state'
import { TEMISBLOCK_ADDRESS } from '@/lib/config'

const SETTLE_ABI = parseAbi([
    'function settleAuction((uint256 auctionId,address bidder,uint256 amount,uint256 nonce) calldata bid, bytes calldata sig) external',
])

export async function POST(req: NextRequest) {
    // Protect with a secret header
    const secret = req.headers.get('x-settlement-secret')
    if (secret !== process.env.SETTLEMENT_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { auctionId } = await req.json()
    if (!auctionId) return NextResponse.json({ error: 'Missing auctionId' }, { status: 400 })

    const topBid = await getTopBid(String(auctionId))
    if (!topBid) return NextResponse.json({ error: 'No bids found' }, { status: 404 })

    const relayerKey = process.env.RELAYER_PRIVATE_KEY
    if (!relayerKey) return NextResponse.json({ error: 'Relayer key not configured' }, { status: 500 })

    const account = privateKeyToAccount(relayerKey as `0x${string}`)
    const publicClient = createPublicClient({ chain: baseSepolia, transport: http() })
    const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http() })

    const bid = {
        auctionId: BigInt(topBid.auctionId),
        bidder: topBid.bidder as `0x${string}`,
        amount: BigInt(topBid.amount),
        nonce: BigInt(topBid.auctionId), // nonce === auctionId per contract
    }

    try {
        const hash = await walletClient.writeContract({
            address: TEMISBLOCK_ADDRESS,
            abi: SETTLE_ABI,
            functionName: 'settleAuction',
            args: [bid, topBid.sig as `0x${string}`],
        })

        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        return NextResponse.json({ ok: true, hash, blockNumber: receipt.blockNumber.toString() })
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        return NextResponse.json({ error: msg }, { status: 500 })
    }
}
