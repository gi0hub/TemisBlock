import { CHAIN_ID, TEMISBLOCK_ADDRESS } from './config'
import type { Address } from 'viem'

// ── EIP-712 Types (must match TemisBlock.sol exactly) ───────────────────────

export const BID_DOMAIN = {
    name: 'TemisBlock',
    version: '1',
    chainId: CHAIN_ID,
    verifyingContract: TEMISBLOCK_ADDRESS as Address,
} as const

export const BID_TYPES = {
    Bid: [
        { name: 'auctionId', type: 'uint256' },
        { name: 'bidder', type: 'address' },
        { name: 'amount', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
    ],
} as const

// ── Bid message type ─────────────────────────────────────────────────────────

export interface BidMessage {
    auctionId: bigint
    bidder: Address
    amount: bigint
    /** nonce must equal auctionId per contract requirement */
    nonce: bigint
}

export function buildBidMessage(
    auctionId: bigint,
    bidder: Address,
    amount: bigint,
): BidMessage {
    return { auctionId, bidder, amount, nonce: auctionId }
}
