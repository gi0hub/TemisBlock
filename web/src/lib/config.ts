import { base } from 'wagmi/chains'

export const TEMISBLOCK_ADDRESS =
  (process.env.NEXT_PUBLIC_TEMISBLOCK_ADDRESS || "0x19Ca9a84b6732b73F4c358c9e774295E6c8F3bdB") as `0x${string}`

export const USDC_ADDRESS =
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as const // Circle USDC on Base Mainnet

export const USDC_DECIMALS = 6

// ── Chain ────────────────────────────────────────────────────────────────────
export const CHAIN = base
export const CHAIN_ID = base.id // 8453

// ── Yellow / Nitrolite ───────────────────────────────────────────────────────
// Yellow Production WebSocket — transport only, does NOT hold funds.
// Addresses are fetched dynamically via get_config on first connect.
export const CLEARNODE_WS_URL = 'wss://clearnet.yellow.com/ws'

// ── Auction rules (off-chain enforced by the backend) ──────────────────────
/** Extend endTime by 1 min if a bid arrives within this window of endTime */
export const ANTI_SNIPE_WINDOW_MS = 5 * 60 * 1000  // 5 minutes
export const ANTI_SNIPE_EXTEND_MS = 1 * 60 * 1000  // +1 minute

// ── Settlement grace period (mirrors the contract constant) ─────────────────
export const SETTLE_GRACE_PERIOD_MS = 24 * 60 * 60 * 1000 // 24 hours
