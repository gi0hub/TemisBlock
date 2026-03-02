// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title TemisBlock
 * @notice Platform-level NFT auction contract. Sellers escrow ERC721 tokens;
 *         bids are signed off-chain (EIP-712) and the winning bid is submitted
 *         on-chain to settle. Withdrawals use a two-step pattern.
 *
 * Security properties:
 *  - ReentrancyGuard on all state-mutating externals
 *  - Pausable for emergency circuit-breaking
 *  - Checks-Effects-Interactions throughout
 *  - SafeERC20 + balance-delta accounting (handles fee-on-transfer tokens)
 *  - EIP-712 typed-data signature verification
 *  - Nonce == auctionId — scopes signatures to a specific auction, not globally
 *  - Two-step withdrawal with configurable delay
 *  - Seller-initiated cancel before endTime
 *  - emergencyCancel owner-only for post-deadline situations
 */
contract TemisBlock is
    IERC721Receiver,
    ReentrancyGuard,
    Ownable,
    Pausable,
    EIP712
{
    using SafeERC20 for IERC20;

    // ─── Constants ────────────────────────────────────────────────────────────

    bytes32 private constant BID_TYPEHASH =
        keccak256(
            "Bid(uint256 auctionId,address bidder,uint256 amount,uint256 nonce)"
        );

    uint256 public constant MIN_DURATION = 1 hours;
    uint256 public constant MAX_DURATION = 30 days;
    uint256 public constant MAX_FEE_BPS = 1000; // 10 %
    // Window after endTime during which only settleAuction can run.
    // Prevents claimUnsold from racing the platform relayer.
    uint256 public constant SETTLE_GRACE_PERIOD = 24 hours;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Auction {
        address seller;
        address nftContract;
        uint256 tokenId;
        address payToken;
        uint256 reservePrice;
        uint256 endTime;
        bool settled;
        bool cancelled;
    }

    struct WithdrawalRequest {
        uint256 amount;
        uint256 unlockAt;
    }

    // EIP-712 struct — nonce MUST equal auctionId when submitted on-chain.
    // This binds signatures to a specific auction without a global counter.
    struct Bid {
        uint256 auctionId;
        address bidder;
        uint256 amount;
        uint256 nonce;
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    uint256 public nextAuctionId;
    uint256 public withdrawalDelay = 1 hours;
    uint256 public platformFeeBps;
    address public feeRecipient;
    // Only this address (or owner) can call settleAuction.
    // Prevents losing bidders from self-settling with their own signed bid
    // to win at below-market price, cheating the real winner and the seller.
    address public settlementRelayer;

    // Transient guard: set true only during the safeTransferFrom in createAuction.
    // Prevents arbitrary NFT deposits from external callers.
    bool private _acceptingNFT;

    mapping(uint256 => Auction) public auctions;

    // user → token → claimable balance (seller proceeds + platform fees)
    mapping(address => mapping(address => uint256)) public pendingBalances;

    // user → token → queued withdrawal
    mapping(address => mapping(address => WithdrawalRequest))
        public withdrawalRequests;

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
    event PlatformFeeUpdated(uint256 feeBps, address recipient);
    event SettlementRelayerUpdated(address relayer);

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(
        address initialOwner,
        uint256 feeBps,
        address recipient,
        address relayer
    ) Ownable(initialOwner) EIP712("TemisBlock", "1") {
        require(feeBps <= MAX_FEE_BPS, "TemisBlock: fee too high");
        require(recipient != address(0), "TemisBlock: zero fee recipient");
        require(relayer != address(0), "TemisBlock: zero relayer");
        platformFeeBps = feeBps;
        feeRecipient = recipient;
        settlementRelayer = relayer;
    }

    // ─── IERC721Receiver ─────────────────────────────────────────────────────

    /// @dev Only returns the acceptance selector when called during createAuction.
    ///      Unsolicited NFT transfers are rejected to prevent tokens from being
    ///      silently trapped with no matching auction record.
    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external view override returns (bytes4) {
        require(_acceptingNFT, "TemisBlock: unsolicited transfer");
        return IERC721Receiver.onERC721Received.selector;
    }

    // ─── Auction Lifecycle ───────────────────────────────────────────────────

    /**
     * @notice Escrow an NFT and open a timed auction.
     * @dev Caller must approve this contract on nftContract before calling.
     *      Duration is bounded to [1 hour, 30 days] to avoid unusable auctions.
     */
    function createAuction(
        address nftContract,
        uint256 tokenId,
        address payToken,
        uint256 reservePrice,
        uint256 duration
    ) external nonReentrant whenNotPaused returns (uint256 auctionId) {
        require(nftContract != address(0), "TemisBlock: zero nft address");
        require(payToken != address(0), "TemisBlock: zero token address");
        require(reservePrice > 0, "TemisBlock: zero reserve price");
        require(duration >= MIN_DURATION, "TemisBlock: duration too short");
        require(duration <= MAX_DURATION, "TemisBlock: duration too long");

        // Accept only this safeTransferFrom, reject any others via onERC721Received
        _acceptingNFT = true;
        IERC721(nftContract).safeTransferFrom(
            msg.sender,
            address(this),
            tokenId
        );
        _acceptingNFT = false;

        auctionId = nextAuctionId++;
        uint256 endTime = block.timestamp + duration;

        auctions[auctionId] = Auction({
            seller: msg.sender,
            nftContract: nftContract,
            tokenId: tokenId,
            payToken: payToken,
            reservePrice: reservePrice,
            endTime: endTime,
            settled: false,
            cancelled: false
        });

        emit AuctionCreated(
            auctionId,
            msg.sender,
            nftContract,
            tokenId,
            payToken,
            reservePrice,
            endTime
        );
    }

    /**
     * @notice Settle an ended auction with the winning EIP-712 signed bid.
     * @dev Only callable by settlementRelayer or the contract owner.
     *      This restriction prevents losing bidders from self-settling with their
     *      own valid signed bids at below-market prices, which would cheat both
     *      the real winner (who expected to win) and the seller (who expected the
     *      higher clearing price).
     *
     *      The relayer is the platform API that observed all off-chain bids and
     *      knows the true highest bid. The owner is the emergency fallback.
     *
     *      nonce must equal auctionId. Balance-delta accounting used for
     *      fee-on-transfer token support.
     */
    function settleAuction(
        Bid calldata bid,
        bytes calldata sig
    ) external nonReentrant whenNotPaused {
        require(
            msg.sender == settlementRelayer || msg.sender == owner(),
            "TemisBlock: unauthorized settler"
        );
        Auction storage auction = auctions[bid.auctionId];

        // ── Checks ────────────────────────────────────────────────────────────
        require(!auction.settled, "TemisBlock: already settled");
        require(!auction.cancelled, "TemisBlock: cancelled");
        require(auction.endTime > 0, "TemisBlock: auction not found");
        require(
            block.timestamp >= auction.endTime,
            "TemisBlock: auction not ended"
        );
        require(
            bid.amount >= auction.reservePrice,
            "TemisBlock: below reserve"
        );
        require(bid.nonce == bid.auctionId, "TemisBlock: invalid nonce");

        bytes32 structHash = keccak256(
            abi.encode(
                BID_TYPEHASH,
                bid.auctionId,
                bid.bidder,
                bid.amount,
                bid.nonce
            )
        );
        address recovered = ECDSA.recover(_hashTypedDataV4(structHash), sig);
        require(recovered == bid.bidder, "TemisBlock: invalid signature");

        // ── Effects ───────────────────────────────────────────────────────────
        auction.settled = true;

        // Optimistic credit — adjusted below if the token charged a transfer fee
        uint256 fee = (bid.amount * platformFeeBps) / 10_000;
        uint256 sellerAmount = bid.amount - fee;
        pendingBalances[auction.seller][auction.payToken] += sellerAmount;
        pendingBalances[feeRecipient][auction.payToken] += fee;

        // ── Interactions ──────────────────────────────────────────────────────
        // Balance-delta: handles fee-on-transfer tokens where received < amount.
        uint256 before = IERC20(auction.payToken).balanceOf(address(this));
        IERC20(auction.payToken).safeTransferFrom(
            bid.bidder,
            address(this),
            bid.amount
        );
        uint256 received = IERC20(auction.payToken).balanceOf(address(this)) -
            before;

        if (received < bid.amount) {
            // Proportionally reduce both shares by the shortfall
            uint256 shortfall = bid.amount - received;
            uint256 feeAdj = (shortfall * platformFeeBps) / 10_000;
            pendingBalances[auction.seller][auction.payToken] -= (shortfall -
                feeAdj);
            pendingBalances[feeRecipient][auction.payToken] -= feeAdj;
        }

        IERC721(auction.nftContract).safeTransferFrom(
            address(this),
            bid.bidder,
            auction.tokenId
        );

        emit AuctionSettled(bid.auctionId, bid.bidder, bid.amount);
    }

    /**
     * @notice Seller cancels their own auction before it ends.
     *         NFT returns to the seller immediately.
     *         Only valid while the auction is still live.
     */
    function cancelAuction(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];

        require(msg.sender == auction.seller, "TemisBlock: not seller");
        require(!auction.settled, "TemisBlock: already settled");
        require(!auction.cancelled, "TemisBlock: already cancelled");
        require(block.timestamp < auction.endTime, "TemisBlock: auction ended");

        auction.cancelled = true;

        IERC721(auction.nftContract).safeTransferFrom(
            address(this),
            auction.seller,
            auction.tokenId
        );

        emit AuctionCancelled(auctionId);
    }

    /**
     * @notice Seller reclaims their NFT if the auction ended without a winner.
     *         Callable only after endTime + SETTLE_GRACE_PERIOD (24 h).
     *         The grace period prevents the seller from racing the platform relayer's
     *         settleAuction call — if a valid winning bid exists, the relayer has 24 h
     *         to settle before the seller can reclaim.
     */
    function claimUnsold(uint256 auctionId) external nonReentrant {
        Auction storage auction = auctions[auctionId];

        require(msg.sender == auction.seller, "TemisBlock: not seller");
        require(!auction.settled, "TemisBlock: already settled");
        require(!auction.cancelled, "TemisBlock: already cancelled");
        require(
            block.timestamp >= auction.endTime + SETTLE_GRACE_PERIOD,
            "TemisBlock: grace period active"
        );

        auction.cancelled = true; // Mark as cancelled to prevent later settlement

        IERC721(auction.nftContract).safeTransferFrom(
            address(this),
            auction.seller,
            auction.tokenId
        );

        emit AuctionCancelled(auctionId);
    }

    // ─── Two-Step Withdrawal ─────────────────────────────────────────────────

    /**
     * @notice Queue a withdrawal. Starts the timelock.
     *         Only one active request per (user, token) at a time.
     */
    function requestWithdrawal(
        address token,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "TemisBlock: zero amount");
        require(
            pendingBalances[msg.sender][token] >= amount,
            "TemisBlock: insufficient balance"
        );
        require(
            withdrawalRequests[msg.sender][token].amount == 0,
            "TemisBlock: request already pending"
        );

        pendingBalances[msg.sender][token] -= amount;
        uint256 unlockAt = block.timestamp + withdrawalDelay;

        withdrawalRequests[msg.sender][token] = WithdrawalRequest({
            amount: amount,
            unlockAt: unlockAt
        });

        emit WithdrawalRequested(msg.sender, token, amount, unlockAt);
    }

    /**
     * @notice Execute a queued withdrawal after the timelock expires.
     */
    function executeWithdrawal(address token) external nonReentrant {
        WithdrawalRequest storage req = withdrawalRequests[msg.sender][token];

        require(req.amount > 0, "TemisBlock: no pending request");
        require(block.timestamp >= req.unlockAt, "TemisBlock: timelock active");

        uint256 amount = req.amount;
        delete withdrawalRequests[msg.sender][token];

        IERC20(token).safeTransfer(msg.sender, amount);

        emit WithdrawalExecuted(msg.sender, token, amount);
    }

    // ─── Emergency ───────────────────────────────────────────────────────────

    /**
     * @notice Owner-only: cancel any auction regardless of timing.
     *         Use when a seller cannot or should not run cancelAuction themselves.
     */
    function emergencyCancel(
        uint256 auctionId
    ) external onlyOwner nonReentrant {
        Auction storage auction = auctions[auctionId];

        require(!auction.settled, "TemisBlock: already settled");
        require(!auction.cancelled, "TemisBlock: already cancelled");
        require(auction.endTime > 0, "TemisBlock: auction not found");

        auction.cancelled = true;

        IERC721(auction.nftContract).safeTransferFrom(
            address(this),
            auction.seller,
            auction.tokenId
        );

        emit AuctionCancelled(auctionId);
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setWithdrawalDelay(uint256 newDelay) external onlyOwner {
        require(newDelay <= 7 days, "TemisBlock: delay too long");
        withdrawalDelay = newDelay;
        emit WithdrawalDelayUpdated(newDelay);
    }

    function setPlatformFee(
        uint256 feeBps,
        address recipient
    ) external onlyOwner {
        require(feeBps <= MAX_FEE_BPS, "TemisBlock: fee too high");
        require(recipient != address(0), "TemisBlock: zero fee recipient");
        platformFeeBps = feeBps;
        feeRecipient = recipient;
        emit PlatformFeeUpdated(feeBps, recipient);
    }

    function setSettlementRelayer(address relayer) external onlyOwner {
        require(relayer != address(0), "TemisBlock: zero relayer");
        settlementRelayer = relayer;
        emit SettlementRelayerUpdated(relayer);
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    /// @notice EIP-712 domain separator — expose for frontend signing.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
