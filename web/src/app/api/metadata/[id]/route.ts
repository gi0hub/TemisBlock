import { NextRequest, NextResponse } from 'next/server'

// ERC-721 standard metadata for TemisArtifacts collection
// Each token resolves to its art asset hosted statically on Vercel

const BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'https://temisblock.vercel.app'

const METADATA: Record<string, object> = {
    '1': {
        name: 'Temis Artifact #1 — Charged Fragment',
        description: 'A cryptographic artifact from the TemisBlock auction protocol. Fractured obsidian geometry illuminated by electric yellow veins — representing the high-energy flow of zero-gas bids through Yellow Network state channels.',
        image: `${BASE_URL}/nft/1.png`,
        external_url: `${BASE_URL}/auction/0`,
        attributes: [
            { trait_type: 'Protocol', value: 'TemisBlock' },
            { trait_type: 'Network', value: 'Base Mainnet' },
            { trait_type: 'Series', value: 'Charged Fragment' },
            { trait_type: 'Edition', value: '1 of 1' },
            { trait_type: 'Settlement Layer', value: 'Yellow Network' },
        ],
    },
    '2': {
        name: 'Temis Artifact #2 — Charged Fragment',
        description: 'Second edition of the Charged Fragment Series from the TemisBlock protocol. On-chain proof of a zero-gas bid executed across Yellow Network state channels.',
        image: `${BASE_URL}/nft/1.png`,
        external_url: `${BASE_URL}/auction/1`,
        attributes: [
            { trait_type: 'Protocol', value: 'TemisBlock' },
            { trait_type: 'Network', value: 'Base Mainnet' },
            { trait_type: 'Series', value: 'Charged Fragment' },
            { trait_type: 'Edition', value: '2 of 3' },
            { trait_type: 'Settlement Layer', value: 'Yellow Network' },
        ],
    },
    '3': {
        name: 'Temis Artifact #3 — Charged Fragment',
        description: 'Third edition of the Charged Fragment Series. Rare protocol artifact issued on Base Mainnet via TemisBlock.',
        image: `${BASE_URL}/nft/1.png`,
        external_url: `${BASE_URL}/auction/2`,
        attributes: [
            { trait_type: 'Protocol', value: 'TemisBlock' },
            { trait_type: 'Network', value: 'Base Mainnet' },
            { trait_type: 'Series', value: 'Charged Fragment' },
            { trait_type: 'Edition', value: '3 of 3' },
            { trait_type: 'Settlement Layer', value: 'Yellow Network' },
        ],
    },
}

export async function GET(
    _req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const metadata = METADATA[id]

    if (!metadata) {
        return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }

    return NextResponse.json(metadata, {
        headers: {
            'Cache-Control': 'public, max-age=86400',
            'Content-Type': 'application/json',
        },
    })
}
