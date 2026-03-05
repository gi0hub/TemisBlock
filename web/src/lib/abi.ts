// Auto-extracted from contracts/out/TemisBlock.sol/TemisBlock.json
// Run `forge build` in /contracts to regenerate.
export const TEMISBLOCK_ABI = [
    // ── Read ──────────────────────────────────────────────────────────────────
    {
        "inputs": [{ "internalType": "address", "name": "user", "type": "address" }, { "internalType": "address", "name": "token", "type": "address" }],
        "name": "balances",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "address", "name": "user", "type": "address" }, { "internalType": "address", "name": "token", "type": "address" }],
        "name": "withdrawalRequests",
        "outputs": [
            { "internalType": "uint256", "name": "amount", "type": "uint256" },
            { "internalType": "uint256", "name": "unlockAt", "type": "uint256" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "auctionId", "type": "uint256" }],
        "name": "auctions",
        "outputs": [
            { "internalType": "address", "name": "seller", "type": "address" },
            { "internalType": "address", "name": "nftContract", "type": "address" },
            { "internalType": "uint256", "name": "tokenId", "type": "uint256" },
            { "internalType": "address", "name": "payToken", "type": "address" },
            { "internalType": "uint256", "name": "reservePrice", "type": "uint256" },
            { "internalType": "uint256", "name": "endTime", "type": "uint256" },
            { "internalType": "uint256", "name": "feeBps", "type": "uint256" },
            { "internalType": "bool", "name": "settled", "type": "bool" },
            { "internalType": "bool", "name": "cancelled", "type": "bool" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "nextAuctionId",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "withdrawalDelay",
        "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "owner",
        "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    // ── Write (user) ───────────────────────────────────────────────────────────
    {
        "inputs": [
            { "internalType": "address", "name": "token", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" }
        ],
        "name": "deposit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "token", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" }
        ],
        "name": "requestWithdrawal",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "address", "name": "token", "type": "address" }],
        "name": "cancelWithdrawal",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "address", "name": "token", "type": "address" }],
        "name": "executeWithdrawal",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "nftContract", "type": "address" },
            { "internalType": "uint256", "name": "tokenId", "type": "uint256" },
            { "internalType": "address", "name": "payToken", "type": "address" },
            { "internalType": "uint256", "name": "reservePrice", "type": "uint256" },
            { "internalType": "uint256", "name": "duration", "type": "uint256" }
        ],
        "name": "createAuction",
        "outputs": [{ "internalType": "uint256", "name": "auctionId", "type": "uint256" }],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    // ── Events ─────────────────────────────────────────────────────────────────
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "address", "name": "user", "type": "address" },
            { "indexed": true, "internalType": "address", "name": "token", "type": "address" },
            { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
        ],
        "name": "Deposited",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "uint256", "name": "auctionId", "type": "uint256" },
            { "indexed": true, "internalType": "address", "name": "winner", "type": "address" },
            { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }
        ],
        "name": "AuctionSettled",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "uint256", "name": "auctionId", "type": "uint256" },
            { "indexed": true, "internalType": "address", "name": "seller", "type": "address" },
            { "indexed": false, "internalType": "address", "name": "nftContract", "type": "address" },
            { "indexed": false, "internalType": "uint256", "name": "tokenId", "type": "uint256" },
            { "indexed": false, "internalType": "address", "name": "payToken", "type": "address" },
            { "indexed": false, "internalType": "uint256", "name": "reservePrice", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "endTime", "type": "uint256" },
            { "indexed": false, "internalType": "uint256", "name": "feeBps", "type": "uint256" }
        ],
        "name": "AuctionCreated",
        "type": "event"
    },
    {
        "anonymous": false,
        "inputs": [
            { "indexed": true, "internalType": "uint256", "name": "auctionId", "type": "uint256" }
        ],
        "name": "AuctionCancelled",
        "type": "event"
    }
]

export const ERC721_ABI = [
    {
        "inputs": [{ "internalType": "address", "name": "to", "type": "address" }, { "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
        "name": "approve",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
        "name": "getApproved",
        "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [{ "internalType": "uint256", "name": "tokenId", "type": "uint256" }],
        "name": "tokenURI",
        "outputs": [{ "internalType": "string", "name": "", "type": "string" }],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [],
        "name": "name",
        "outputs": [{ "internalType": "string", "name": "", "type": "string" }],
        "stateMutability": "view",
        "type": "function"
    }
] as const
