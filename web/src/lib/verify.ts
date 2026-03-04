import { recoverTypedDataAddress } from 'viem'
import { CHAIN_ID } from './config'
import type { Address } from 'viem'

export async function verifyBidSignature(
    statePayload: any,
    sig: `0x${string}`,
    adjudicatorAddr: string,
    expectedSigner: string
): Promise<boolean> {
    try {
        const domain = {
            name: 'Yellow Nitrolite',
            version: '1',
            chainId: CHAIN_ID,
            verifyingContract: adjudicatorAddr as Address,
        } as const

        const types = {
            State: [
                { name: 'channelId', type: 'bytes32' },
                { name: 'balance', type: 'uint256' },
                { name: 'counterparty', type: 'address' },
                { name: 'nonce', type: 'uint256' }
            ],
        } as const

        const messageFormatted = {
            channelId: statePayload.channelId,
            balance: BigInt(statePayload.balance),
            counterparty: statePayload.counterparty,
            nonce: BigInt(statePayload.nonce)
        }

        const recovered = await recoverTypedDataAddress({
            domain,
            types,
            primaryType: 'State',
            message: messageFormatted,
            signature: sig,
        })

        console.log(`[API] EIP-712 Recovery - expected: ${expectedSigner} | recovered: ${recovered}`)

        return recovered.toLowerCase() === expectedSigner.toLowerCase()
    } catch (e) {
        console.error("[API] Signature recovery throw error:", e)
        return false
    }
}
