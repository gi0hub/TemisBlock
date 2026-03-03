// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title TemisBlock
 * @notice Deposit-based NFT auction contract.
 *
 *  Flow:
 *    1. Bidders deposit(token, amount) — funds enter the contract.
 *    2. Bids signed off-chain (EIP-712) at zero gas.
 *    3. Platform relayer calls settleAuction with winning signature.
 *       Settlement is a pure internal balance transfer + NFT delivery.
 *    4. Participants withdraw via requestWithdrawal → executeWithdrawal (5 min delay).
 *
 *  Security:
 *   - Deposit model makes troll-bidding impossible (funds locked inside contract;
 *     withdrawal takes 5 min, relayer settles within seconds of endTime).
 *   - cancelAuction restricted to relayer/owner (sellers cannot rug-pull).
 *   - Fee snapshot at auction creation (owner cannot change fee after the fact).
 *   - Ownable2Step: ownership transfers require explicit acceptance.
 *   - renounceOwnership disabled: admin functions cannot be bricked.
 *   - cancelWithdrawal: users can reclaim funds from a pending withdrawal request.
 *   - ReentrancyGuard + Pausable + CEI throughout.
 */
contract TemisBlock is
    IERC721Receiver,
    ReentrancyGuard,
    Ownable2Step,
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
    uint256 public constant SETTLE_GRACE_PERIOD = 24 hours;

    // ─── Types ────────────────────────────────────────────────────────────────

    struct Auction {
        address seller;
        address nftContract;
        uint256 tokenId;
        address payToken;
        uint256 reservePrice;
        uint256 endTime;
        uint256 feeBps; // snapshot of platformFeeBps at creation time
        bool settled;
        bool cancelled;
    }

    struct WithdrawalRequest {
        uint256 amount;
        uint256 unlockAt;
    }

    struct Bid {
        uint256 auctionId;
        address bidder;
        uint256 amount;
        uint256 nonce; // must equal auctionId on-chain
    }

    // ─── Storage ──────────────────────────────────────────────────────────────

    uint256 public nextAuctionId;
    uint256 public withdrawalDelay = 5 minutes;
    uint256 public platformFeeBps;
    address public feeRecipient;
    address public settlementRelayer;

    bool private _acceptingNFT;

    mapping(uint256 => Auction) public auctions;
    mapping(address => mapping(address => uint256)) public balances;
    mapping(address => mapping(address => WithdrawalRequest))
        public withdrawalRequests;

    // ─── Events ───────────────────────────────────────────────────────────────

    event Deposited(
        address indexed user,
        address indexed token,
        uint256 amount
    );
    event AuctionCreated(
        uint256 indexed auctionId,
        address indexed seller,
        address nftContract,
        uint256 tokenId,
        address payToken,
        uint256 reservePrice,
        uint256 endTime,
        uint256 feeBps
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
    event WithdrawalCancelled(
        address indexed user,
        address indexed token,
        uint256 amount
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

    // ─── Ownership Safety ────────────────────────────────────────────────────

    /// @dev Ownership cannot be renounced — this would permanently brick
    ///      pause/unpause, emergencyCancel, fee changes, and relayer rotation.
    function renounceOwnership() public pure override {
        revert("TemisBlock: cannot renounce ownership");
    }

    // ─── IERC721Receiver ─────────────────────────────────────────────────────

    function onERC721Received(
        address,
        address,
        uint256,
        bytes calldata
    ) external view override returns (bytes4) {
        require(_acceptingNFT, "TemisBlock: unsolicited transfer");
        return IERC721Receiver.onERC721Received.selector;
    }

    // ─── Deposits ────────────────────────────────────────────────────────────

    function deposit(address token, uint256 amount) external nonReentrant {
        require(token != address(0), "TemisBlock: zero token");
        require(amount > 0, "TemisBlock: zero amount");

        // Note: the state update (balances +=) must follow the external call because
        // `received` is computed from the actual post-transfer balance delta. This
        // handles fee-on-transfer tokens correctly.
        // CEI is enforced here by nonReentrant — any reentrant call to this contract
        // from within safeTransferFrom will revert.
        uint256 before = IERC20(token).balanceOf(address(this));
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        uint256 received = IERC20(token).balanceOf(address(this)) - before;

        balances[msg.sender][token] += received;
        emit Deposited(msg.sender, token, received);
    }

    // ─── Auction Lifecycle ───────────────────────────────────────────────────

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
            feeBps: platformFeeBps, // snapshot — cannot change after this point
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
            endTime,
            platformFeeBps
        );
    }

    /**
     * @notice Settle with the winning off-chain bid.
     * @dev Only relayer or owner. Internal balance transfer + NFT delivery.
     *      Uses auction.feeBps (snapshot at creation), not the current platformFeeBps.
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

        require(!auction.settled, "TemisBlock: already settled");
        require(!auction.cancelled, "TemisBlock: cancelled");
        require(auction.endTime > 0, "TemisBlock: auction not found");
        require(
            block.timestamp >= auction.endTime,
            "TemisBlock: auction not ended"
        );
        require(
            block.timestamp <= auction.endTime + SETTLE_GRACE_PERIOD,
            "TemisBlock: grace period over"
        );
        require(
            bid.amount >= auction.reservePrice,
            "TemisBlock: below reserve"
        );
        require(bid.nonce == bid.auctionId, "TemisBlock: invalid nonce");

        // We do *not* require balances >= bid.amount here anymore because
        // we might pull from their withdrawal queue.
        // The check is performed at the effect stage below.

        bytes32 structHash = keccak256(
            abi.encode(
                BID_TYPEHASH,
                bid.auctionId,
                bid.bidder,
                bid.amount,
                bid.nonce
            )
        );
        require(
            ECDSA.recover(_hashTypedDataV4(structHash), sig) == bid.bidder,
            "TemisBlock: invalid signature"
        );

        // ── Effects — use auction.feeBps (snapshot), NOT platformFeeBps ──────
        auction.settled = true;

        uint256 fee = (bid.amount * auction.feeBps) / 10_000;
        uint256 sellerAmount = bid.amount - fee;

        uint256 available = balances[bid.bidder][auction.payToken];
        if (available >= bid.amount) {
            balances[bid.bidder][auction.payToken] -= bid.amount;
        } else {
            // The bidder tried to escape their signed commitment by queueing a
            // withdrawal right before the auction ended. Pull the shortfall from
            // their pending withdrawal request so the settlement cannot be blocked.
            uint256 shortfall = bid.amount - available;
            WithdrawalRequest storage req = withdrawalRequests[bid.bidder][
                auction.payToken
            ];

            require(
                req.amount >= shortfall,
                "TemisBlock: insufficient deposit & queue"
            );

            balances[bid.bidder][auction.payToken] -= available; // becomes 0
            req.amount -= shortfall; // pull the rest from their withdrawal queue

            if (req.amount == 0) {
                delete withdrawalRequests[bid.bidder][auction.payToken];
            }
        }

        balances[auction.seller][auction.payToken] += sellerAmount;
        balances[feeRecipient][auction.payToken] += fee;

        // ── Interactions ──────────────────────────────────────────────────────
        // Use transferFrom instead of safeTransferFrom to prevent a malicious
        // contract bidder from blocking the settlement by reverting in onERC721Received.
        IERC721(auction.nftContract).transferFrom(
            address(this),
            bid.bidder,
            auction.tokenId
        );

        emit AuctionSettled(bid.auctionId, bid.bidder, bid.amount);
    }

    /**
     * @notice Cancel an auction before endTime (relayer/owner only).
     *         The relayer only calls this when the API confirms zero active bids.
     */
    function cancelAuction(uint256 auctionId) external nonReentrant {
        require(
            msg.sender == settlementRelayer || msg.sender == owner(),
            "TemisBlock: unauthorized"
        );
        Auction storage auction = auctions[auctionId];

        require(!auction.settled, "TemisBlock: already settled");
        require(!auction.cancelled, "TemisBlock: already cancelled");
        require(auction.endTime > 0, "TemisBlock: auction not found");
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
     * @notice Seller reclaims NFT after endTime + SETTLE_GRACE_PERIOD with no settlement.
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

        auction.cancelled = true;

        IERC721(auction.nftContract).safeTransferFrom(
            address(this),
            auction.seller,
            auction.tokenId
        );
        emit AuctionCancelled(auctionId);
    }

    // ─── Two-Step Withdrawal ─────────────────────────────────────────────────

    /**
     * @notice Queue a withdrawal. Starts the timelock (default 5 min).
     *         One active request per (user, token) at a time.
     */
    function requestWithdrawal(
        address token,
        uint256 amount
    ) external nonReentrant {
        require(amount > 0, "TemisBlock: zero amount");
        require(
            balances[msg.sender][token] >= amount,
            "TemisBlock: insufficient balance"
        );
        require(
            withdrawalRequests[msg.sender][token].amount == 0,
            "TemisBlock: request already pending"
        );

        balances[msg.sender][token] -= amount;
        uint256 unlockAt = block.timestamp + withdrawalDelay;

        withdrawalRequests[msg.sender][token] = WithdrawalRequest({
            amount: amount,
            unlockAt: unlockAt
        });
        emit WithdrawalRequested(msg.sender, token, amount, unlockAt);
    }

    /**
     * @notice Cancel a pending withdrawal request and return the funds to balances.
     *         The user can then bid with those funds or create a new withdrawal request.
     */
    function cancelWithdrawal(address token) external nonReentrant {
        WithdrawalRequest storage req = withdrawalRequests[msg.sender][token];
        require(req.amount > 0, "TemisBlock: no pending request");

        uint256 amount = req.amount;
        delete withdrawalRequests[msg.sender][token];

        balances[msg.sender][token] += amount;
        emit WithdrawalCancelled(msg.sender, token, amount);
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

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
