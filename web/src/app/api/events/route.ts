import { NextRequest } from 'next/server'
import { subscribe, getAllBids } from '@/lib/state'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
    const auctionId = req.nextUrl.searchParams.get('auctionId')
    if (!auctionId) {
        return new Response('Missing auctionId', { status: 400 })
    }

    const encoder = new TextEncoder()
    let unsubscribe: (() => void) | undefined

    const stream = new ReadableStream({
        async start(controller) {
            // Signal aborted? Do nothing.
            if (req.signal.aborted) {
                return
            }

            // Send all existing bids first so the client syncs immediately
            const existing = await getAllBids(auctionId)
            for (const bid of existing) {
                const data = JSON.stringify({ ...bid, amount: bid.amount })
                try {
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`))
                } catch (e) { }
            }

            // Subscribe to future bids
            unsubscribe = subscribe(auctionId, (bid) => {
                const data = JSON.stringify({ ...bid, amount: bid.amount })
                try {
                    controller.enqueue(encoder.encode(`data: ${data}\n\n`))
                } catch (e) {
                    unsubscribe?.()
                }
            })

            // Immediately catch disconnections to prevent Next.js background enqueue crashes
            req.signal.addEventListener('abort', () => {
                unsubscribe?.()
            })
        },
        cancel() {
            unsubscribe?.()
        },
    })

    return new Response(stream, {
        headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        },
    })
}
