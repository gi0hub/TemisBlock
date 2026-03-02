// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/TemisBlock.sol";
import "../src/MockNFT.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Bare-minimum ERC20 with unrestricted mint, used by TemisBlockTest.
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
    uint256 constant RESERVE = 100e6; // 100 USDC
    uint256 constant BID_AMT = 200e6; // 200 USDC
    uint256 constant DURATION = 1 days;

    function setUp() public {
        vm.prank(owner);
        // owner is also the relayer in tests for simplicity
        vault = new TemisBlock(owner, FEE_BPS, feeWallet, owner);

        nft = new MockNFT();
        usdc = new MockUSDC();

        nft.mint(seller, 1);
        usdc.mint(bidder, 10_000e6);
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
        // nonce == auctionId in the new design
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Bid(uint256 auctionId,address bidder,uint256 amount,uint256 nonce)"
                ),
                auctionId,
                bidder,
                amount,
                auctionId // nonce = auctionId
            )
        );
        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", vault.domainSeparator(), structHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(bidderKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ─── createAuction ────────────────────────────────────────────────────────

    function test_createAuction_escrowsNFT() public {
        uint256 auctionId = _createAuction();
        assertEq(nft.ownerOf(1), address(vault));
        (address s, , , , , , , ) = vault.auctions(auctionId);
        assertEq(s, seller);
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

    // ─── onERC721Received guard ──────────────────────────────────────────────

    function test_rejectsUnsolicitedNFT() public {
        nft.mint(address(this), 99);
        vm.expectRevert("TemisBlock: unsolicited transfer");
        nft.safeTransferFrom(address(this), address(vault), 99);
    }

    // ─── settleAuction ────────────────────────────────────────────────────────

    function test_settle_transfersNFTAndFunds() public {
        uint256 auctionId = _createAuction();

        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);

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

        assertEq(nft.ownerOf(1), bidder);

        // Platform fee = 2.5% of 200e6 = 5e6
        uint256 expectedFee = (BID_AMT * FEE_BPS) / 10_000;
        uint256 expectedSeller = BID_AMT - expectedFee;

        assertEq(vault.pendingBalances(seller, address(usdc)), expectedSeller);
        assertEq(vault.pendingBalances(feeWallet, address(usdc)), expectedFee);
    }

    function test_settle_revertsBeforeEnd() public {
        uint256 auctionId = _createAuction();
        bytes memory sig = _signBid(auctionId, BID_AMT);

        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId,
            bidder: bidder,
            amount: BID_AMT,
            nonce: auctionId
        });
        vm.expectRevert("TemisBlock: auction not ended");
        vm.prank(owner);
        vault.settleAuction(bid, sig);
    }

    function test_settle_revertsInvalidSignature() public {
        uint256 auctionId = _createAuction();

        uint256 wrongKey = 0xDEAD;
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
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(wrongKey, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId,
            bidder: bidder,
            amount: BID_AMT,
            nonce: auctionId
        });
        vm.expectRevert("TemisBlock: invalid signature");
        vm.prank(owner);
        vault.settleAuction(bid, badSig);
    }

    function test_settle_revertsReplay() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT * 2);

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

        vm.expectRevert("TemisBlock: already settled");
        vm.prank(owner);
        vault.settleAuction(bid, sig);
    }

    function test_settle_revertsWrongNonce() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);

        // Sign with nonce=999 instead of auctionId
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
        bytes memory badSig = abi.encodePacked(r, s, v);

        vm.warp(block.timestamp + DURATION + 1);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId,
            bidder: bidder,
            amount: BID_AMT,
            nonce: 999
        });
        vm.expectRevert("TemisBlock: invalid nonce");
        vm.prank(owner);
        vault.settleAuction(bid, badSig);
    }

    function test_settle_revertsUnauthorizedSettler() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);
        bytes memory sig = _signBid(auctionId, BID_AMT);
        vm.warp(block.timestamp + DURATION + 1);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId,
            bidder: bidder,
            amount: BID_AMT,
            nonce: auctionId
        });
        // bidder tries to self-settle
        vm.prank(bidder);
        vm.expectRevert("TemisBlock: unauthorized settler");
        vault.settleAuction(bid, sig);
    }

    // ─── cancelAuction (seller) ──────────────────────────────────────────────

    function test_cancelAuction_sellerGetsNFTBack() public {
        uint256 auctionId = _createAuction();
        assertEq(nft.ownerOf(1), address(vault));

        vm.prank(seller);
        vault.cancelAuction(auctionId);

        assertEq(nft.ownerOf(1), seller);
    }

    function test_cancelAuction_revertsNotSeller() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        vm.expectRevert("TemisBlock: not seller");
        vault.cancelAuction(auctionId);
    }

    function test_cancelAuction_revertsAfterEnd() public {
        uint256 auctionId = _createAuction();
        vm.warp(block.timestamp + DURATION + 1);
        vm.prank(seller);
        vm.expectRevert("TemisBlock: auction ended");
        vault.cancelAuction(auctionId);
    }

    // ─── claimUnsold (seller) ────────────────────────────────────────────────

    function test_claimUnsold_returnsNFT() public {
        uint256 auctionId = _createAuction();
        // Must wait for endTime + SETTLE_GRACE_PERIOD (24 h)
        vm.warp(block.timestamp + DURATION + 24 hours + 1);

        vm.prank(seller);
        vault.claimUnsold(auctionId);

        assertEq(nft.ownerOf(1), seller);
        (, , , , , , , bool cancelled) = vault.auctions(auctionId);
        assertTrue(cancelled);
    }

    function test_claimUnsold_revertsInGracePeriod() public {
        uint256 auctionId = _createAuction();
        // After endTime but still inside 24h grace window
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

    // ─── Two-Step Withdrawal ─────────────────────────────────────────────────

    function test_withdrawal_happyPath() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);
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

        uint256 sellerShare = BID_AMT - ((BID_AMT * FEE_BPS) / 10_000);

        vm.prank(seller);
        vault.requestWithdrawal(address(usdc), sellerShare);

        vm.expectRevert("TemisBlock: timelock active");
        vm.prank(seller);
        vault.executeWithdrawal(address(usdc));

        vm.warp(block.timestamp + 1 hours + 1);
        uint256 before = usdc.balanceOf(seller);
        vm.prank(seller);
        vault.executeWithdrawal(address(usdc));
        assertEq(usdc.balanceOf(seller), before + sellerShare);
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

        vm.prank(owner);
        vm.expectRevert("TemisBlock: already cancelled");
        vault.emergencyCancel(auctionId);
    }

    function test_emergencyCancel_onlyOwner() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        vm.expectRevert();
        vault.emergencyCancel(auctionId);
    }

    // ─── Platform fee ────────────────────────────────────────────────────────

    function test_settleDistributesFee() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);
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

        uint256 fee = (BID_AMT * FEE_BPS) / 10_000;
        assertEq(vault.pendingBalances(feeWallet, address(usdc)), fee);
        assertEq(vault.pendingBalances(seller, address(usdc)), BID_AMT - fee);
    }
}
