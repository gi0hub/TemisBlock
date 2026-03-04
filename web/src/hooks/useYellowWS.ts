'use client'

import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import {
    NitroliteClient,
    createAuthRequestMessage,
    createAuthVerifyMessageFromChallenge
} from '@erc7824/nitrolite'
import { useWalletClient, usePublicClient } from 'wagmi'
import { CLEARNODE_WS_URL, CHAIN, CHAIN_ID, USDC_ADDRESS } from '@/lib/config'
import type { BidMessage } from '@/lib/eip712'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createWalletClient, http } from 'viem'

export interface YellowBid {
    auctionId: string
    bidder: string
    amount: string    // hex string (bigint serialised)
    sig: string
    timestamp: number
}

type Status = 'disconnected' | 'connecting' | 'authenticating' | 'ready' | 'error'

export function useYellowWS(auctionId: bigint | undefined) {
    const wsRef = useRef<WebSocket | null>(null)
    const [status, setStatus] = useState<Status>('disconnected')
    const [bids, setBids] = useState<YellowBid[]>([])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const [sepoliaConfig, setSepoliaConfig] = useState<any>(null)

    // Using configured global chainId.
    const publicClient = usePublicClient({ chainId: CHAIN_ID as any })

    // Background ephemeral wallet for Nitrolite Client to avoid MetaMask popups
    const sessionWalletClient = useMemo(() => {
        const storageKey = 'yellow_session_pk'
        let pk = typeof window !== 'undefined' ? localStorage.getItem(storageKey) : null
        if (!pk) {
            pk = generatePrivateKey()
            if (typeof window !== 'undefined') localStorage.setItem(storageKey, pk)
        }
        const account = privateKeyToAccount(pk as `0x${string}`)
        return createWalletClient({
            account,
            chain: CHAIN as any,
            transport: http()
        })
    }, [])

    // Step 1: Fetch dynamic config & Authenticate
    const fetchConfigAndAuth = useCallback(() => {
        if (wsRef.current?.readyState === WebSocket.OPEN) return
        setStatus('connecting')

        const ws = new WebSocket(CLEARNODE_WS_URL)
        wsRef.current = ws

        ws.onopen = async () => {
            setStatus('authenticating')

            // First send get_config to get the network variables
            const configReq = {
                req: [1, 'get_config', {}, Date.now()],
                sig: []
            }
            ws.send(JSON.stringify(configReq))

            try {
                // Auth Protocol - Step 1: Request Challenge
                const address = sessionWalletClient.account.address
                const authReq = await createAuthRequestMessage({
                    address,
                    session_key: address,
                    application: 'clearnode',
                    allowances: [],
                    expires_at: BigInt(Date.now() + 86400000), // 1 day
                    scope: 'session'
                })
                ws.send(authReq)
            } catch (e) {
                console.error("Auth request failed", e)
                setStatus('error')
            }
        }

        ws.onmessage = async (event) => {
            try {
                const response = JSON.parse(event.data)

                // Auth Protocol - Step 2: Handle Challenge
                if (response.res && response.res[1] === 'auth_challenge') {
                    const challengeStr = response.res[2]

                    // Adapt SessionWallet to MessageSigner interface for the SDK
                    // We must cast it to 'any' because Yellow's internal RPCData tuple type
                    // conflicts with viem's string/Uint8Array primitive expectation.
                    const messageSigner = (async (msg: any) => {
                        const payloadStr = typeof msg === 'string' ? msg : JSON.stringify(msg)
                        return sessionWalletClient.signMessage({
                            message: payloadStr
                        })
                    }) as any

                    const verifyMsg = await createAuthVerifyMessageFromChallenge(
                        messageSigner,
                        challengeStr
                    )
                    ws.send(verifyMsg)
                }

                // Auth Protocol - Step 3: Auth Success
                if (response.res && response.res[1] === 'auth_success') {
                    // Only become ready if we also have config
                    setStatus(prev => sepoliaConfig ? 'ready' : 'authenticating')
                }

                // Config trap
                if (response.res && response.res[1] === 'get_config') {
                    const payload = response.res[2]
                    let config = null

                    if (payload?.contracts) {
                        config = payload.contracts[CHAIN_ID] || payload.contracts[CHAIN_ID.toString()]
                    } else if (payload?.networks && Array.isArray(payload.networks)) {
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                        const netConfig = payload.networks.find((n: any) => n.chain_id === CHAIN_ID)
                        if (netConfig) {
                            config = {
                                custody: netConfig.custody_address,
                                adjudicator: netConfig.adjudicator_address,
                                guestAddress: netConfig.custody_address,
                                tokenAddress: USDC_ADDRESS
                            }
                        }
                    }

                    if (config) {
                        setSepoliaConfig(config)
                        // If we already passed auth success but were waiting on config
                        setStatus(prev => prev === 'authenticating' ? 'ready' : prev)
                    } else {
                        console.error('Network config not found in ClearNode')
                        setStatus('error')
                    }
                }

                // Intercept P2P push_state events
                const method = response.res?.[1] || response.method
                if (method === 'push_state' || method === 'message' || method === 'application_message') {
                    const rawPayload = response.res?.[2] || response.params

                    // Adapt the incoming raw state payload to our UI YellowBid format
                    let newBids: YellowBid[] = []

                    // If it's our push_state layout
                    if (rawPayload?.state && rawPayload?.signature) {
                        const b: YellowBid = {
                            auctionId: String(auctionId),
                            bidder: rawPayload.state.counterparty,
                            amount: `0x${BigInt(rawPayload.state.balance).toString(16)}`,
                            sig: rawPayload.signature,
                            timestamp: Date.now()
                        }
                        newBids.push(b)
                    } else if (rawPayload?.data && Array.isArray(rawPayload.data)) {
                        // Original fallback path for array of bids
                        newBids = rawPayload.data.filter(
                            (b: any) => b.auctionId === String(auctionId)
                        )
                    }

                    if (newBids.length > 0) {
                        setBids(prev => {
                            const unique = newBids.filter(nb => !prev.some(p => p.sig === nb.sig))
                            if (unique.length === 0) return prev
                            return [...prev, ...unique].sort((a, b) => b.timestamp - a.timestamp)
                        })
                    }
                }

            } catch (e) {
                console.error('Error parsing WS message', e)
            }
        }

        ws.onclose = () => {
            if (status !== 'error') {
                setStatus('disconnected')
                wsRef.current = null
            }
        }
        ws.onerror = (e) => {
            console.error('[Yellow] WS error', e)
            setStatus('error')
            wsRef.current = null
        }
    }, [auctionId, sepoliaConfig, sessionWalletClient])

    // Step 2: Initialize Nitrolite Client
    const nitrolite = useMemo(() => {
        if (!sepoliaConfig || !publicClient || !sessionWalletClient) return null
        try {
            return new NitroliteClient({
                chainId: CHAIN_ID,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                publicClient: publicClient as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                walletClient: sessionWalletClient as any,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                stateSigner: sessionWalletClient as any,
                addresses: sepoliaConfig,
                challengeDuration: 3600n
            })
        } catch (e) {
            console.error('Nitrolite SDK initialization failed:', e)
            return null
        }
    }, [sepoliaConfig, publicClient, sessionWalletClient])

    useEffect(() => {
        if (auctionId === undefined) return

        let reconnectTimer: NodeJS.Timeout

        if (status === 'disconnected') {
            // Basic backoff to avoid spamming the node
            reconnectTimer = setTimeout(() => {
                fetchConfigAndAuth()
            }, 3000)
        }

        return () => {
            if (reconnectTimer) clearTimeout(reconnectTimer)
        }
    }, [auctionId, status, fetchConfigAndAuth])

    // Mount cleanup logic explicitly mapped
    useEffect(() => {
        return () => {
            if (wsRef.current) {
                wsRef.current.close()
                wsRef.current = null
            }
        }
    }, [])

    // Sync bids SSE (fallback / source of truth for bids from our own backend)
    useEffect(() => {
        if (auctionId === undefined) return

        // Failsafe: Fetch initial status specifically inside this effect to guarantee load
        fetch(`/api/status?auctionId=${auctionId.toString()}`)
            .then(res => res.json())
            .then(data => {
                if (data.bids && Array.isArray(data.bids)) {
                    setBids(data.bids.map((b: any) => ({
                        ...b,
                        amount: b.amountHex || `0x${BigInt(b.amount).toString(16)}`
                    })).sort((a: any, b: any) => {
                        const bigA = BigInt(a.amount || '0x0')
                        const bigB = BigInt(b.amount || '0x0')
                        return bigB > bigA ? 1 : bigB < bigA ? -1 : 0
                    }))
                }
            }).catch(e => console.error('Status fetch failed', e))

        const eventSource = new EventSource(`/api/events?auctionId=${auctionId.toString()}`)
        eventSource.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                // Normalize amount to hex string for YellowBid interface compatibility
                let finalAmountHex = data.amount
                if (typeof data.amount === 'string') {
                    if (!data.amount.startsWith('0x')) {
                        finalAmountHex = `0x${BigInt(data.amount).toString(16)}`
                    }
                } else if (typeof data.amount === 'number' || typeof data.amount === 'bigint') {
                    finalAmountHex = `0x${BigInt(data.amount).toString(16)}`
                }

                const newBid: YellowBid = {
                    ...data,
                    amount: finalAmountHex,
                }
                setBids(prev => {
                    const exists = prev.some(p => p.sig === newBid.sig)
                    if (exists) return prev
                    const merged = [newBid, ...prev]
                    // Sort descending by amount to keep UI right
                    return merged.sort((a, b) => {
                        const bigA = BigInt(a.amount || '0x0')
                        const bigB = BigInt(b.amount || '0x0')
                        return bigB > bigA ? 1 : bigB < bigA ? -1 : 0
                    })
                })
            } catch (err) { console.error('SSE Error parsing bid', err) }
        }
        return () => eventSource.close()
    }, [auctionId])

    // Generate a secure 32-byte channel ID when connection is ready or explicit deposit
    const [channelId, setChannelId] = useState<string | null>(null)

    useEffect(() => {
        if (status === 'ready' && !channelId) {
            const randomHex = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
            setChannelId(`0x${randomHex}`)
        }
    }, [status, channelId])

    const sendBid = useCallback(async (statePayload: any, sig: string, bidder: `0x${string}`) => {
        const payload = {
            auctionId: auctionId?.toString() || "0",
            bidder,
            amount: `0x${BigInt(statePayload.balance).toString(16)}`, // Fallback amount 
            statePayload,
            sig,
            adjudicator: sepoliaConfig?.adjudicator,
            timestamp: Date.now(),
        }

        // Broadcast via Yellow Network if Nitrolite Client initialized
        if (wsRef.current && status === 'ready') {
            try {
                // Strict JSON replacer to prevent BigInt crash as specifically directed
                const rpcUpdate = {
                    req: [Date.now(), "push_state", { state: statePayload, signature: sig }, Date.now()],
                    sig: []
                };
                wsRef.current.send(JSON.stringify(rpcUpdate, (key, value) =>
                    typeof value === 'bigint' ? value.toString() : value
                ));
            } catch (e) { console.error('Yellow broadcast failed', e) }
        }

        // Always mirror to our backend
        const res = await fetch('/api/bid', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload, (key, value) =>
                typeof value === 'bigint' ? value.toString() : value
            ),
        })

        if (!res.ok) {
            const txt = await res.text()
            let errorMsg = txt
            try {
                const j = JSON.parse(txt)
                if (j.error) errorMsg = j.error
            } catch (e) { }
            throw new Error(errorMsg)
        }

        const resData = await res.json()
        if (resData.ok && resData.bid) {
            setBids(prev => {
                const exists = prev.some(p => p.sig === resData.bid.sig)
                if (exists) return prev

                const finalHex = resData.bid.amountHex || `0x${BigInt(resData.bid.amount).toString(16)}`
                const newB: YellowBid = { ...resData.bid, amount: finalHex }
                return [newB, ...prev].sort((a, b) => {
                    const bigA = BigInt(a.amount || '0x0')
                    const bigB = BigInt(b.amount || '0x0')
                    return bigB > bigA ? 1 : bigB < bigA ? -1 : 0
                })
            })
        }
    }, [status, auctionId, sepoliaConfig])

    return { status, bids, sepoliaConfig, channelId, sendBid }
}
