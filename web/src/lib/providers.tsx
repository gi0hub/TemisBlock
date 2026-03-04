'use client'

import { getDefaultConfig, RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit'
import { WagmiProvider } from 'wagmi'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { CHAIN } from './config'
import React, { useState } from 'react'

import '@rainbow-me/rainbowkit/styles.css'

const wagmiConfig = getDefaultConfig({
    appName: 'TemisBlock NFT Auctions',
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || '16b60bf43b7cf8c4a96b862dff9a5eb9',
    chains: [CHAIN],
    ssr: true,
})

export function Providers({ children }: { children: React.ReactNode }) {
    const [queryClient] = useState(() => new QueryClient())

    return (
        <WagmiProvider config={wagmiConfig}>
            <QueryClientProvider client={queryClient}>
                <RainbowKitProvider theme={darkTheme({
                    accentColor: '#6366f1',
                    accentColorForeground: 'white',
                    borderRadius: 'medium',
                })}>
                    {children}
                </RainbowKitProvider>
            </QueryClientProvider>
        </WagmiProvider>
    )
}
