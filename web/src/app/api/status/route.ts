import { NextRequest, NextResponse } from 'next/server'
import { getAllBids, getEffectiveEndTime } from '@/lib/state'

export async function GET(req: NextRequest) {
    const auctionId = req.nextUrl.searchParams.get('auctionId')
    if (!auctionId) return NextResponse.json({ error: 'Missing auctionId' }, { status: 400 })

    const rawBids = await getAllBids(auctionId)
    // they are already strings from Redis inside state.ts mapping
    const bids = rawBids.map(b => ({ ...b, amount: b.amount }))
    const effectiveEndTime = await getEffectiveEndTime(auctionId) ?? null

    return NextResponse.json({ auctionId, bids, effectiveEndTime })
}
