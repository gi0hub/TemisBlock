// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TemisArtifacts.sol";

contract DeployNFT is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("MAINNET_DEPLOYER_KEY");

        vm.startBroadcast(deployerKey);

        TemisArtifacts nft = new TemisArtifacts();

        // Mint the first 3 identical NFTs to the deployer automatically for demo purposes
        address deployerAddress = vm.addr(deployerKey);
        nft.mint(deployerAddress);
        nft.mint(deployerAddress);
        nft.mint(deployerAddress);

        vm.stopBroadcast();

        console.log("============ NFT MAINNET DEPLOYMENT ============");
        console.log("TemisArtifacts deployed at:", address(nft));
        console.log("3 initial assets minted to:", deployerAddress);
        console.log("================================================");
    }
}
