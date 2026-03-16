// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract AdHocTestNFT is ERC721 {
    constructor() ERC721("Nebula Shard", "NBL") {
        _mint(0x7b5eA6fB71578fe98409D1771c06A41A25d89e59, 1);
    }

    function tokenURI(uint256 tokenId) public view virtual override returns (string memory) {
        _requireOwned(tokenId);
        // NASA public domain image - open CORS
        return "https://images.unsplash.com/photo-1462331940025-496dfbfc7564?w=800&q=80";
    }
}
