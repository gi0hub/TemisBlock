// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TemisBlock.sol";

contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("KEY_ADDRESS_SEPOLIA_BASE");
        address deployer = vm.addr(deployerKey);

        // For testnet, deployer is owner, feeRecipient, and relayer
        address owner = deployer;
        address feeRecipient = deployer;
        address relayer = deployer;
        uint256 feeBps = 150; // 1.5%

        vm.startBroadcast(deployerKey);

        TemisBlock vault = new TemisBlock(owner, feeBps, feeRecipient, relayer);

        vm.stopBroadcast();

        console.log("TemisBlock deployed at:", address(vault));
        console.log("Owner / FeeRecipient / Relayer:", deployer);
        console.log("Fee:", feeBps, "bps (1.5%)");
    }
}
