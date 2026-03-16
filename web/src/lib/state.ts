import { Redis } from '@upstash/redis'

/**
 * Edge-compatible Redis store using Upstash for generic persistence across serverless.
 */
const redis = Redis.fromEnv()

export interface StoredBid {
    auctionId: string
    bidder: string
    amount: string  // Changed from bigint to string for Redis JSON compatibility
    amountHex: string
    sig: string
    timestamp: number
}

// Memory map strictly for live SSE connection callbacks per instance
const subscribers = new Map<string, Set<(bid: StoredBid) => void>>()

// ---------------------------------------------------------------------------

export async function getEffectiveEndTime(auctionId: string): Promise<number | undefined> {
    const time = await redis.get<number>(`auction:${auctionId}:endTime`)
    return time ?? undefined
}

export async function setEffectiveEndTime(auctionId: string, endTime: number): Promise<void> {
    await redis.set(`auction:${auctionId}:endTime`, endTime)
}

/** Returns the top bid for this auction (highest amount) */
export async function getTopBid(auctionId: string): Promise<StoredBid | undefined> {
    const bids = await getAllBids(auctionId)
    return bids[0]
}

export async function getAllBids(auctionId: string): Promise<StoredBid[]> {
    const bids = await redis.get<StoredBid[]>(`auction:${auctionId}:bids`)
    return bids ?? []
}

function safeBigInt(val: string | undefined): bigint {
    if (!val) return 0n
    try {
        return BigInt(val)
    } catch (e) {
        return 0n
    }
}

/** Insert and sort. Returns the inserted bid. */
export async function insertBid(bid: StoredBid): Promise<StoredBid> {
    const list = await getAllBids(bid.auctionId)

    // Check if signature already exists
    if (list.some(b => b.sig === bid.sig)) {
        return bid
    }

    list.push(bid)

    // Sort descending by numeric amount string reconstruction
    list.sort((a, b) => {
        const bigA = safeBigInt(a.amount)
        const bigB = safeBigInt(b.amount)
        return bigB > bigA ? 1 : bigB < bigA ? -1 : 0
    })

    await redis.set(`auction:${bid.auctionId}:bids`, list)
    notifySubscribers(bid.auctionId, bid)
    return bid
}

/**
 * Remove all bids from `bidder` across ALL auctions where their bid exceeds `newBalance`.
 * Call this after a withdrawal is confirmed on-chain.
 * Returns the number of bids purged.
 */
export async function purgeUnderfundedBids(bidder: string, newBalance: bigint): Promise<number> {
    // Scan all auction bid keys in Redis
    const keys: string[] = []
    let cursor = 0
    do {
        const [nextCursor, batch] = await redis.scan(cursor, { match: 'auction:*:bids', count: 100 })
        cursor = Number(nextCursor)
        keys.push(...batch)
    } while (cursor !== 0)

    let purged = 0
    for (const key of keys) {
        const bids = await redis.get<StoredBid[]>(key)
        if (!bids || bids.length === 0) continue

        const filtered = bids.filter(b => {
            if (b.bidder.toLowerCase() !== bidder.toLowerCase()) return true
            const bidAmt = safeBigInt(b.amount)
            return bidAmt <= newBalance  // keep only bids the user can still back
        })

        if (filtered.length !== bids.length) {
            purged += bids.length - filtered.length
            await redis.set(key, filtered)
        }
    }
    return purged
}

/** Register an SSE subscriber */
export function subscribe(auctionId: string, cb: (bid: StoredBid) => void): () => void {
    if (!subscribers.has(auctionId)) subscribers.set(auctionId, new Set())
    subscribers.get(auctionId)!.add(cb)
    return () => subscribers.get(auctionId)?.delete(cb)
}

function notifySubscribers(auctionId: string, bid: StoredBid) {
    subscribers.get(auctionId)?.forEach(cb => cb(bid))
}
