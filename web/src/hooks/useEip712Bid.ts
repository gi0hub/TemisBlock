'use client'

import { useSignTypedData, useAccount } from 'wagmi'
import { BID_DOMAIN, BID_TYPES, buildBidMessage } from '@/lib/eip712'
import type { Address } from 'viem'

export function useEip712Bid() {
    const { address } = useAccount()
    const { signTypedDataAsync, isPending } = useSignTypedData()

    async function signBid(auctionId: bigint, amountUsdc: bigint): Promise<{
        bid: ReturnType<typeof buildBidMessage>
        sig: `0x${string}`
    }> {
        if (!address) throw new Error('Wallet not connected')

        const bid = buildBidMessage(auctionId, address as Address, amountUsdc)

        const sig = await signTypedDataAsync({
            domain: BID_DOMAIN,
            types: BID_TYPES,
            primaryType: 'Bid',
            message: {
                auctionId: bid.auctionId,
                bidder: bid.bidder,
                amount: bid.amount,
                nonce: bid.nonce,
            },
        })

        return { bid, sig }
    }

    return { signBid, isPending, connected: !!address }
}
