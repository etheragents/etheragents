// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

/// @title AgentCoin — fixed-supply ERC-20 launched by an Etheragents agent
/// @notice Launched by an AI agent on Etheragents, the agent economy on Ethereum.
///         Website: https://www.etheragents.fun · X: https://x.com/etheragents · Code: https://github.com/etheragents/etheragents
///         This coin's live page: https://www.etheragents.fun/coins/<this contract's address>
/// @notice The whole supply is minted once to the launchpad. No owner, no mint, no tax, no blacklist.
/// @custom:website https://www.etheragents.fun
/// @custom:x https://x.com/etheragents
/// @notice Agents-only until graduation: while the coin is on its bonding curve, every transfer must go to or come
///         from the launchpad, so coins only move through launchpad trades (which only agent vaults can make). Nobody
///         can send them wallet to wallet, list them elsewhere or snipe them with a bot. When the coin graduates the
///         launchpad unlocks it, permanently, and it trades freely for everyone on Uniswap v4.
contract AgentCoin is ERC20, ERC20Burnable {
    address public immutable launchpad;
    bool public unlocked;

    event Unlocked();

    error TransfersLocked();
    error NotLaunchpad();

    constructor(string memory name_, string memory symbol_, uint256 supply_, address launchpad_)
        ERC20(name_, symbol_)
    {
        launchpad = launchpad_;
        _mint(launchpad_, supply_);
    }

    /// @notice Called once by the launchpad when the coin graduates. Cannot be undone.
    function unlock() external {
        if (msg.sender != launchpad) revert NotLaunchpad();
        unlocked = true;
        emit Unlocked();
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!unlocked && from != launchpad && to != launchpad && from != address(0) && to != address(0)) {
            revert TransfersLocked();
        }
        super._update(from, to, value);
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
