// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {AgentVault, IAgentFactory} from "./AgentVault.sol";

/// @title AgentFactory — anyone creates an Etheragents agent
/// @notice `createAgent` takes a small creation fee (to the treasury), deploys the agent's AgentVault (a clone owned by
///         the caller), deposits the rest of `msg.value` into it and registers the agent as an ERC-8004 identity.
///         The persona itself lives off-chain; its keccak hash is committed in the event so it can be verified.
/// @notice The hold: once `holdToken` ($EA) is set, every agent you run needs `holdPerAgent` of it in your
///         wallet (default 100,000): creating one more needs (agents you own + 1) × holdPerAgent. Drop below the
///         hold and your agents keep trading, but you can't change them or take out their earnings until you hold
///         again. Your deposit can always come back. Until `holdToken` is set there is no hold.
/// @notice `operator`s are the platform's brain keys; they can only act through vaults, which only talk to the
///         launchpad. Owner (Ownable2Step) can rotate operators, set the fee (capped) and pause every agent at once.
contract AgentFactory is IAgentFactory, Ownable2Step, Pausable, ReentrancyGuard {
    uint256 public constant MAX_CREATION_FEE = 0.1 ether;
    uint256 public constant MAX_HOLD_PER_AGENT = 10_000_000e18;

    address public immutable implementation;
    address public immutable override launchpad;
    address public immutable override identityRegistry;

    address public treasury;
    uint256 public creationFee;
    uint256 public agentCount;
    mapping(address => bool) internal _operators;
    mapping(uint256 => address) public vaultOf;
    mapping(address => uint256) public override agentIdOf;
    mapping(address => uint256) public agentsOwned;
    IERC20 public holdToken;
    uint256 public holdPerAgent = 100_000e18;

    event AgentCreated(
        uint256 indexed agentId,
        address indexed vault,
        address indexed owner,
        string handle,
        bytes32 personaHash,
        string agentURI,
        uint256 deposit
    );
    event OperatorSet(address indexed operator, bool allowed);
    event CreationFeeSet(uint256 fee);
    event TreasurySet(address treasury);
    event HoldSet(address token, uint256 perAgent);
    event VaultOwnerChanged(uint256 indexed agentId, address indexed from, address indexed to);

    error FeeTooHigh();
    error InsufficientFee();
    error EthTransferFailed();
    error BadHandle();
    error HoldTooLow(uint256 needed, uint256 held);
    error NotVault();

    constructor(address owner_, address launchpad_, address identityRegistry_, address treasury_, uint256 fee_)
        Ownable(owner_)
    {
        if (fee_ > MAX_CREATION_FEE) revert FeeTooHigh();
        launchpad = launchpad_;
        identityRegistry = identityRegistry_;
        treasury = treasury_;
        creationFee = fee_;
        implementation = address(new AgentVault(IAgentFactory(address(this))));
    }

    function createAgent(
        string calldata handle,
        bytes32 personaHash,
        string calldata agentURI,
        uint256 maxTradeWei,
        uint256 dailyLimitWei
    ) external payable nonReentrant whenNotPaused returns (uint256 agentId, address vault) {
        uint256 len = bytes(handle).length;
        if (len == 0 || len > 32) revert BadHandle();
        if (msg.value < creationFee) revert InsufficientFee();
        uint256 owned = ++agentsOwned[msg.sender];
        if (address(holdToken) != address(0)) {
            uint256 held = holdToken.balanceOf(msg.sender);
            if (held < owned * holdPerAgent) revert HoldTooLow(owned * holdPerAgent, held);
        }
        agentId = ++agentCount;
        vault = Clones.clone(implementation);
        vaultOf[agentId] = vault;
        agentIdOf[vault] = agentId;
        uint256 dep = msg.value - creationFee;
        if (creationFee > 0) {
            (bool ok,) = treasury.call{value: creationFee}("");
            if (!ok) revert EthTransferFailed();
        }
        AgentVault(payable(vault)).initialize{value: dep}(agentId, msg.sender, agentURI, maxTradeWei, dailyLimitWei);
        emit AgentCreated(agentId, vault, msg.sender, handle, personaHash, agentURI, dep);
    }

    /// @notice Whether `owner` holds enough $EA for every agent it owns (always true before the token is set).
    function holdOk(address owner) public view override returns (bool) {
        if (address(holdToken) == address(0)) return true;
        return holdToken.balanceOf(owner) >= agentsOwned[owner] * holdPerAgent;
    }

    /// @notice $EA needed to create one more agent from `owner`.
    function holdNeeded(address owner) external view returns (uint256) {
        if (address(holdToken) == address(0)) return 0;
        return (agentsOwned[owner] + 1) * holdPerAgent;
    }

    /// @dev Vaults report ownership transfers so agent counts follow the owner.
    function vaultOwnerChanged(address from, address to) external override {
        uint256 id = agentIdOf[msg.sender];
        if (id == 0) revert NotVault();
        if (agentsOwned[from] > 0) agentsOwned[from]--;
        agentsOwned[to]++;
        emit VaultOwnerChanged(id, from, to);
    }

    function setHold(IERC20 token, uint256 perAgent) external onlyOwner {
        if (perAgent > MAX_HOLD_PER_AGENT) revert FeeTooHigh();
        holdToken = token;
        holdPerAgent = perAgent;
        emit HoldSet(address(token), perAgent);
    }

    function isOperator(address who) external view override returns (bool) {
        return _operators[who];
    }

    function paused() public view override(IAgentFactory, Pausable) returns (bool) {
        return Pausable.paused();
    }

    function setOperator(address op, bool allowed) external onlyOwner {
        _operators[op] = allowed;
        emit OperatorSet(op, allowed);
    }

    function setCreationFee(uint256 fee) external onlyOwner {
        if (fee > MAX_CREATION_FEE) revert FeeTooHigh();
        creationFee = fee;
        emit CreationFeeSet(fee);
    }

    function setTreasury(address t) external onlyOwner {
        treasury = t;
        emit TreasurySet(t);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
