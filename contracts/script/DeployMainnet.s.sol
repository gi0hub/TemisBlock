// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/TemisBlock.sol";

contract DeployMainnet is Script {
    function run() external {
        // Strict separation of variables for Mainnet safety
        uint256 deployerKey = vm.envUint("MAINNET_DEPLOYER_KEY");
        address deployer = vm.addr(deployerKey);

        address protocolOwner = vm.envAddress("MAINNET_OWNER_ADDRESS");
        address feeRecipient = vm.envAddress("MAINNET_TREASURY_ADDRESS");
        address relayer = vm.envAddress("MAINNET_RELAYER_ADDRESS");
        uint256 feeBps = 150; // 1.5%

        vm.startBroadcast(deployerKey);

        TemisBlock vault = new TemisBlock(
            protocolOwner,
            feeBps,
            feeRecipient,
            relayer
        );

        vm.stopBroadcast();

        console.log("============ MAINNET DEPLOYMENT ============");
        console.log("TemisBlock deployed at:", address(vault));
        console.log("Contract Owner:", protocolOwner);
        console.log("Treasury Recipient:", feeRecipient);
        console.log("Authorized Session Relayer:", relayer);
        console.log("Fee:", feeBps, "bps (1.5%)");
        console.log("============================================");
    }
}
