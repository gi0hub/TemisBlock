'use client'

import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseUnits, formatUnits } from 'viem'
import type { Address } from 'viem'
import { TEMISBLOCK_ABI } from '@/lib/abi'
import { TEMISBLOCK_ADDRESS, USDC_ADDRESS, USDC_DECIMALS } from '@/lib/config'

// -- ERC-20 Approve ABI (minimal) -------------------------------------------
const ERC20_ABI = [
    {
        name: 'approve',
        type: 'function',
        inputs: [
            { name: 'spender', type: 'address' },
            { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ type: 'bool' }],
        stateMutability: 'nonpayable',
    },
    {
        name: 'allowance',
        type: 'function',
        inputs: [
            { name: 'owner', type: 'address' },
            { name: 'spender', type: 'address' },
        ],
        outputs: [{ type: 'uint256' }],
        stateMutability: 'view',
    },
] as const

// ---------------------------------------------------------------------------

/** Returns the USDC balance the user has locked inside TemisBlock */
export function useTemisBalance() {
    const { address } = useAccount()
    return useReadContract({
        address: TEMISBLOCK_ADDRESS,
        abi: TEMISBLOCK_ABI,
        functionName: 'balances',
        args: address ? [address, USDC_ADDRESS] : undefined,
        query: { enabled: !!address, refetchInterval: 10_000 },
    })
}

/** Returns the pending withdrawal request for the connected user */
export function useWithdrawalRequest() {
    const { address } = useAccount()
    return useReadContract({
        address: TEMISBLOCK_ADDRESS,
        abi: TEMISBLOCK_ABI,
        functionName: 'withdrawalRequests',
        args: address ? [address, USDC_ADDRESS] : undefined,
        query: { enabled: !!address, refetchInterval: 10_000 },
    })
}

/** Returns auction data for a given auctionId */
export function useAuction(auctionId: bigint | undefined) {
    return useReadContract({
        address: TEMISBLOCK_ADDRESS,
        abi: TEMISBLOCK_ABI,
        functionName: 'auctions',
        args: auctionId !== undefined ? [auctionId] : undefined,
        query: { enabled: auctionId !== undefined, refetchInterval: 15_000 },
    })
}

/** Approve + Deposit USDC into TemisBlock */
export function useDeposit() {
    const { address } = useAccount()
    const { writeContractAsync, isPending, data: hash } = useWriteContract()
    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

    async function approve(amountUsdc: string) {
        const amount = parseUnits(amountUsdc, USDC_DECIMALS)
        return writeContractAsync({
            address: USDC_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [TEMISBLOCK_ADDRESS, amount],
        })
    }

    async function deposit(amountUsdc: string) {
        const amount = parseUnits(amountUsdc, USDC_DECIMALS)
        return writeContractAsync({
            address: TEMISBLOCK_ADDRESS,
            abi: TEMISBLOCK_ABI,
            functionName: 'deposit',
            args: [USDC_ADDRESS, amount],
        })
    }

    return { approve, deposit, isPending, isConfirming, isSuccess, address }
}

/** Queue a withdrawal */
export function useRequestWithdrawal() {
    const { writeContractAsync, isPending, data: hash } = useWriteContract()
    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

    async function requestWithdrawal(amountUsdc: string) {
        const amount = parseUnits(amountUsdc, USDC_DECIMALS)
        return writeContractAsync({
            address: TEMISBLOCK_ADDRESS,
            abi: TEMISBLOCK_ABI,
            functionName: 'requestWithdrawal',
            args: [USDC_ADDRESS, amount],
        })
    }

    return { requestWithdrawal, isPending, isConfirming, isSuccess }
}

/** Execute a queued withdrawal after the timelock */
export function useExecuteWithdrawal() {
    const { writeContractAsync, isPending, data: hash } = useWriteContract()
    const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

    async function executeWithdrawal() {
        return writeContractAsync({
            address: TEMISBLOCK_ADDRESS,
            abi: TEMISBLOCK_ABI,
            functionName: 'executeWithdrawal',
            args: [USDC_ADDRESS],
        })
    }

    return { executeWithdrawal, isPending, isConfirming, isSuccess }
}

/** Format a raw bigint USDC amount to a human-readable string */
export function formatUsdc(raw: bigint | undefined): string {
    if (raw === undefined) return '—'
    return formatUnits(raw, USDC_DECIMALS)
}
