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

    // Bidder derived from a known private key for EIP-712 signing
    uint256 bidderKey = 0xBEEF;
    address bidder = vm.addr(bidderKey);

    uint256 constant RESERVE = 100e6; // 100 USDC (6 decimals)
    uint256 constant BID_AMT = 150e6; // 150 USDC
    uint256 constant DURATION = 1 days;

    function setUp() public {
        vm.startPrank(owner);
        vault = new TemisBlock(owner);
        vm.stopPrank();

        nft = new MockNFT();
        usdc = new MockUSDC();

        // Give seller an NFT and bidder USDC
        nft.mint(seller, 1);
        usdc.mint(bidder, 1000e6);
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
        uint256 amount,
        uint256 nonce
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Bid(uint256 auctionId,address bidder,uint256 amount,uint256 nonce)"
                ),
                auctionId,
                bidder,
                amount,
                nonce
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
        // NFT must be held by the vault
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

    // ─── settleAuction ────────────────────────────────────────────────────────

    function test_settle_transfersNFTAndFunds() public {
        uint256 auctionId = _createAuction();

        // Approve vault to pull USDC from bidder
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);

        bytes memory sig = _signBid(auctionId, BID_AMT, 0);

        // Warp past end time
        vm.warp(block.timestamp + DURATION + 1);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId,
            bidder: bidder,
            amount: BID_AMT,
            nonce: 0
        });
        vault.settleAuction(bid, sig);

        // NFT now belongs to bidder
        assertEq(nft.ownerOf(1), bidder);
        // Seller has pending balance
        assertEq(vault.pendingBalances(seller, address(usdc)), BID_AMT);
        // Nonce incremented
        assertEq(vault.nonces(bidder), 1);
    }

    function test_settle_revertsBeforeEnd() public {
        uint256 auctionId = _createAuction();
        bytes memory sig = _signBid(auctionId, BID_AMT, 0);

        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId,
            bidder: bidder,
            amount: BID_AMT,
            nonce: 0
        });
        vm.expectRevert("TemisBlock: auction not ended");
        vault.settleAuction(bid, sig);
    }

    function test_settle_revertsInvalidSignature() public {
        uint256 auctionId = _createAuction();

        // Sign with wrong key
        uint256 wrongKey = 0xDEAD;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "Bid(uint256 auctionId,address bidder,uint256 amount,uint256 nonce)"
                ),
                auctionId,
                bidder,
                BID_AMT,
                uint256(0)
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
            nonce: 0
        });
        vm.expectRevert("TemisBlock: invalid signature");
        vault.settleAuction(bid, badSig);
    }

    function test_settle_revertsReplayedNonce() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT * 2);

        bytes memory sig = _signBid(auctionId, BID_AMT, 0);
        vm.warp(block.timestamp + DURATION + 1);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId,
            bidder: bidder,
            amount: BID_AMT,
            nonce: 0
        });
        vault.settleAuction(bid, sig);

        // Same auctionId → reverts with "already settled" (checked before nonce)
        vm.expectRevert("TemisBlock: already settled");
        vault.settleAuction(bid, sig);
    }

    function test_settle_revertsWrongNonce() public {
        // Create two auctions to test stale nonce on a fresh auction
        nft.mint(seller, 2);
        vm.startPrank(seller);
        nft.approve(address(vault), 2);
        uint256 auctionId2 = vault.createAuction(
            address(nft),
            2,
            address(usdc),
            RESERVE,
            DURATION
        );
        vm.stopPrank();

        // Sign with nonce=1 but bidder's on-chain nonce is still 0
        bytes memory sig = _signBid(auctionId2, BID_AMT, 1);
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);
        vm.warp(block.timestamp + DURATION + 1);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId2,
            bidder: bidder,
            amount: BID_AMT,
            nonce: 1
        });
        // bidder's nonce is still 0 → mismatch
        vm.expectRevert("TemisBlock: invalid nonce");
        vault.settleAuction(bid, sig);
    }

    // ─── Two-Step Withdrawal ─────────────────────────────────────────────────

    function test_withdrawal_happyPath() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        usdc.approve(address(vault), BID_AMT);
        bytes memory sig = _signBid(auctionId, BID_AMT, 0);
        vm.warp(block.timestamp + DURATION + 1);

        TemisBlock.Bid memory bid = TemisBlock.Bid({
            auctionId: auctionId,
            bidder: bidder,
            amount: BID_AMT,
            nonce: 0
        });
        vault.settleAuction(bid, sig);

        // Seller requests withdrawal
        vm.prank(seller);
        vault.requestWithdrawal(address(usdc), BID_AMT);

        // Cannot execute before delay
        vm.expectRevert("TemisBlock: timelock active");
        vm.prank(seller);
        vault.executeWithdrawal(address(usdc));

        // Warp past delay
        vm.warp(block.timestamp + 1 hours + 1);

        uint256 before = usdc.balanceOf(seller);
        vm.prank(seller);
        vault.executeWithdrawal(address(usdc));
        assertEq(usdc.balanceOf(seller), before + BID_AMT);
    }

    function test_withdrawal_revertsNoPendingRequest() public {
        vm.prank(seller);
        vm.expectRevert("TemisBlock: no pending request");
        vault.executeWithdrawal(address(usdc));
    }

    // ─── emergencyCancel ─────────────────────────────────────────────────────

    function test_emergencyCancel_returnsNFT() public {
        uint256 auctionId = _createAuction();
        assertEq(nft.ownerOf(1), address(vault));

        vm.prank(owner);
        vault.emergencyCancel(auctionId);

        // NFT returned to seller
        assertEq(nft.ownerOf(1), seller);

        // Cannot cancel again
        vm.prank(owner);
        vm.expectRevert("TemisBlock: already cancelled");
        vault.emergencyCancel(auctionId);
    }

    function test_emergencyCancel_onlyOwner() public {
        uint256 auctionId = _createAuction();
        vm.prank(bidder);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        vault.emergencyCancel(auctionId);
    }
}
