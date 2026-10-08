// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

import {IPoolManager} from "v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {IHooks} from "v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "v4-core/src/types/PoolId.sol";
import {Currency} from "v4-core/src/types/Currency.sol";
import {BalanceDelta} from "v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams, SwapParams} from "v4-core/src/types/PoolOperation.sol";
import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {FixedPoint96} from "v4-core/src/libraries/FixedPoint96.sol";
import {StateLibrary} from "v4-core/src/libraries/StateLibrary.sol";

import {LiquidityAmountsLib} from "./libraries/LiquidityAmountsLib.sol";
import {TickAlign} from "./libraries/TickAlign.sol";

interface ICoinDeployer {
    function deploy(string calldata name_, string calldata symbol_, uint256 supply_) external returns (address);
}

interface IBurnable {
    function burn(uint256 amount) external;
}

interface IUnlockable {
    function unlock() external;
}

interface IAgentRegistry {
    function agentIdOf(address vault) external view returns (uint256);
}

/// @title AgentLaunchpad — ETH bonding-curve launchpad for Etheragents coins, graduating to Uniswap v4
/// @notice Anyone (in practice: agent vaults) creates a coin: 1,000,000,000 supply on a virtual constant-product
///         curve priced in ETH: x = virtualEth + ethReserve, y = virtualToken - tokensSold, x·y = virtualEth·virtualToken.
///         `curveSupply` tokens are sold on the curve. The buy that sells the last curve token graduates the coin in
///         the same transaction: an ETH/coin Uniswap v4 pool is initialized at the curve's spot price (through the
///         GraduationGuardHook so nobody can front-run it), all of the coin's ETH plus the matching amount of unsold
///         coins go in as full-range liquidity owned by this contract forever (no function removes it), and the rest
///         of the unsold supply is burned. After that, `buy`/`sell` route through the pool, so agents use one API.
/// @notice Agents only until graduation: while a coin is on its curve, only registered agent vaults (AgentFactory)
///         can create, buy or sell, always for themselves, and AgentCoin refuses every transfer that does not go
///         through this contract. Graduation unlocks the coin for everyone.
/// @notice Fees: 1% of the ETH side of every trade, split 75% to the coin's creator (its agent vault), 15% to the
///         brain fund (pays for the agents' thinking: the creator agent's own inference budget) and 10% to buy back
///         and burn $ETHERAGENTS. After graduation the pool's own 1% LP fee accrues to this contract's position;
///         `collectFees(coin)` (anyone) splits the ETH side the same way and burns the coin side.
/// @notice Curve parameters are owner-set and apply to coins created afterwards. Defaults: start market cap
///         0.0707 ETH → graduation market cap 3.8 ETH (×53.8), ~88% of supply sold on the curve.
/// @notice Safety: owner can pause create/buy/sell (claims stay open); `rescueETH`/`rescueERC20` only move surplus,
///         never curve reserves, owed fees or a coin's unsold supply.
contract AgentLaunchpad is Ownable2Step, Pausable, ReentrancyGuard, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;
    using StateLibrary for IPoolManager;

    uint256 public constant SUPPLY = 1_000_000_000e18;
    uint256 public constant BPS = 10_000;
    uint256 public constant FEE_BPS = 100; // 1% of the ETH side
    uint256 public constant CREATOR_SHARE_BPS = 7_500; // of the fee: the launching agent's vault
    uint256 public constant BRAIN_SHARE_BPS = 1_500; // of the fee: the brain fund (agents' inference)
    // the remaining 1_000 bps of the fee buy back and burn $ETHERAGENTS
    uint24 public constant POOL_FEE = 10_000; // 1% LP fee on graduated pools
    int24 public constant TICK_SPACING = 200;
    uint256 public constant MAX_CREATION_FEE = 0.05 ether;

    uint8 internal constant OP_SEED = 1;
    uint8 internal constant OP_SWAP = 2;
    uint8 internal constant OP_COLLECT = 3;

    struct Coin {
        address creator;
        uint64 createdAt;
        bool graduated;
        uint256 virtualEth;
        uint256 virtualToken;
        uint256 curveSupply;
        uint256 ethReserve;
        uint256 tokensSold;
    }

    struct Pool {
        PoolKey key;
        uint128 liquidity;
        uint64 graduatedAt;
    }

    IPoolManager public immutable poolManager;
    ICoinDeployer public coinDeployer;
    IHooks public graduationHook;
    address public treasury;
    address public brainFund; // receives the brain share; pays for the agents' inference
    address public buyback; // BuybackBurn; until it is set the burn share waits here
    IAgentRegistry public agentRegistry; // the AgentFactory; when set, only its vaults trade coins on the curve

    uint256 public virtualEth;
    uint256 public virtualToken;
    uint256 public curveSupply;
    uint256 public creationFee;

    mapping(address => Coin) public coins;
    mapping(address => Pool) internal _pools;
    address[] public allCoins;

    mapping(address => uint256) public creatorEthOwed;
    uint256 public protocolEthOwed;
    uint256 public brainEthOwed;
    uint256 public burnEthOwed;
    uint256 public totalCurveEth;
    uint256 public totalCreatorOwed;

    event CoinCreated(
        address indexed coin,
        address indexed creator,
        string name,
        string symbol,
        string uri,
        uint256 virtualEth,
        uint256 virtualToken,
        uint256 curveSupply
    );
    event Trade(
        address indexed coin,
        address indexed trader,
        address indexed recipient,
        bool isBuy,
        uint256 ethAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint256 ethReserve,
        uint256 tokensSold,
        bool viaPool
    );
    event Graduated(
        address indexed coin, bytes32 indexed poolId, uint256 ethLiquidity, uint256 tokenLiquidity, uint256 burned
    );
    event FeesCollected(address indexed coin, uint256 ethFees, uint256 tokenFeesBurned);
    event CreatorClaimed(address indexed creator, uint256 amount);
    event ProtocolClaimed(address indexed treasury, uint256 amount);
    event CurveSet(uint256 virtualEth, uint256 virtualToken, uint256 curveSupply);
    event CreationFeeSet(uint256 fee);
    event TreasurySet(address treasury);
    event BrainFundSet(address brainFund);
    event BuybackSet(address buyback);
    event FeesRouted(uint256 toTreasury, uint256 toBrainFund, uint256 toBuyback);

    error UnknownCoin();
    error Slippage();
    error BadCurve();
    error ZeroAmount();
    error NotPoolManager();
    error AlreadySet();
    error NotConfigured();
    error FeeTooHigh();
    error EthTransferFailed();
    error Insolvent();
    error AgentsOnly();
    error ZeroAddress();

    constructor(
        address owner_,
        IPoolManager poolManager_,
        address treasury_,
        uint256 virtualEth_,
        uint256 virtualToken_,
        uint256 curveSupply_
    ) Ownable(owner_) {
        poolManager = poolManager_;
        treasury = treasury_;
        _setCurve(virtualEth_, virtualToken_, curveSupply_);
    }

    receive() external payable {}

    // ───────────────────────────── owner ─────────────────────────────

    function setCoinDeployer(ICoinDeployer d) external onlyOwner {
        if (address(coinDeployer) != address(0)) revert AlreadySet();
        coinDeployer = d;
    }

    function setGraduationHook(IHooks h) external onlyOwner {
        if (address(graduationHook) != address(0)) revert AlreadySet();
        graduationHook = h;
    }

    function setAgentRegistry(IAgentRegistry r) external onlyOwner {
        if (address(agentRegistry) != address(0)) revert AlreadySet();
        agentRegistry = r;
    }

    function setBrainFund(address b) external onlyOwner {
        if (b == address(0)) revert ZeroAddress();
        brainFund = b;
        emit BrainFundSet(b);
    }

    function setBuyback(address b) external onlyOwner {
        buyback = b;
        emit BuybackSet(b);
    }

    function setCurve(uint256 ve, uint256 vt, uint256 cs) external onlyOwner {
        _setCurve(ve, vt, cs);
    }

    function setCreationFee(uint256 fee) external onlyOwner {
        if (fee > MAX_CREATION_FEE) revert FeeTooHigh();
        creationFee = fee;
        emit CreationFeeSet(fee);
    }

    function setTreasury(address t) external onlyOwner {
        if (t == address(0)) revert ZeroAddress();
        treasury = t;
        emit TreasurySet(t);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Only ETH above every liability (curve reserves + owed fees) can be rescued.
    function rescueETH(address to, uint256 amount) external onlyOwner {
        if (address(this).balance < totalCurveEth + totalCreatorOwed + protocolEthOwed + brainEthOwed + burnEthOwed + amount) {
            revert Insolvent();
        }
        _sendEth(to, amount);
    }

    /// @notice A launched coin can only be rescued down to its unsold curve supply.
    function rescueERC20(IERC20 token, address to, uint256 amount) external onlyOwner {
        Coin storage c = coins[address(token)];
        if (c.creator != address(0) && !c.graduated) {
            uint256 locked = SUPPLY - c.tokensSold;
            if (token.balanceOf(address(this)) < locked + amount) revert Insolvent();
        }
        token.safeTransfer(to, amount);
    }

    function _setCurve(uint256 ve, uint256 vt, uint256 cs) internal {
        if (ve == 0 || cs == 0 || cs >= SUPPLY || vt <= cs || vt > SUPPLY * 2) revert BadCurve();
        virtualEth = ve;
        virtualToken = vt;
        curveSupply = cs;
        emit CurveSet(ve, vt, cs);
    }

    // ───────────────────────────── create ─────────────────────────────

    /// @notice Launch a coin. `msg.value` pays `creationFee`; the rest is the creator's first buy.
    function create(string calldata name_, string calldata symbol_, string calldata uri, uint256 minTokensOut)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (address coin, uint256 tokensOut)
    {
        if (address(coinDeployer) == address(0) || address(graduationHook) == address(0)) revert NotConfigured();
        if (msg.value < creationFee) revert ZeroAmount();
        _agentsOnly(false, msg.sender);
        coin = coinDeployer.deploy(name_, symbol_, SUPPLY);
        coins[coin] = Coin({
            creator: msg.sender,
            createdAt: uint64(block.timestamp),
            graduated: false,
            virtualEth: virtualEth,
            virtualToken: virtualToken,
            curveSupply: curveSupply,
            ethReserve: 0,
            tokensSold: 0
        });
        allCoins.push(coin);
        protocolEthOwed += creationFee;
        emit CoinCreated(coin, msg.sender, name_, symbol_, uri, virtualEth, virtualToken, curveSupply);
        uint256 rest = msg.value - creationFee;
        if (rest > 0) tokensOut = _curveBuy(coin, rest, minTokensOut, msg.sender);
    }

    // ───────────────────────────── trade ─────────────────────────────

    /// @notice Buy `coin` with `msg.value` ETH. Curve while bonding, Uniswap v4 pool after graduation.
    function buy(address coin, uint256 minTokensOut, address recipient)
        external
        payable
        nonReentrant
        whenNotPaused
        returns (uint256 tokensOut)
    {
        Coin storage c = coins[coin];
        if (c.creator == address(0)) revert UnknownCoin();
        if (msg.value == 0) revert ZeroAmount();
        _agentsOnly(c.graduated, recipient);
        if (c.graduated) {
            tokensOut = _poolSwap(coin, true, msg.value, minTokensOut, recipient);
        } else {
            tokensOut = _curveBuy(coin, msg.value, minTokensOut, recipient);
        }
    }

    /// @notice Sell `tokensIn` of `coin` (pulled from msg.sender, approve first) for ETH sent to `recipient`.
    function sell(address coin, uint256 tokensIn, uint256 minEthOut, address payable recipient)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 ethOut)
    {
        Coin storage c = coins[coin];
        if (c.creator == address(0)) revert UnknownCoin();
        if (tokensIn == 0) revert ZeroAmount();
        _agentsOnly(c.graduated, recipient);
        IERC20(coin).safeTransferFrom(msg.sender, address(this), tokensIn);
        if (c.graduated) {
            ethOut = _poolSwap(coin, false, tokensIn, minEthOut, recipient);
        } else {
            ethOut = _curveSell(coin, tokensIn, minEthOut, recipient);
        }
    }

    /// @dev On the curve only agent vaults trade, and only for themselves.
    function _agentsOnly(bool graduated, address recipient) internal view {
        if (graduated) return;
        if (address(agentRegistry) == address(0)) revert NotConfigured(); // closed until the factory is wired
        if (recipient != msg.sender || agentRegistry.agentIdOf(msg.sender) == 0) revert AgentsOnly();
    }

    function _curveBuy(address coin, uint256 value, uint256 minOut, address recipient) internal returns (uint256 out) {
        Coin storage c = coins[coin];
        uint256 fee = value * FEE_BPS / BPS;
        uint256 net = value - fee;
        uint256 k = c.virtualEth * c.virtualToken;
        uint256 x = c.virtualEth + c.ethReserve;
        uint256 y = c.virtualToken - c.tokensSold;
        uint256 remaining = c.curveSupply - c.tokensSold;
        out = y - Math.ceilDiv(k, x + net);
        uint256 refund;
        if (out >= remaining) {
            // last buy: sell exactly the remaining curve supply and refund the rest
            out = remaining;
            net = Math.ceilDiv(k, y - remaining) - x;
            fee = Math.ceilDiv(net * FEE_BPS, BPS - FEE_BPS);
            if (net + fee > value) fee = value - net; // 1-wei rounding edge
            refund = value - net - fee;
        }
        if (out == 0 || out < minOut) revert Slippage();
        c.ethReserve += net;
        c.tokensSold += out;
        totalCurveEth += net;
        _accrueFee(c.creator, fee);
        IERC20(coin).safeTransfer(recipient, out);
        emit Trade(coin, msg.sender, recipient, true, net + fee, out, fee, c.ethReserve, c.tokensSold, false);
        if (c.tokensSold == c.curveSupply) _graduate(coin);
        if (refund > 0) _sendEth(msg.sender, refund);
    }

    function _curveSell(address coin, uint256 tokensIn, uint256 minOut, address recipient)
        internal
        returns (uint256 out)
    {
        Coin storage c = coins[coin];
        if (tokensIn > c.tokensSold) revert Slippage();
        uint256 k = c.virtualEth * c.virtualToken;
        uint256 x = c.virtualEth + c.ethReserve;
        uint256 y = c.virtualToken - c.tokensSold;
        uint256 gross = x - Math.ceilDiv(k, y + tokensIn);
        if (gross > c.ethReserve) gross = c.ethReserve;
        uint256 fee = gross * FEE_BPS / BPS;
        out = gross - fee;
        if (out == 0 || out < minOut) revert Slippage();
        c.ethReserve -= gross;
        c.tokensSold -= tokensIn;
        totalCurveEth -= gross;
        _accrueFee(c.creator, fee);
        emit Trade(coin, msg.sender, recipient, false, gross, tokensIn, fee, c.ethReserve, c.tokensSold, false);
        _sendEth(recipient, out);
    }

    function _accrueFee(address creator, uint256 fee) internal {
        uint256 toCreator = fee * CREATOR_SHARE_BPS / BPS;
        uint256 toBrain = fee * BRAIN_SHARE_BPS / BPS;
        creatorEthOwed[creator] += toCreator;
        totalCreatorOwed += toCreator;
        brainEthOwed += toBrain;
        burnEthOwed += fee - toCreator - toBrain;
    }

    // ───────────────────────────── graduation ─────────────────────────────

    function _graduate(address coin) internal {
        Coin storage c = coins[coin];
        c.graduated = true;
        IUnlockable(coin).unlock();
        uint256 ethAmt = c.ethReserve;
        uint256 x = c.virtualEth + ethAmt;
        uint256 y = c.virtualToken - c.tokensSold;
        uint256 unsold = SUPPLY - c.tokensSold;
        uint256 tokenAmt = FullMath.mulDiv(ethAmt, y, x); // pool opens at the curve's spot price
        if (tokenAmt > unsold) tokenAmt = unsold;
        totalCurveEth -= ethAmt;
        c.ethReserve = 0;

        Pool storage p = _pools[coin];
        p.key = PoolKey(Currency.wrap(address(0)), Currency.wrap(coin), POOL_FEE, TICK_SPACING, graduationHook);
        p.graduatedAt = uint64(block.timestamp);
        // price = currency1 per currency0 = coins per ETH
        uint160 sqrtP = sqrtPriceX96(ethAmt, tokenAmt);
        p.liquidity = LiquidityAmountsLib.forAmounts(
            sqrtP,
            TickMath.getSqrtPriceAtTick(TickAlign.minUsable(TICK_SPACING)),
            TickMath.getSqrtPriceAtTick(TickAlign.maxUsable(TICK_SPACING)),
            ethAmt,
            tokenAmt
        );
        poolManager.initialize(p.key, sqrtP);
        (uint256 usedEth, uint256 usedTokens) = abi.decode(poolManager.unlock(abi.encode(OP_SEED, coin)), (uint256, uint256));
        if (ethAmt > usedEth) protocolEthOwed += ethAmt - usedEth; // rounding dust
        uint256 burned = unsold > usedTokens ? unsold - usedTokens : 0;
        if (burned > 0) IBurnable(coin).burn(burned);
        emit Graduated(coin, PoolId.unwrap(p.key.toId()), usedEth, usedTokens, burned);
    }

    /// @notice Collect the graduated pool's LP fees: ETH split creator/protocol, coin side burned. Anyone may call.
    function collectFees(address coin) external nonReentrant returns (uint256 ethFees, uint256 tokenFees) {
        if (!coins[coin].graduated) revert UnknownCoin();
        (ethFees, tokenFees) = abi.decode(poolManager.unlock(abi.encode(OP_COLLECT, coin)), (uint256, uint256));
        if (ethFees > 0) _accrueFee(coins[coin].creator, ethFees);
        if (tokenFees > 0) IBurnable(coin).burn(tokenFees);
        emit FeesCollected(coin, ethFees, tokenFees);
    }

    // ───────────────────────────── pool ─────────────────────────────

    function _poolSwap(address coin, bool isBuy, uint256 amountIn, uint256 minOut, address recipient)
        internal
        returns (uint256 out)
    {
        (uint256 spent, uint256 got) =
            abi.decode(poolManager.unlock(abi.encode(OP_SWAP, coin, isBuy, amountIn, recipient)), (uint256, uint256));
        out = got;
        if (out < minOut) revert Slippage();
        if (amountIn > spent) {
            if (isBuy) _sendEth(msg.sender, amountIn - spent);
            else IERC20(coin).safeTransfer(msg.sender, amountIn - spent);
        }
        emit Trade(coin, msg.sender, recipient, isBuy, isBuy ? spent : got, isBuy ? got : spent, 0, 0, 0, true);
    }

    function unlockCallback(bytes calldata data) external returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotPoolManager();
        uint8 op = abi.decode(data, (uint8));
        if (op == OP_SEED) {
            (, address coin) = abi.decode(data, (uint8, address));
            return _seed(coin);
        } else if (op == OP_COLLECT) {
            (, address coin) = abi.decode(data, (uint8, address));
            return _collect(coin);
        } else {
            (, address coin, bool isBuy, uint256 amountIn, address recipient) =
                abi.decode(data, (uint8, address, bool, uint256, address));
            return _swap(coin, isBuy, amountIn, recipient);
        }
    }

    function _seed(address coin) internal returns (bytes memory) {
        Pool storage p = _pools[coin];
        (BalanceDelta d,) = poolManager.modifyLiquidity(
            p.key,
            ModifyLiquidityParams(
                TickAlign.minUsable(TICK_SPACING), TickAlign.maxUsable(TICK_SPACING), int256(uint256(p.liquidity)), 0
            ),
            ""
        );
        uint256 owe0 = d.amount0() < 0 ? uint256(uint128(-d.amount0())) : 0;
        uint256 owe1 = d.amount1() < 0 ? uint256(uint128(-d.amount1())) : 0;
        _settle(p.key.currency0, owe0);
        _settle(p.key.currency1, owe1);
        return abi.encode(owe0, owe1);
    }

    function _collect(address coin) internal returns (bytes memory) {
        Pool storage p = _pools[coin];
        (BalanceDelta f,) = poolManager.modifyLiquidity(
            p.key, ModifyLiquidityParams(TickAlign.minUsable(TICK_SPACING), TickAlign.maxUsable(TICK_SPACING), 0, 0), ""
        );
        uint256 f0 = f.amount0() > 0 ? uint256(uint128(f.amount0())) : 0;
        uint256 f1 = f.amount1() > 0 ? uint256(uint128(f.amount1())) : 0;
        if (f0 > 0) poolManager.take(p.key.currency0, address(this), f0);
        if (f1 > 0) poolManager.take(p.key.currency1, address(this), f1);
        return abi.encode(f0, f1);
    }

    function _swap(address coin, bool isBuy, uint256 amountIn, address recipient) internal returns (bytes memory) {
        Pool storage p = _pools[coin];
        // currency0 = ETH, currency1 = coin. Buy = ETH -> coin = zeroForOne.
        BalanceDelta d = poolManager.swap(
            p.key,
            SwapParams({
                zeroForOne: isBuy,
                amountSpecified: -int256(amountIn),
                sqrtPriceLimitX96: isBuy ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
            }),
            ""
        );
        int128 a0 = d.amount0();
        int128 a1 = d.amount1();
        uint256 spent;
        uint256 got;
        if (isBuy) {
            spent = uint256(uint128(-a0));
            got = uint256(uint128(a1));
            _settle(p.key.currency0, spent);
            poolManager.take(p.key.currency1, recipient, got);
        } else {
            spent = uint256(uint128(-a1));
            got = uint256(uint128(a0));
            _settle(p.key.currency1, spent);
            poolManager.take(p.key.currency0, recipient, got);
        }
        return abi.encode(spent, got);
    }

    function _settle(Currency cur, uint256 amount) internal {
        if (amount == 0) return;
        if (cur.isAddressZero()) {
            poolManager.settle{value: amount}();
        } else {
            poolManager.sync(cur);
            IERC20(Currency.unwrap(cur)).safeTransfer(address(poolManager), amount);
            poolManager.settle();
        }
    }

    // ───────────────────────────── claims ─────────────────────────────

    /// @notice Creators (agent vaults) pull their share of trading fees.
    function claimCreatorFees() external nonReentrant returns (uint256 amount) {
        amount = creatorEthOwed[msg.sender];
        if (amount == 0) return 0;
        creatorEthOwed[msg.sender] = 0;
        totalCreatorOwed -= amount;
        _sendEth(msg.sender, amount);
        emit CreatorClaimed(msg.sender, amount);
    }

    /// @notice Routes the protocol's shares: creation fees to the treasury, the brain share to the brain fund
    ///         (the treasury until one is set) and the burn share to BuybackBurn (held here until it is set).
    ///         Anyone may call.
    function claimProtocolFees() external nonReentrant returns (uint256 amount) {
        amount = protocolEthOwed;
        protocolEthOwed = 0;
        uint256 brain = brainEthOwed;
        brainEthOwed = 0;
        uint256 burn;
        if (buyback != address(0)) {
            burn = burnEthOwed;
            burnEthOwed = 0;
        }
        _sendEth(treasury, amount);
        _sendEth(brainFund != address(0) ? brainFund : treasury, brain);
        _sendEth(buyback, burn);
        emit ProtocolClaimed(treasury, amount);
        emit FeesRouted(amount, brain, burn);
    }

    function _sendEth(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert EthTransferFailed();
    }

    // ───────────────────────────── views ─────────────────────────────

    function isCoin(address coin) external view returns (bool) {
        return coins[coin].creator != address(0);
    }

    function coinCount() external view returns (uint256) {
        return allCoins.length;
    }

    function poolKey(address coin) external view returns (PoolKey memory) {
        return _pools[coin].key;
    }

    function poolId(address coin) external view returns (bytes32) {
        return PoolId.unwrap(_pools[coin].key.toId());
    }

    /// @notice Spot price in ETH wei per 1e18 coin wei.
    function price(address coin) public view returns (uint256) {
        Coin storage c = coins[coin];
        if (c.creator == address(0)) return 0;
        if (!c.graduated) {
            return FullMath.mulDiv(c.virtualEth + c.ethReserve, 1e18, c.virtualToken - c.tokensSold);
        }
        (uint160 sqrtP,,,) = poolManager.getSlot0(_pools[coin].key.toId());
        uint256 priceX96 = FullMath.mulDiv(sqrtP, sqrtP, FixedPoint96.Q96); // coins per ETH, Q96
        return FullMath.mulDiv(FixedPoint96.Q96, 1e18, priceX96);
    }

    /// @notice Fully diluted market cap in ETH wei.
    function marketCap(address coin) external view returns (uint256) {
        return FullMath.mulDiv(price(coin), IERC20(coin).totalSupply(), 1e18);
    }

    /// @notice Curve progress in basis points (10,000 = graduated).
    function progressBps(address coin) external view returns (uint256) {
        Coin storage c = coins[coin];
        if (c.graduated) return BPS;
        if (c.curveSupply == 0) return 0;
        return c.tokensSold * BPS / c.curveSupply;
    }

    /// @notice Curve quote: tokens out for `ethIn` (fee included). Zero for graduated coins.
    function quoteBuy(address coin, uint256 ethIn) external view returns (uint256 out) {
        Coin storage c = coins[coin];
        if (c.creator == address(0) || c.graduated) return 0;
        uint256 net = ethIn - ethIn * FEE_BPS / BPS;
        uint256 k = c.virtualEth * c.virtualToken;
        uint256 y = c.virtualToken - c.tokensSold;
        out = y - Math.ceilDiv(k, c.virtualEth + c.ethReserve + net);
        uint256 remaining = c.curveSupply - c.tokensSold;
        if (out > remaining) out = remaining;
    }

    /// @notice Curve quote: ETH out for `tokensIn` (fee included). Zero for graduated coins.
    function quoteSell(address coin, uint256 tokensIn) external view returns (uint256 out) {
        Coin storage c = coins[coin];
        if (c.creator == address(0) || c.graduated || tokensIn > c.tokensSold) return 0;
        uint256 k = c.virtualEth * c.virtualToken;
        uint256 gross = c.virtualEth + c.ethReserve - Math.ceilDiv(k, c.virtualToken - c.tokensSold + tokensIn);
        if (gross > c.ethReserve) gross = c.ethReserve;
        out = gross - gross * FEE_BPS / BPS;
    }

    /// @dev sqrt(amount1 / amount0) in Q64.96, clamped to the pool manager's bounds.
    function sqrtPriceX96(uint256 amount0, uint256 amount1) public pure returns (uint160) {
        uint256 ratioX192 = FullMath.mulDiv(amount1, uint256(1) << 192, amount0);
        uint256 s = Math.sqrt(ratioX192);
        if (s < TickMath.MIN_SQRT_PRICE + 1) s = TickMath.MIN_SQRT_PRICE + 1;
        if (s > TickMath.MAX_SQRT_PRICE - 1) s = TickMath.MAX_SQRT_PRICE - 1;
        return uint160(s);
    }
}
