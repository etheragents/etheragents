// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IVaultRegistry {
    function agentIdOf(address vault) external view returns (uint256);
}

/// @title TokenRewards — where $ETHERAGENTS's own trading rewards go
/// @notice The creator rewards of $ETHERAGENTS are paid here and split by `split()` (anyone may call):
///         60% to the drop pool: dropped back to holders' agents at random, in small cuts, so it spreads wide;
///         10% to BuybackBurn: buys $ETHERAGENTS back and burns it;
///         20% to the brain fund: pays for every agent's thinking (AI credits);
///         10% to the team.
/// @notice Drops only ever go to agent vaults registered in the AgentFactory, where they count as earnings.
contract TokenRewards is Ownable2Step, ReentrancyGuard {
    uint256 public constant BPS = 10_000;
    uint256 public constant DROP_BPS = 6_000;
    uint256 public constant BURN_BPS = 1_000;
    uint256 public constant BRAIN_BPS = 2_000;
    // TEAM = the remaining 1_000

    IVaultRegistry public immutable factory;
    address public buyback;
    address public brainFund;
    address public team;
    mapping(address => bool) public keepers;

    uint256 public dropPool; // ETH waiting to be dropped
    uint256 public burnOwed; // waits here until BuybackBurn is set
    uint256 public totalSplit;
    uint256 public totalDropped;

    event Split(uint256 amount, uint256 toDrops, uint256 toBurn, uint256 toBrain, uint256 toTeam);
    event Dropped(address indexed vault, uint256 indexed agentId, uint256 amount);
    event AddressesSet(address buyback, address brainFund, address team);
    event KeeperSet(address keeper, bool allowed);

    error NotKeeper();
    error NotAgent();
    error OverPool();
    error LengthMismatch();
    error EthTransferFailed();

    constructor(address owner_, IVaultRegistry factory_, address buyback_, address brainFund_, address team_)
        Ownable(owner_)
    {
        factory = factory_;
        buyback = buyback_;
        brainFund = brainFund_;
        team = team_;
    }

    receive() external payable {}

    function setAddresses(address buyback_, address brainFund_, address team_) external onlyOwner {
        buyback = buyback_;
        brainFund = brainFund_;
        team = team_;
        emit AddressesSet(buyback_, brainFund_, team_);
    }

    function setKeeper(address k, bool allowed) external onlyOwner {
        keepers[k] = allowed;
        emit KeeperSet(k, allowed);
    }

    /// @notice ETH received since the last split.
    function unsplit() public view returns (uint256) {
        return address(this).balance - dropPool - burnOwed;
    }

    function split() external nonReentrant returns (uint256 amount) {
        amount = unsplit();
        if (amount == 0) return 0;
        uint256 toDrops = amount * DROP_BPS / BPS;
        uint256 toBurn = amount * BURN_BPS / BPS;
        uint256 toBrain = amount * BRAIN_BPS / BPS;
        uint256 toTeam = amount - toDrops - toBurn - toBrain;
        dropPool += toDrops;
        totalSplit += amount;
        uint256 burnNow = burnOwed + toBurn;
        if (buyback != address(0)) {
            burnOwed = 0;
            _send(buyback, burnNow);
        } else {
            burnOwed = burnNow;
        }
        _send(brainFund, toBrain);
        _send(team, toTeam);
        emit Split(amount, toDrops, toBurn, toBrain, toTeam);
    }

    /// @notice Drop ETH from the pool into agent vaults (the keeper picks holders' agents at random).
    function drop(address[] calldata vaults, uint256[] calldata amounts) external nonReentrant {
        if (!keepers[msg.sender] && msg.sender != owner()) revert NotKeeper();
        if (vaults.length != amounts.length) revert LengthMismatch();
        for (uint256 i; i < vaults.length; i++) {
            uint256 id = factory.agentIdOf(vaults[i]);
            if (id == 0) revert NotAgent();
            if (amounts[i] > dropPool) revert OverPool();
            dropPool -= amounts[i];
            totalDropped += amounts[i];
            _send(vaults[i], amounts[i]);
            emit Dropped(vaults[i], id, amounts[i]);
        }
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }
}
