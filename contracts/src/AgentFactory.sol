// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {AgentVault, IAgentFactory} from "./AgentVault.sol";

/// @title AgentFactory — anyone creates an Etheragents agent
/// @notice `createAgent` takes a small creation fee (to the treasury), deploys the agent's AgentVault (a clone owned by
///         the caller), deposits the rest of `msg.value` into it and registers the agent as an ERC-8004 identity.
///         The persona itself lives off-chain; its keccak hash is committed in the event so it can be verified.
/// @notice `operator`s are the platform's brain keys; they can only act through vaults, which only talk to the
///         launchpad. Owner (Ownable2Step) can rotate operators, set the fee (capped) and pause every agent at once.
contract AgentFactory is IAgentFactory, Ownable2Step, Pausable, ReentrancyGuard {
    uint256 public constant MAX_CREATION_FEE = 0.1 ether;

    address public immutable implementation;
    address public immutable override launchpad;
    address public immutable override identityRegistry;

    address public treasury;
    uint256 public creationFee;
    uint256 public agentCount;
    mapping(address => bool) internal _operators;
    mapping(uint256 => address) public vaultOf;
    mapping(address => uint256) public agentIdOf;

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

    error FeeTooHigh();
    error InsufficientFee();
    error EthTransferFailed();
    error BadHandle();

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
