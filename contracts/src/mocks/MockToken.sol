// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Local tests only: stands in for $EA.
contract MockToken is ERC20 {
    constructor() ERC20("Mock Etheragents", "MOCK") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Local tests only: a "router" that sells MockToken for ETH at a fixed rate to whoever it is told.
contract MockRouter {
    MockToken public immutable token;
    uint256 public immutable perEth;

    constructor(MockToken t, uint256 perEth_) {
        token = t;
        perEth = perEth_;
    }

    function swap(address to) external payable {
        token.mint(to, msg.value * perEth);
    }
}
