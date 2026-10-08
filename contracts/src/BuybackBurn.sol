// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title BuybackBurn — turns ETH into burned $ETHERAGENTS
/// @notice Receives the burn share of every fee (10% of each agent coin's fees, 10% of $ETHERAGENTS's own rewards).
///         A keeper swaps that ETH for $ETHERAGENTS through an allow-listed router (e.g. Uniswap's Universal Router,
///         with this contract as the recipient) and every $ETHERAGENTS this contract holds is sent to the dead address
///         in the same transaction. ETH can only leave through `buyAndBurn`, and only into an allow-listed router.
///         Keepers must name a minimum output and can spend at most `maxEthPerDay` (default 2 ETH), so a leaked
///         keeper key can't empty it. Allow-list routers whose swaps pay out only to the given recipient (e.g. the
///         Uniswap V2 Router); a router with generic transfer commands would let a keeper redirect ETH.
/// @notice The token is set once, when $ETHERAGENTS is live; until then ETH simply accumulates here.
contract BuybackBurn is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;

    IERC20 public token;
    mapping(address => bool) public keepers;
    mapping(address => bool) public routers;
    uint256 public maxEthPerDay = 2 ether; // caps what a keeper can spend, in case a keeper key leaks
    uint256 public dayStart;
    uint256 public spentToday;
    uint256 public totalEthSpent;
    uint256 public totalBurned;

    event TokenSet(address token);
    event KeeperSet(address keeper, bool allowed);
    event RouterSet(address router, bool allowed);
    event BuybackBurned(address indexed router, uint256 ethIn, uint256 tokensBought, uint256 tokensBurned);

    error AlreadySet();
    error NotKeeper();
    error NotRouter();
    error NoToken();
    error Slippage();
    error SwapFailed(bytes reason);
    error OverDailyLimit();

    constructor(address owner_) Ownable(owner_) {}

    receive() external payable {}

    function setToken(IERC20 t) external onlyOwner {
        if (address(token) != address(0)) revert AlreadySet();
        token = t;
        emit TokenSet(address(t));
    }

    function setMaxEthPerDay(uint256 m) external onlyOwner {
        maxEthPerDay = m;
    }

    function setKeeper(address k, bool allowed) external onlyOwner {
        keepers[k] = allowed;
        emit KeeperSet(k, allowed);
    }

    function setRouter(address r, bool allowed) external onlyOwner {
        routers[r] = allowed;
        emit RouterSet(r, allowed);
    }

    /// @notice Swap `ethAmount` through `router` with `data` (recipient must be this contract), then burn every
    ///         $ETHERAGENTS held here. Reverts unless at least `minTokens` were bought.
    function buyAndBurn(address router, bytes calldata data, uint256 ethAmount, uint256 minTokens)
        external
        nonReentrant
        returns (uint256 bought, uint256 burned)
    {
        if (!keepers[msg.sender] && msg.sender != owner()) revert NotKeeper();
        if (!routers[router]) revert NotRouter();
        if (address(token) == address(0)) revert NoToken();
        if (minTokens == 0) revert Slippage();
        if (msg.sender != owner()) {
            if (block.timestamp >= dayStart + 1 days) {
                dayStart = block.timestamp;
                spentToday = 0;
            }
            if (spentToday + ethAmount > maxEthPerDay) revert OverDailyLimit();
            spentToday += ethAmount;
        }
        uint256 ethBefore = address(this).balance;
        uint256 before = token.balanceOf(address(this));
        (bool ok, bytes memory reason) = router.call{value: ethAmount}(data);
        if (!ok) revert SwapFailed(reason);
        if (ethBefore - address(this).balance > ethAmount) revert Slippage(); // the router took more than allowed
        uint256 afterBal = token.balanceOf(address(this));
        bought = afterBal - before;
        if (bought < minTokens) revert Slippage();
        burned = afterBal;
        token.safeTransfer(DEAD, burned);
        totalEthSpent += ethAmount;
        totalBurned += burned;
        emit BuybackBurned(router, ethAmount, bought, burned);
    }
}
