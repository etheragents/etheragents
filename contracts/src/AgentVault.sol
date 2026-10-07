// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721Receiver} from "@openzeppelin/contracts/token/ERC721/IERC721Receiver.sol";

interface ILaunchpad {
    function create(string calldata name_, string calldata symbol_, string calldata uri, uint256 minTokensOut)
        external
        payable
        returns (address coin, uint256 tokensOut);
    function buy(address coin, uint256 minTokensOut, address recipient) external payable returns (uint256);
    function sell(address coin, uint256 tokensIn, uint256 minEthOut, address payable recipient)
        external
        returns (uint256);
    function claimCreatorFees() external returns (uint256);
}

interface IAgentFactory {
    function launchpad() external view returns (address);
    function identityRegistry() external view returns (address);
    function isOperator(address who) external view returns (bool);
    function paused() external view returns (bool);
}

interface IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function setAgentURI(uint256 agentId, string calldata newURI) external;
}

/// @title AgentVault — the wallet of one Etheragents agent
/// @notice Owned by the human who created the agent. The platform's operator key (the agent's "brain") can only
///         trade through the AgentLaunchpad — buy, sell, launch a coin, claim creator fees — and every coin and every
///         wei of ETH it touches comes back to this vault. The operator can never send funds anywhere else.
///         Owner limits: `maxTradeWei` per trade and `dailyLimitWei` of ETH spent per 24h window.
///         The vault reimburses the operator's gas for each action it takes (capped per call).
///         The owner can pause the agent, withdraw ETH or tokens at any time, and trade manually.
///         Every agent is tied to exactly one coin: the vault can launch once, ever.
/// @dev Deployed as EIP-1167 clones by AgentFactory; `factory` is an immutable of the implementation, so every clone
///      shares it.
contract AgentVault is IERC721Receiver {
    using SafeERC20 for IERC20;

    IAgentFactory public immutable factory;
    uint256 public constant MAX_GAS_REFUND = 0.005 ether;
    uint256 public constant GAS_OVERHEAD = 45_000; // base tx + calldata + the refund transfer itself

    bool public initialized;
    bool public paused;
    address public owner;
    uint256 public agentId; // Etheragents id
    uint256 public identityId; // ERC-8004 agent id (valid when hasIdentity)
    bool public hasIdentity;
    uint256 public maxTradeWei; // 0 = no per-trade limit
    uint256 public dailyLimitWei; // 0 = no daily limit
    uint256 public windowStart;
    uint256 public spentInWindow;
    address public launchedCoin; // each agent launches exactly one coin in its life; set on that launch

    event Initialized(uint256 indexed agentId, address indexed owner, uint256 identityId, bool hasIdentity);
    event Bought(address indexed coin, uint256 ethIn, uint256 tokensOut, address indexed by);
    event Sold(address indexed coin, uint256 tokensIn, uint256 ethOut, address indexed by);
    event Launched(address indexed coin, uint256 ethIn, uint256 tokensOut, address indexed by);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event PausedSet(bool paused);
    event LimitsSet(uint256 maxTradeWei, uint256 dailyLimitWei);
    event OwnershipTransferred(address indexed from, address indexed to);
    event Deposited(address indexed from, uint256 amount);
    event GasRefunded(address indexed operator, uint256 amount);

    error NotFactory();
    error NotOwner();
    error NotAgent();
    error AgentPaused();
    error AlreadyInitialized();
    error OverTradeLimit();
    error OverDailyLimit();
    error InsufficientBalance();
    error EthTransferFailed();
    error NoIdentity();
    error AlreadyLaunched();

    constructor(IAgentFactory factory_) {
        factory = factory_;
        initialized = true; // lock the implementation
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev The brain (operator) or the owner, while neither the agent nor the factory is paused.
    ///      When the operator acts, the vault reimburses the operator's gas for that call (capped at
    ///      MAX_GAS_REFUND), so every agent pays for its own actions out of its own balance.
    modifier onlyAgent() {
        uint256 gasStart = gasleft();
        bool isOwner = msg.sender == owner;
        if (!isOwner && !factory.isOperator(msg.sender)) revert NotAgent();
        if (!isOwner && (paused || factory.paused())) revert AgentPaused();
        _;
        if (!isOwner) _refundGas(gasStart);
    }

    /// @notice Owners top up by sending ETH here (or via `deposit()`); sale proceeds also arrive here.
    receive() external payable {}

    function deposit() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    function initialize(
        uint256 agentId_,
        address owner_,
        string calldata agentURI,
        uint256 maxTradeWei_,
        uint256 dailyLimitWei_
    ) external payable {
        if (msg.sender != address(factory)) revert NotFactory();
        if (initialized) revert AlreadyInitialized();
        initialized = true;
        agentId = agentId_;
        owner = owner_;
        maxTradeWei = maxTradeWei_;
        dailyLimitWei = dailyLimitWei_;
        windowStart = block.timestamp;
        address reg = factory.identityRegistry();
        if (reg != address(0) && bytes(agentURI).length > 0) {
            try IIdentityRegistry(reg).register(agentURI) returns (uint256 id) {
                identityId = id;
                hasIdentity = true;
            } catch {}
        }
        if (msg.value > 0) emit Deposited(owner_, msg.value);
        emit Initialized(agentId_, owner_, identityId, hasIdentity);
    }

    // ───────────────────────────── agent actions ─────────────────────────────

    function buy(address coin, uint256 ethAmount, uint256 minTokensOut) external onlyAgent returns (uint256 out) {
        _spend(ethAmount);
        out = ILaunchpad(factory.launchpad()).buy{value: ethAmount}(coin, minTokensOut, address(this));
        emit Bought(coin, ethAmount, out, msg.sender);
    }

    function sell(address coin, uint256 tokensIn, uint256 minEthOut) external onlyAgent returns (uint256 out) {
        address lp = factory.launchpad();
        IERC20(coin).forceApprove(lp, tokensIn);
        out = ILaunchpad(lp).sell(coin, tokensIn, minEthOut, payable(address(this)));
        emit Sold(coin, tokensIn, out, msg.sender);
    }

    /// @notice Launch this agent's coin; `ethAmount` covers the launchpad's creation fee plus the agent's first buy.
    ///         Every agent is tied to one coin: a vault can launch only once, whoever calls it.
    function launch(
        string calldata name_,
        string calldata symbol_,
        string calldata uri,
        uint256 ethAmount,
        uint256 minTokensOut
    ) external onlyAgent returns (address coin, uint256 out) {
        if (launchedCoin != address(0)) revert AlreadyLaunched();
        _spend(ethAmount);
        (coin, out) = ILaunchpad(factory.launchpad()).create{value: ethAmount}(name_, symbol_, uri, minTokensOut);
        launchedCoin = coin;
        emit Launched(coin, ethAmount, out, msg.sender);
    }

    /// @notice Pull this agent's creator fees from the launchpad into the vault.
    function claimFees() external onlyAgent returns (uint256) {
        return ILaunchpad(factory.launchpad()).claimCreatorFees();
    }

    function setAgentURI(string calldata uri) external onlyAgent {
        if (!hasIdentity) revert NoIdentity();
        IIdentityRegistry(factory.identityRegistry()).setAgentURI(identityId, uri);
    }

    function _refundGas(uint256 gasStart) internal {
        uint256 amount = (gasStart - gasleft() + GAS_OVERHEAD) * tx.gasprice;
        if (amount > MAX_GAS_REFUND) amount = MAX_GAS_REFUND;
        if (amount > address(this).balance) amount = address(this).balance;
        if (amount == 0) return;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit GasRefunded(msg.sender, amount);
    }

    function _spend(uint256 amount) internal {
        if (amount > address(this).balance) revert InsufficientBalance(); // gas refund comes on top, from what is left
        if (msg.sender == owner) return; // owner trades are not limited
        if (maxTradeWei != 0 && amount > maxTradeWei) revert OverTradeLimit();
        if (dailyLimitWei != 0) {
            if (block.timestamp >= windowStart + 1 days) {
                windowStart = block.timestamp;
                spentInWindow = 0;
            }
            if (spentInWindow + amount > dailyLimitWei) revert OverDailyLimit();
            spentInWindow += amount;
        }
    }

    // ───────────────────────────── owner ─────────────────────────────

    function withdrawETH(address payable to, uint256 amount) external onlyOwner {
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit Withdrawn(address(0), to, amount);
    }

    function withdrawToken(IERC20 token, address to, uint256 amount) external onlyOwner {
        token.safeTransfer(to, amount);
        emit Withdrawn(address(token), to, amount);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setLimits(uint256 maxTradeWei_, uint256 dailyLimitWei_) external onlyOwner {
        maxTradeWei = maxTradeWei_;
        dailyLimitWei = dailyLimitWei_;
        emit LimitsSet(maxTradeWei_, dailyLimitWei_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        emit OwnershipTransferred(owner, newOwner);
        owner = newOwner;
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return IERC721Receiver.onERC721Received.selector;
    }

    function remainingToday() external view returns (uint256) {
        if (dailyLimitWei == 0) return type(uint256).max;
        if (block.timestamp >= windowStart + 1 days) return dailyLimitWei;
        return dailyLimitWei > spentInWindow ? dailyLimitWei - spentInWindow : 0;
    }
}
