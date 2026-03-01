# TemisBlock

NFT auction platform with off-chain bidding via Yellow Network state channels and on-chain settlement.

## Structure

```
contracts/   — Foundry: TemisBlock.sol (ERC721 escrow, EIP-712, two-step withdrawal)
web/         — Next.js frontend + API routes
documentation/ — Yellow Network / Nitrolite SDK docs
```

## Contracts setup

```bash
cd contracts
forge install openzeppelin/openzeppelin-contracts --no-git
forge install foundry-rs/forge-std --no-git
forge build
forge test -vv
```
