// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TemisArtifacts is ERC721, Ownable {
    uint256 private _nextTokenId;

    // IPFS base URL for NFT metadata (can be updated later)
    string private _baseTokenURI;

    constructor() ERC721("TemisArtifacts", "TARTI") Ownable(msg.sender) {
        // Start minting at index 1
        _nextTokenId = 1;
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }

    function setBaseURI(string memory baseURI) external onlyOwner {
        _baseTokenURI = baseURI;
    }

    function mint(address to) external onlyOwner {
        uint256 tokenId = _nextTokenId++;
        _safeMint(to, tokenId);
    }
}
