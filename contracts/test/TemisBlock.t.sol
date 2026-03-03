// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TemisBlock.sol";
import "../src/MockNFT.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract TemisBlockTest is Test {
    TemisBlock vault;
    MockNFT nft;
    MockUSDC usdc;

    address owner = makeAddr("owner");
    address seller = makeAddr("seller");
    address feeWallet = makeAddr("feeWallet");

    uint256 bidderKey = 0xBEEF;
    address bidder = vm.addr(bidderKey);

    uint256 constant FEE_BPS = 250; // 2.5 %
    uint256 constant RESERVE = 100e6;
    uint256 constant BID_AMT = 200e6;
    uint256 constant DURATION = 1 days;

    function setUp() public {
        vm.prank(owner);
        vault = new TemisBlock(owner, FEE_BPS, feeWallet, owner);

        nft = new MockNFT();
        usdc = new MockUSDC();

        nft.mint(seller, 1);
        usdc.mint(bidder, 10_000e6);

        vm.startPrank(bidder);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(address(usdc), BID_AMT);
        vm.stopPrank();
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    function _createAuction() internal returns (uint256 auctionId) {
        vm.startPrank(seller);
        nft.approve(address(vault), 1);
        auctionId = vault.createAuction(
            address(nft),
            1,
            address(usdc),
            RESERVE,
            DURATION
        );
        vm.stopPrank();
    }

    function _signBid(
        uint256 auctionId,
        uint256 amount
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Bid(uint256 auctionId,address bidder,uint256 amount,uint256 nonce)"
                ),
                auctionId,
                bidder,
                amount,
                auctionId
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bidderKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _settleBid(uint256 auctionId) internal {
        bytes memory sig = _signBid(auctionId, BID_AMT);
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(owner);
        vault.settleAuction(
            TemisBlock.Bid({
                auctionId: auctionId,
                bidder: bidder,
                amount: BID_AMT,
                nonce: auctionId
            }),
            sig
        );
    }

    // ─── deposit ──────────────────────────────────────────────────────────────

    function test_deposit_creditsBalance() public view {
        assertEq(vault.balances(bidder, address(usdc)), BID_AMT);
    }

    function test_deposit_revertsZero() public {
        vm.prank(bidder);
        vm.expectRevert("TemisBlock: zero amount");
        vault.deposit(address(usdc), 0);
    }

    // ─── createAuction ────────────────────────────────────────────────────────

    function test_createAuction_escrowsNFT() public {
        uint256 auctionId = _createAuction();
        assertEq(nft.ownerOf(1), address(vault));
        (address s, , , , , , , , ) = vault.auctions(auctionId);
        assertEq(s, seller);
    }

    function test_createAuction_snapshotsFee() public {
        uint256 auctionId = _createAuction();
        (, , , , , , uint256 feeBps, , ) = vault.auctions(auctionId);
        assertEq(feeBps, FEE_BPS);

        // Changing fee after creation should NOT affect this auction
        vm.prank(owner);
        vault.setPlatformFee(500, feeWallet); // 5% now

        (, , , , , , uint256 feeAfter, , ) = vault.auctions(auctionId);
        assertEq(feeAfter, FEE_BPS); // still 2.5%
    }

    function test_createAuction_revertsZeroReserve() public {
        nft.mint(seller, 2);
        vm.startPrank(seller);
        nft.approve(address(vault), 2);
        vm.expectRevert("TemisBlock: zero reserve price");
        vault.createAuction(address(nft), 2, address(usdc), 0, DURATION);
        vm.stopPrank();
    }

    function test_createAuction_revertsTooShort() public {
        nft.mint(seller, 2);
        vm.startPrank(seller);
        nft.approve(address(vault), 2);
        vm.expectRevert("TemisBlock: duration too short");
        vault.createAuction(
            address(nft),
            2,
            address(usdc),
            RESERVE,
            10 minutes
        );
        vm.stopPrank();
    }

    function test_createAuction_revertsTooLong() public {
        nft.mint(seller, 2);
        vm.startPrank(seller);
        nft.approve(address(vault), 2);
        vm.expectRevert("TemisBlock: duration too long");
        vault.createAuction(address(nft), 2, address(usdc), RESERVE, 60 days);
        vm.stopPrank();
    }

    function test_createAuction_revertsWhenPaused() public {
        vm.prank(owner);
        vault.pause();
        nft.mint(seller, 2);
        vm.startPrank(seller);
        nft.approve(address(vault), 2);
        vm.expectRevert();
        vault.createAuction(address(nft), 2, address(usdc), RESERVE, DURATION);
        vm.stopPrank();
    }

    // ─── onERC721Received ────────────────────────────────────────────────────

    function test_rejectsUnsolicitedNFT() public {
        nft.mint(address(this), 99);
        vm.expectRevert("TemisBlock: unsolicited transfer");
        nft.safeTransferFrom(address(this), address(vault), 99);
    }

    // ─── settleAuction ────────────────────────────────────────────────────────

    function test_settle_transfersNFTAndFunds() public {
        uint256 auctionId = _createAuction();
        _settleBid(auctionId);

        assertEq(nft.ownerOf(1), bidder);
        assertEq(vault.balances(bidder, address(usdc)), 0);

        uint256 fee = (BID_AMT * FEE_BPS) / 10_000;
        assertEq(vault.balances(seller, address(usdc)), BID_AMT - fee);
        assertEq(vault.balances(feeWallet, address(usdc)), fee);
    }

    function test_settle_usesSnapshotFee() public {
        uint256 auctionId = _createAuction();
        // Change fee to 10% after auction creation
        vm.prank(owner);
        vault.setPlatformFee(1000, feeWallet);

        _settleBid(auctionId);

        // Should use the original 2.5%, not the current 10%
        uint256 fee = (BID_AMT * FEE_BPS) / 10_000; // 2.5%
        assertEq(vault.balances(feeWallet, address(usdc)), fee);
        assertEq(vault.balances(seller, address(usdc)), BID_AMT - fee);
    }

    function test_settle_revertsInsufficientDeposit() public {
        uint256 auctionId = _createAuction();
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Bid(uint256 auctionId,address bidder,uint256 amount,uint256 nonce)"
                ),
                auctionId,
                bidder,
                uint256(300e6),
                auctionId
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bidderKey, digest);

        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(owner);
        vm.expectRevert("TemisBlock: insufficient deposit & queue");
        vault.settleAuction(
            TemisBlock.Bid({
                auctionId: auctionId,
                bidder: bidder,
                amount: 300e6,
                nonce: auctionId
            }),
            abi.encodePacked(r, s, v)
        );
    }

    function test_settle_pullsFromWithdrawalQueue() public {
        uint256 auctionId = _createAuction();
        bytes memory sig = _signBid(auctionId, BID_AMT);
        vm.warp(block.timestamp + DURATION - 1 minutes);

        // Troll attempts to escape by requesting withdrawal 1 min before end
        vm.prank(bidder);
        vault.requestWithdrawal(address(usdc), BID_AMT);
        assertEq(vault.balances(bidder, address(usdc)), 0);

        vm.warp(block.timestamp + 1 minutes + 1); // Auction ends

        uint256 fee = (BID_AMT * FEE_BPS) / 10_000;

        // Relayer catches it and settles
        vm.prank(owner);
        vault.settleAuction(
            TemisBlock.Bid({
                auctionId: auctionId,
                bidder: bidder,
                amount: BID_AMT,
                nonce: auctionId
            }),
            sig
        );

        // NFT delivered, funds transferred from withdrawal queue
        assertEq(nft.ownerOf(1), bidder);
        assertEq(vault.balances(seller, address(usdc)), BID_AMT - fee);

        // Queue should be empty
        (uint256 queued, ) = vault.withdrawalRequests(bidder, address(usdc));
        assertEq(queued, 0);

        // They cannot execute their withdrawal anymore
        vm.prank(bidder);
        vm.expectRevert("TemisBlock: no pending request");
        vault.executeWithdrawal(address(usdc));
    }

    function test_settle_revertsBeforeEnd() public {
        uint256 auctionId = _createAuction();
        bytes memory sig = _signBid(auctionId, BID_AMT);
        vm.prank(owner);
        vm.expectRevert("TemisBlock: auction not ended");
        vault.settleAuction(
            TemisBlock.Bid({
                auctionId: auctionId,
                bidder: bidder,
                amount: BID_AMT,
                nonce: auctionId
            }),
            sig
        );
    }

    function test_settle_revertsAfterGracePeriod() public {
        uint256 auctionId = _createAuction();
        bytes memory sig = _signBid(auctionId, BID_AMT);

        vm.warp(block.timestamp + DURATION + 24 hours + 1); // just after grace period

        vm.prank(owner);
        vm.expectRevert("TemisBlock: grace period over");
        vault.settleAuction(
            TemisBlock.Bid({
                auctionId: auctionId,
                bidder: bidder,
                amount: BID_AMT,
                nonce: auctionId
            }),
            sig
        );
    }

    function test_settle_revertsInvalidSignature() public {
        uint256 auctionId = _createAuction();
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Bid(uint256 auctionId,address bidder,uint256 amount,uint256 nonce)"
                ),
                auctionId,
                bidder,
                BID_AMT,
                auctionId
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xDEAD, digest);

        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(owner);
        vm.expectRevert("TemisBlock: invalid signature");
        vault.settleAuction(
            TemisBlock.Bid({
                auctionId: auctionId,
                bidder: bidder,
                amount: BID_AMT,
                nonce: auctionId
            }),
            abi.encodePacked(r, s, v)
        );
    }

    function test_settle_revertsReplay() public {
        uint256 auctionId = _createAuction();
        bytes memory sig = _signBid(auctionId, BID_AMT);
        vm.warp(block.timestamp + DURATION + 1);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId,
            bidder: bidder,
            amount: BID_AMT,
            nonce: auctionId
        });
        vm.prank(owner);
        vault.settleAuction(bid, sig);

        vm.prank(owner);
        vm.expectRevert("TemisBlock: already settled");
        vault.settleAuction(bid, sig);
    }

    function test_settle_revertsWrongNonce() public {
        uint256 auctionId = _createAuction();
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Bid(uint256 auctionId,address bidder,uint256 amount,uint256 nonce)"
                ),
                auctionId,
                bidder,
                BID_AMT,
                uint256(999)
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bidderKey, digest);

        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(owner);
        vm.expectRevert("TemisBlock: invalid nonce");
        vault.settleAuction(
            TemisBlock.Bid({
                auctionId: auctionId,
                bidder: bidder,
                amount: BID_AMT,
                nonce: 999
            }),
            abi.encodePacked(r, s, v)
        );
    }

    function test_settle_revertsUnauthorizedSettler() public {
        uint256 auctionId = _createAuction();
        bytes memory sig = _signBid(auctionId, BID_AMT);
        vm.warp(block.timestamp + DURATION + 1);

        vm.prank(bidder);
        vm.expectRevert("TemisBlock: unauthorized settler");
        vault.settleAuction(
            TemisBlock.Bid({
                auctionId: auctionId,
                bidder: bidder,
                amount: BID_AMT,
                nonce: auctionId
            }),
            sig
        );
    }

    // ─── cancelAuction ───────────────────────────────────────────────────────

    function test_cancelAuction_relayerReturnsNFT() public {
        uint256 auctionId = _createAuction();
        vm.prank(owner);
        vault.cancelAuction(auctionId);
        assertEq(nft.ownerOf(1), seller);
    }

    function test_cancelAuction_revertsUnauthorized() public {
        uint256 auctionId = _createAuction();
        vm.prank(seller);
        vm.expectRevert("TemisBlock: unauthorized");
        vault.cancelAuction(auctionId);
    }

    function test_cancelAuction_revertsAfterEnd() public {
        uint256 auctionId = _createAuction();
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(owner);
        vm.expectRevert("TemisBlock: auction ended");
        vault.cancelAuction(auctionId);
    }

    // ─── claimUnsold ─────────────────────────────────────────────────────────

    function test_claimUnsold_returnsNFT() public {
        uint256 auctionId = _createAuction();
        vm.warp(block.timestamp + DURATION + 24 hours + 1);
        vm.prank(seller);
        vault.claimUnsold(auctionId);
        assertEq(nft.ownerOf(1), seller);
    }

    function test_claimUnsold_revertsInGracePeriod() public {
        uint256 auctionId = _createAuction();
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(seller);
        vm.expectRevert("TemisBlock: grace period active");
        vault.claimUnsold(auctionId);
    }

    function test_claimUnsold_revertsNotSeller() public {
        uint256 auctionId = _createAuction();
        vm.warp(block.timestamp + DURATION + 24 hours + 1);
        vm.prank(bidder);
        vm.expectRevert("TemisBlock: not seller");
        vault.claimUnsold(auctionId);
    }

    // ─── Withdrawal + cancelWithdrawal ───────────────────────────────────────

    function test_withdrawal_happyPath() public {
        vm.prank(bidder);
        vault.requestWithdrawal(address(usdc), BID_AMT);

        vm.prank(bidder);
        vm.expectRevert("TemisBlock: timelock active");
        vault.executeWithdrawal(address(usdc));

        vm.warp(block.timestamp + 5 minutes + 1);
        uint256 walletBefore = usdc.balanceOf(bidder);
        vm.prank(bidder);
        vault.executeWithdrawal(address(usdc));
        assertEq(usdc.balanceOf(bidder), walletBefore + BID_AMT);
    }

    function test_cancelWithdrawal_returnsFundsToBalance() public {
        vm.prank(bidder);
        vault.requestWithdrawal(address(usdc), BID_AMT);

        // Balance should be 0 after requesting withdrawal
        assertEq(vault.balances(bidder, address(usdc)), 0);

        vm.prank(bidder);
        vault.cancelWithdrawal(address(usdc));

        // Balance restored
        assertEq(vault.balances(bidder, address(usdc)), BID_AMT);

        // No pending request anymore
        (uint256 pending, ) = vault.withdrawalRequests(bidder, address(usdc));
        assertEq(pending, 0);
    }

    function test_cancelWithdrawal_revertsNoPending() public {
        vm.prank(bidder);
        vm.expectRevert("TemisBlock: no pending request");
        vault.cancelWithdrawal(address(usdc));
    }

    function test_withdrawal_sellerProceeds() public {
        uint256 auctionId = _createAuction();
        _settleBid(auctionId);

        uint256 sellerShare = BID_AMT - ((BID_AMT * FEE_BPS) / 10_000);
        vm.prank(seller);
        vault.requestWithdrawal(address(usdc), sellerShare);

        vm.warp(block.timestamp + 5 minutes + 1);
        uint256 walletBefore = usdc.balanceOf(seller);
        vm.prank(seller);
        vault.executeWithdrawal(address(usdc));
        assertEq(usdc.balanceOf(seller), walletBefore + sellerShare);
    }

    function test_withdrawal_revertsNoPendingRequest() public {
        vm.prank(seller);
        vm.expectRevert("TemisBlock: no pending request");
        vault.executeWithdrawal(address(usdc));
    }

    // ─── emergencyCancel ─────────────────────────────────────────────────────

    function test_emergencyCancel_returnsNFT() public {
        uint256 auctionId = _createAuction();
        vm.prank(owner);
        vault.emergencyCancel(auctionId);
        assertEq(nft.ownerOf(1), seller);
    }

    function test_emergencyCancel_onlyOwner() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        vm.expectRevert();
        vault.emergencyCancel(auctionId);
    }

    // ─── renounceOwnership blocked ───────────────────────────────────────────

    function test_renounceOwnership_reverts() public {
        vm.prank(owner);
        vm.expectRevert("TemisBlock: cannot renounce ownership");
        vault.renounceOwnership();
    }

    // ─── Platform fee distribution ───────────────────────────────────────────

    function test_settleDistributesFee() public {
        uint256 auctionId = _createAuction();
        _settleBid(auctionId);

        uint256 fee = (BID_AMT * FEE_BPS) / 10_000;
        assertEq(vault.balances(feeWallet, address(usdc)), fee);
        assertEq(vault.balances(seller, address(usdc)), BID_AMT - fee);
    }
}
