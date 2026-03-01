// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title TemisBlock
 * @notice Platform-level NFT auction contract. Sellers escrow ERC721 tokens;
 *         bids are signed off-chain (EIP-712) and the winning bid is submitted
 *         on-chain to settle. Withdrawals use a two-step pattern to prevent
 *         "hit & run" after settlement.
 *
 * Security properties:
 *  - ReentrancyGuard on all state-mutating externals
 *  - Checks-Effects-Interactions throughout
 *  - SafeERC20 for all ERC20 transfers
 *  - EIP-712 typed-data signature verification (no raw hashes)
 *  - Per-bidder nonce to prevent signature replay
 *  - Two-step withdrawal with configurable delay
 *  - emergencyCancel returns NFT to seller (owner-only)
 */
contract TemisBlock is IERC721Receiver, ReentrancyGuard, Ownable, EIP712 {
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    bytes32 private constant BID_TYPEHASH =
        keccak256("Bid(uint256 auctionId,address bidder,uint256 amount,uint256 nonce)");

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Auction {
        address seller;
        address nftContract;
        uint256 tokenId;
        address payToken;       // ERC20 used for bids
        uint256 reservePrice;
        uint256 endTime;
        bool settled;
        bool cancelled;
    }

    struct WithdrawalRequest {
        uint256 amount;
        uint256 unlockAt;
    }

    // EIP-712 struct mirrored in the frontend hook
    struct Bid {
        uint256 auctionId;
        address bidder;
        uint256 amount;
        uint256 nonce;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    uint256 public nextAuctionId;
    uint256 public withdrawalDelay = 1 hours;

    mapping(uint256 => Auction) public auctions;

    // bidder → nonce (incremented on every accepted settlement)
    mapping(address => uint256) public nonces;

    // seller/bidder → token → pending balance available to request withdrawal
    mapping(address => mapping(address => uint256)) public pendingBalances;

    // user → token → active withdrawal request (one at a time)
    mapping(address => mapping(address => WithdrawalRequest)) public withdrawalRequests;

    // ─── Events ───────────────────────────────────────────────────────────────

    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        address nftContract,
        uint256 tokenId,
        address payToken,
        uint256 reservePrice,
        uint256 endTime
    );

    event AuctionSettled(
        uint256 indexed auctionId,
        address indexed winner,
        uint256 amount
    );

    event AuctionCancelled(uint256 indexed auctionId);

    event WithdrawalRequested(
        address indexed user,
        address indexed token,
        uint256 amount,
        uint256 unlockAt
    );

    event WithdrawalExecuted(
        address indexed user,
        address indexed token,
        uint256 amount
    );

    event WithdrawalDelayUpdated(uint256 newDelay);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address initialOwner)
        Ownable(initialOwner)
        EIP712("TemisBlock", "1")
    {}

    // ─── IERC721Receiver ─────────────────────────────────────────────────────

    /// @dev Required to safely receive NFTs via safeTransferFrom.
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    // ─── Auction Lifecycle ───────────────────────────────────────────────────

    /**
     * @notice Seller creates an auction by transferring their NFT into escrow.
     * @dev Caller must have called nftContract.approve(address(this), tokenId) first.
     * @param nftContract  Address of the ERC721 contract.
     * @param tokenId      Token ID to auction.
     * @param payToken     ERC20 token accepted for bids (e.g. USDC).
     * @param reservePrice Minimum winning bid (in payToken decimals).
     * @param duration     Auction duration in seconds from creation.
     * @return auctionId   The new auction ID.
     */
    function createAuction(
        address nftContract,
        uint256 tokenId,
        address payToken,
        uint256 reservePrice,
        uint256 duration
    ) external nonReentrant returns (uint256 auctionId) {
        require(nftContract != address(0), "TemisBlock: zero nft address");
        require(payToken != address(0),    "TemisBlock: zero token address");
        require(reservePrice > 0,          "TemisBlock: zero reserve price");
        require(duration > 0,              "TemisBlock: zero duration");

        // Transfer NFT into escrow — will revert if caller doesn't own or hasn't approved
        IERC721(nftContract).safeTransferFrom(msg.sender, address(this), tokenId);

        auctionId = nextAuctionId++;

        auctions[auctionId] = Auction({
            seller:       msg.sender,
            nftContract:  nftContract,
            tokenId:      tokenId,
            payToken:     payToken,
            reservePrice: reservePrice,
            endTime:      block.timestamp + duration,
            settled:      false,
            cancelled:    false
        });

        emit AuctionCreated(
            auctionId,
            msg.sender,
            nftContract,
            tokenId,
            payToken,
            reservePrice,
            block.timestamp + duration
        );
    }

    /**
     * @notice Settle an ended auction using the winning off-chain bid signature.
     * @dev The caller (or anyone) submits the EIP-712 signed Bid struct. The contract:
     *      1. Verifies the auction has ended and is not yet settled.
     *      2. Recovers the signer from the EIP-712 signature.
     *      3. Checks the bid meets the reserve and invalidates the nonce.
     *      4. Pulls USDC from the winner, sends to seller's pending balance.
     *      5. Transfers the escrowed NFT to the winner.
     *
     * @param bid  The winning bid struct signed by the bidder.
     * @param sig  65-byte ECDSA signature over the EIP-712 hash.
     */
    function settleAuction(
        Bid calldata bid,
        bytes calldata sig
    ) external nonReentrant {
        Auction storage auction = auctions[bid.auctionId];

        // ── Checks ────────────────────────────────────────────────────────────
        require(!auction.settled,                     "TemisBlock: already settled");
        require(!auction.cancelled,                   "TemisBlock: cancelled");
        require(auction.endTime > 0,                  "TemisBlock: auction not found");
        require(block.timestamp >= auction.endTime,   "TemisBlock: auction not ended");
        require(bid.amount >= auction.reservePrice,   "TemisBlock: below reserve");
        require(bid.nonce == nonces[bid.bidder],      "TemisBlock: invalid nonce");

        // EIP-712 signature verification
        bytes32 structHash = keccak256(abi.encode(
            BID_TYPEHASH,
            bid.auctionId,
            bid.bidder,
            bid.amount,
            bid.nonce
        ));
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), sig);
        require(recovered == bid.bidder, "TemisBlock: invalid signature");

        // ── Effects ───────────────────────────────────────────────────────────
        auction.settled = true;
        nonces[bid.bidder]++;
        pendingBalances[auction.seller][auction.payToken] += bid.amount;

        // ── Interactions ──────────────────────────────────────────────────────
        // Pull payment from winner — bidder must have approved this contract
        IERC20(auction.payToken).safeTransferFrom(bid.bidder, address(this), bid.amount);

        // Transfer escrowed NFT to winner
        IERC721(auction.nftContract).safeTransferFrom(
            address(this),
            bid.bidder,
            auction.tokenId
        );

        emit AuctionSettled(bid.auctionId, bid.bidder, bid.amount);
    }

    // ─── Two-Step Withdrawal ─────────────────────────────────────────────────

    /**
     * @notice Step 1 — register a withdrawal intent. Starts the timelock.
     * @param token   ERC20 token to withdraw (e.g. USDC address).
     * @param amount  Amount to queue for withdrawal.
     */
    function requestWithdrawal(address token, uint256 amount) external {
        require(amount > 0, "TemisBlock: zero amount");
        require(
            pendingBalances[msg.sender][token] >= amount,
            "TemisBlock: insufficient balance"
        );
        // Only one active request per (user, token) at a time
        require(
            withdrawalRequests[msg.sender][token].amount == 0,
            "TemisBlock: request already pending"
        );

        // EFFECTS
        pendingBalances[msg.sender][token] -= amount;
        uint256 unlockAt = block.timestamp + withdrawalDelay;
        withdrawalRequests[msg.sender][token] = WithdrawalRequest({
            amount:   amount,
            unlockAt: unlockAt
        });

        emit WithdrawalRequested(msg.sender, token, amount, unlockAt);
    }

    /**
     * @notice Step 2 — execute a previously requested withdrawal after the delay.
     * @param token  ERC20 token to withdraw.
     */
    function executeWithdrawal(address token) external nonReentrant {
        WithdrawalRequest storage req = withdrawalRequests[msg.sender][token];

        // ── Checks ────────────────────────────────────────────────────────────
        require(req.amount > 0,                       "TemisBlock: no pending request");
        require(block.timestamp >= req.unlockAt,      "TemisBlock: timelock active");

        // ── Effects ───────────────────────────────────────────────────────────
        uint256 amount = req.amount;
        delete withdrawalRequests[msg.sender][token];

        // ── Interactions ──────────────────────────────────────────────────────
        IERC20(token).safeTransfer(msg.sender, amount);

        emit WithdrawalExecuted(msg.sender, token, amount);
    }

    // ─── Emergency ───────────────────────────────────────────────────────────

    /**
     * @notice Owner-only circuit breaker. Returns the escrowed NFT to the seller
     *         and marks the auction as cancelled. No funds are moved.
     * @param auctionId  Auction to cancel.
     */
    function emergencyCancel(uint256 auctionId) external onlyOwner nonReentrant {
        Auction storage auction = auctions[auctionId];

        require(!auction.settled,   "TemisBlock: already settled");
        require(!auction.cancelled, "TemisBlock: already cancelled");
        require(auction.endTime > 0, "TemisBlock: auction not found");

        // EFFECTS
        auction.cancelled = true;

        // INTERACTIONS — return NFT to seller
        IERC721(auction.nftContract).safeTransferFrom(
            address(this),
            auction.seller,
            auction.tokenId
        );

        emit AuctionCancelled(auctionId);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    /**
     * @notice Update the withdrawal timelock duration.
     * @param newDelay  New delay in seconds (must be <= 7 days as sanity cap).
     */
    function setWithdrawalDelay(uint256 newDelay) external onlyOwner {
        require(newDelay <= 7 days, "TemisBlock: delay too long");
        withdrawalDelay = newDelay;
        emit WithdrawalDelayUpdated(newDelay);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice Returns the EIP-712 domain separator (for frontend use).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    /// @notice Returns the current nonce for a bidder (include in signed Bid).
    function bidderNonce(address bidder) external view returns (uint256) {
        return nonces[bidder];
    }
}
