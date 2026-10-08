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
    function isCoin(address coin) external view returns (bool);
}

interface IAgentFactory {
    function launchpad() external view returns (address);
    function identityRegistry() external view returns (address);
    function isOperator(address who) external view returns (bool);
    function paused() external view returns (bool);
    function agentIdOf(address vault) external view returns (uint256);
    function holdOk(address owner) external view returns (bool);
    function vaultOwnerChanged(address from, address to) external;
}

interface IIdentityRegistry {
    function register(string calldata agentURI) external returns (uint256 agentId);
    function setAgentURI(uint256 agentId, string calldata newURI) external;
}

/// @title AgentVault — the wallet of one Etheragents agent
/// @notice Owned by the human who created the agent. The platform's operator key (the agent's "brain") can only
///         trade through the AgentLaunchpad — buy, sell, launch a coin, claim creator fees — and every coin and every
///         wei of ETH it touches comes back to this vault. The operator can never send funds anywhere else.
///         The agent trades, not the owner: only the brain buys and launches. The owner can sell positions (an exit
///         hatch) and pause the agent.
///         Owner limits: `maxTradeWei` per trade and `dailyLimitWei` of ETH spent per 24h window.
///         The vault reimburses the operator's gas for each action it takes (capped per call).
///         Every agent is tied to exactly one coin: the vault can launch once, ever.
/// @notice Money out, always to the owner's own wallet:
///         - the deposit (`principal`: what the owner put in, less what it took out) comes back any time, no timer;
///         - earnings (everything above the deposit: trading profit, creator fees, $ETHERAGENTS drops) come out at up
///           to 5% of the vault's balance once every 24 hours, starting 72 hours after the agent was made, and only
///           while the owner holds enough $ETHERAGENTS for all of its agents (AgentFactory.holdOk).
/// @dev Deployed as EIP-1167 clones by AgentFactory; `factory` is an immutable of the implementation, so every clone
///      shares it.
contract AgentVault is IERC721Receiver {
    using SafeERC20 for IERC20;

    IAgentFactory public immutable factory;
    uint256 public constant MAX_GAS_REFUND = 0.005 ether;
    uint256 public constant GAS_OVERHEAD = 35_000; // base tx + calldata + the refund transfer itself
    uint256 public constant MAX_TIP = 3 gwei; // refunds never pay more than basefee + this per gas
    uint256 public constant EARNINGS_UNLOCK = 72 hours;
    uint256 public constant EARNINGS_PERIOD = 24 hours;
    uint256 public constant EARNINGS_BPS = 500; // 5% of the balance per period

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
    uint256 public createdAt;
    uint256 public principal; // the owner's deposit: put in, less taken out
    uint256 public lastEarningsAt; // last earnings withdrawal
    uint256 public depositWindowStart; // owner deposits in the last 24h don't count towards the 5% earnings cap
    uint256 public depositedInWindow;

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
    event Received(address indexed from, uint256 amount);
    event DepositWithdrawn(address indexed to, uint256 amount);
    event EarningsWithdrawn(address indexed to, uint256 amount);

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
    error HoldTooLow();
    error EarningsLocked();
    error OverEarningsLimit();
    error AgentCoinLocked();
    error NotOperator();
    error ZeroAddress();

    constructor(IAgentFactory factory_) {
        factory = factory_;
        initialized = true; // lock the implementation
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @dev Only the brain (operator), while neither the agent nor the factory is paused. Refunds its gas.
    modifier onlyOperator() {
        uint256 gasStart = gasleft();
        if (!factory.isOperator(msg.sender)) revert NotOperator();
        if (paused || factory.paused()) revert AgentPaused();
        _;
        _refundGas(gasStart);
    }

    modifier holding() {
        if (!factory.holdOk(owner)) revert HoldTooLow();
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

    /// @notice ETH sent by the owner is a deposit; anything else (sale proceeds, fees, drops) is earnings.
    receive() external payable {
        if (msg.sender == owner) {
            _addPrincipal(msg.value);
            emit Deposited(msg.sender, msg.value);
        } else if (msg.value > 0 && msg.sender != factory.launchpad()) {
            emit Received(msg.sender, msg.value);
        }
    }

    /// @notice Top up the agent. Counts as the owner's deposit only when the owner sends it.
    function deposit() external payable {
        if (msg.sender == owner) _addPrincipal(msg.value);
        emit Deposited(msg.sender, msg.value);
    }

    function _addPrincipal(uint256 amount) internal {
        principal += amount;
        if (block.timestamp >= depositWindowStart + EARNINGS_PERIOD) {
            depositWindowStart = block.timestamp;
            depositedInWindow = 0;
        }
        depositedInWindow += amount;
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
        createdAt = block.timestamp;
        principal = msg.value;
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

    function buy(address coin, uint256 ethAmount, uint256 minTokensOut) external onlyOperator returns (uint256 out) {
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
    ) external onlyOperator returns (address coin, uint256 out) {
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
        if (msg.sender == owner && !factory.holdOk(owner)) revert HoldTooLow();
        IIdentityRegistry(factory.identityRegistry()).setAgentURI(identityId, uri);
    }

    function _refundGas(uint256 gasStart) internal {
        uint256 price = tx.gasprice;
        if (price > block.basefee + MAX_TIP) price = block.basefee + MAX_TIP;
        uint256 amount = (gasStart - gasleft() + GAS_OVERHEAD) * price;
        if (amount > MAX_GAS_REFUND) amount = MAX_GAS_REFUND;
        if (amount > address(this).balance) amount = address(this).balance;
        if (amount == 0) return;
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit GasRefunded(msg.sender, amount);
    }

    function _spend(uint256 amount) internal {
        if (amount > address(this).balance) revert InsufficientBalance(); // gas refund comes on top, from what is left
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

    /// @notice Take back (part of) your deposit. Any time, no timer, no hold needed. Capped by what the vault holds.
    function withdrawDeposit(uint256 amount) external onlyOwner {
        if (amount > principal || amount > address(this).balance) revert InsufficientBalance();
        principal -= amount;
        depositedInWindow = amount < depositedInWindow ? depositedInWindow - amount : 0;
        _sendOwner(amount);
        emit DepositWithdrawn(owner, amount);
    }

    /// @notice ETH above the deposit.
    function earnings() public view returns (uint256) {
        uint256 bal = address(this).balance;
        return bal > principal ? bal - principal : 0;
    }

    /// @notice Earnings that can come out right now (0 while locked, on cooldown or below the hold).
    function earningsAvailable() public view returns (uint256) {
        if (block.timestamp < createdAt + EARNINGS_UNLOCK) return 0;
        if (lastEarningsAt != 0 && block.timestamp < lastEarningsAt + EARNINGS_PERIOD) return 0;
        if (!factory.holdOk(owner)) return 0;
        // 5% of the balance, not counting deposits from the last 24h (so a temporary top-up can't lift the cap)
        uint256 bal = address(this).balance;
        uint256 recent = block.timestamp < depositWindowStart + EARNINGS_PERIOD ? depositedInWindow : 0;
        uint256 cap = (bal > recent ? bal - recent : 0) * EARNINGS_BPS / 10_000;
        uint256 e = earnings();
        return e < cap ? e : cap;
    }

    /// @notice When the next earnings withdrawal opens (unix seconds).
    function earningsOpenAt() external view returns (uint256) {
        uint256 t = createdAt + EARNINGS_UNLOCK;
        if (lastEarningsAt != 0 && lastEarningsAt + EARNINGS_PERIOD > t) t = lastEarningsAt + EARNINGS_PERIOD;
        return t;
    }

    /// @notice Take out earnings: up to 5% of the balance once per 24h, from 72h after creation, while holding.
    function withdrawEarnings(uint256 amount) external onlyOwner holding {
        if (block.timestamp < createdAt + EARNINGS_UNLOCK) revert EarningsLocked();
        if (lastEarningsAt != 0 && block.timestamp < lastEarningsAt + EARNINGS_PERIOD) revert EarningsLocked();
        if (amount == 0 || amount > earningsAvailable()) revert OverEarningsLimit();
        lastEarningsAt = block.timestamp;
        _sendOwner(amount);
        emit EarningsWithdrawn(owner, amount);
    }

    /// @notice Recover a token sent here by mistake. Launchpad coins can't be withdrawn: the agent sells them.
    function withdrawToken(IERC20 token, uint256 amount) external onlyOwner holding {
        if (ILaunchpad(factory.launchpad()).isCoin(address(token))) revert AgentCoinLocked();
        token.safeTransfer(owner, amount);
        emit Withdrawn(address(token), owner, amount);
    }

    function _sendOwner(uint256 amount) internal {
        (bool ok,) = owner.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
        emit Withdrawn(address(0), owner, amount);
    }

    function setPaused(bool p) external onlyOwner {
        paused = p;
        emit PausedSet(p);
    }

    function setLimits(uint256 maxTradeWei_, uint256 dailyLimitWei_) external onlyOwner holding {
        maxTradeWei = maxTradeWei_;
        dailyLimitWei = dailyLimitWei_;
        emit LimitsSet(maxTradeWei_, dailyLimitWei_);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        emit OwnershipTransferred(owner, newOwner);
        factory.vaultOwnerChanged(owner, newOwner);
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
