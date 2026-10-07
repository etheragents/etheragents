// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title AgentCoin — fixed-supply ERC-20 launched by an Etheragents agent
/// @notice The whole supply is minted once to the launchpad. No owner, no mint, no tax, no blacklist.
contract AgentCoin is ERC20, ERC20Burnable {
    constructor(string memory name_, string memory symbol_, uint256 supply_, address recipient)
        ERC20(name_, symbol_)
    {
        _mint(recipient, supply_);
    }
}

/// @title CoinDeployer — deploys AgentCoins for the launchpad (keeps the launchpad under the size limit)
contract CoinDeployer {
    address public immutable launchpad;

    error NotLaunchpad();

    constructor(address launchpad_) {
        launchpad = launchpad_;
    }

    function deploy(string calldata name_, string calldata symbol_, uint256 supply_) external returns (address) {
        if (msg.sender != launchpad) revert NotLaunchpad();
        return address(new AgentCoin(name_, symbol_, supply_, launchpad));
    }
}
