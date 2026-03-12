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
        image: `${BASE_URL}/nft/2.png`,
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
        image: `${BASE_URL}/nft/3.png`,
        external_url: `${BASE_URL}/auction/2`,
        attributes: [
            { trait_type: 'Protocol', value: 'TemisBlock' },
            { trait_type: 'Network', value: 'Base Mainnet' },
            { trait_type: 'Series', value: 'Charged Fragment' },
            { trait_type: 'Edition', value: '3 of 3' },
            { trait_type: 'Settlement Layer', value: 'Yellow Network' },
        ],
    },
    '4': {
        name: 'Temis Artifact #4 — Cyber-Core',
        description: 'A futuristic brutalist cyber-core floating in an obsidian void. Securely encapsulates bidding state for high-frequency settlement channels.',
        image: `${BASE_URL}/nft/4.png`,
        external_url: `${BASE_URL}/`,
        attributes: [
            { trait_type: 'Protocol', value: 'TemisBlock' },
            { trait_type: 'Network', value: 'Base Mainnet' },
            { trait_type: 'Series', value: 'Cyber-Core' },
            { trait_type: 'Edition', value: '1 of 1' },
            { trait_type: 'Settlement Layer', value: 'Yellow Network' },
        ],
    },
}

export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    const { id } = await params
    const metadata = METADATA[id]

    if (!metadata) {
        return NextResponse.json({ error: 'Token not found' }, { status: 404 })
    }

    // Dynamically derive the base URL from the request host to avoid dead links
    // if the user hasn't set up the temisblock.vercel.app domain
    const host = req.headers.get('host') || 'localhost:3000'
    const protocol = host.includes('localhost') ? 'http' : 'https'
    const dynamicBaseUrl = `${protocol}://${host}`

    const dynamicMetadata = {
        ...metadata,
        image: (metadata as any).image.replace(BASE_URL, dynamicBaseUrl),
        external_url: (metadata as any).external_url.replace(BASE_URL, dynamicBaseUrl)
    }

    return NextResponse.json(dynamicMetadata, {
        headers: {
            'Cache-Control': 'public, max-age=86400',
            'Content-Type': 'application/json',
        },
    })
}
