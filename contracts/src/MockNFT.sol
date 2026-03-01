// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/**
 * @title MockNFT
 * @notice Unrestricted ERC721 for development use.
 */
contract MockNFT is ERC721 {
    constructor() ERC721("MockNFT", "MNFT") {}

    /// @notice Mints `tokenId` to `to`. No access restrictions.
    function mint(address to, uint256 tokenId) external {
        _mint(to, tokenId);
    }
}
