// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {LotFactory} from "./LotFactory.sol";
import {LotToken} from "./LotToken.sol";
import {OracleConsumer} from "./OracleConsumer.sol";

/// @title CampaignVault
/// @notice Custodies investor USDC for every lot and runs the campaign lifecycle:
///         Funding -> Funded (goal reached) -> Settled -> claims, or Funding -> Failed -> refunds.
///
/// Payout per share at settlement (all in basis points, 10_000 = 1.0):
///   yield      = oracle.yieldIndex                         (0.5 .. 1.3)
///   multiplier = 1 + targetApy * yield
///   if ndvi < criticalNdvi (drought): multiplier -= droughtHaircut
///   multiplier = clamp(multiplier, minPayout, maxPayout)
///   payoutPerToken = pricePerToken * multiplier
/// The producer funds the return through `depositRepayment`. If the repayment is short of
/// what is owed, investors are paid pro-rata from what is available.
contract CampaignVault is AccessControl, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @dev Can settle before maturity (needed to run the full lifecycle in a live demo).
    bytes32 public constant SETTLER_ROLE = keccak256("SETTLER_ROLE");
    uint256 public constant BPS = 10_000;

    enum Status {
        Funding,
        Funded,
        Failed,
        Settled
    }

    struct LotState {
        Status status;
        bool fundsReleased;
        uint256 tokensSold;
        uint256 raised; // USDC collected from investors
        uint256 repaid; // USDC deposited back by the producer
        uint256 payoutPerToken; // USDC per share, fixed at settlement
        uint16 settledMultiplierBps;
    }

    struct PayoutParams {
        int16 criticalNdvi; // NDVI x 10_000 under which the drought haircut applies
        uint16 droughtHaircutBps;
        uint16 minPayoutBps; // floor on the payout multiplier (capital protection cap)
        uint16 maxPayoutBps; // ceiling on the payout multiplier
    }

    IERC20 public immutable usdc;
    LotFactory public immutable factory;
    OracleConsumer public immutable oracle;

    PayoutParams public payoutParams;
    mapping(uint256 => LotState) private _states;

    error InvalidStatus(uint256 lotId, Status current);
    error ZeroAmount();
    error ZeroAddress();
    error FundingClosed(uint256 lotId);
    error ExceedsGoal(uint256 lotId, uint256 available);
    error DeadlineNotReached(uint256 lotId);
    error GoalReached(uint256 lotId);
    error AlreadyReleased(uint256 lotId);
    error NotMatured(uint256 lotId);
    error NoMetrics(uint256 lotId);
    error NothingToClaim(uint256 lotId);
    error InvalidPayoutParams();

    event Invested(uint256 indexed lotId, address indexed investor, uint256 tokens, uint256 cost);
    event GoalReachedEvent(uint256 indexed lotId, uint256 raised);
    event FundsReleased(uint256 indexed lotId, address indexed producer, uint256 amount);
    event CampaignFailed(uint256 indexed lotId, uint256 raised);
    event Refunded(uint256 indexed lotId, address indexed investor, uint256 tokens, uint256 amount);
    event RepaymentDeposited(uint256 indexed lotId, address indexed from, uint256 amount);
    event Settled(
        uint256 indexed lotId,
        int16 ndvi,
        uint16 yieldIndexBps,
        uint16 multiplierBps,
        uint256 payoutPerToken,
        uint256 totalOwed,
        uint256 available,
        bool drought
    );
    event SurplusReturned(uint256 indexed lotId, address indexed producer, uint256 amount);
    event Claimed(uint256 indexed lotId, address indexed investor, uint256 tokens, uint256 amount);
    event PayoutParamsUpdated(PayoutParams params);

    constructor(address admin, IERC20 usdc_, LotFactory factory_, OracleConsumer oracle_) {
        if (
            admin == address(0) ||
            address(usdc_) == address(0) ||
            address(factory_) == address(0) ||
            address(oracle_) == address(0)
        ) revert ZeroAddress();
        usdc = usdc_;
        factory = factory_;
        oracle = oracle_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(SETTLER_ROLE, admin);
        _setPayoutParams(
            PayoutParams({
                criticalNdvi: 3_000,
                droughtHaircutBps: 1_500,
                minPayoutBps: 8_000,
                maxPayoutBps: 13_000
            })
        );
    }

    // --------------------------------------------------------------------- investors

    /// @notice Buys `tokens` shares of a lot. Caller must approve `tokens * pricePerToken` USDC.
    function invest(uint256 lotId, uint256 tokens) external nonReentrant whenNotPaused {
        if (tokens == 0) revert ZeroAmount();
        LotFactory.LotTerms memory t = factory.getLotTerms(lotId);
        LotState storage s = _states[lotId];
        if (s.status != Status.Funding) revert InvalidStatus(lotId, s.status);
        if (block.timestamp > t.fundingDeadline) revert FundingClosed(lotId);

        uint256 maxTokens = t.fundingGoal / t.pricePerToken;
        uint256 available = maxTokens - s.tokensSold;
        if (tokens > available) revert ExceedsGoal(lotId, available);

        uint256 cost = tokens * t.pricePerToken;
        s.tokensSold += tokens;
        s.raised += cost;
        if (s.tokensSold == maxTokens) {
            s.status = Status.Funded;
            emit GoalReachedEvent(lotId, s.raised);
        }

        usdc.safeTransferFrom(msg.sender, address(this), cost);
        LotToken(t.token).mint(msg.sender, tokens);
        emit Invested(lotId, msg.sender, tokens, cost);
    }

    /// @notice Returns the caller's capital if the goal was not reached by the deadline.
    function refund(uint256 lotId) external nonReentrant whenNotPaused {
        LotFactory.LotTerms memory t = factory.getLotTerms(lotId);
        LotState storage s = _states[lotId];
        if (s.status == Status.Funding) {
            if (block.timestamp <= t.fundingDeadline) revert DeadlineNotReached(lotId);
            s.status = Status.Failed;
            emit CampaignFailed(lotId, s.raised);
        }
        if (s.status != Status.Failed) revert InvalidStatus(lotId, s.status);

        uint256 tokens = LotToken(t.token).balanceOf(msg.sender);
        if (tokens == 0) revert NothingToClaim(lotId);
        uint256 amount = tokens * t.pricePerToken;

        LotToken(t.token).burn(msg.sender, tokens);
        usdc.safeTransfer(msg.sender, amount);
        emit Refunded(lotId, msg.sender, tokens, amount);
    }

    /// @notice Burns the caller's shares and pays `payoutPerToken` for each one.
    function claim(uint256 lotId) external nonReentrant whenNotPaused {
        LotFactory.LotTerms memory t = factory.getLotTerms(lotId);
        LotState storage s = _states[lotId];
        if (s.status != Status.Settled) revert InvalidStatus(lotId, s.status);

        uint256 tokens = LotToken(t.token).balanceOf(msg.sender);
        if (tokens == 0) revert NothingToClaim(lotId);
        uint256 amount = tokens * s.payoutPerToken;

        LotToken(t.token).burn(msg.sender, tokens);
        usdc.safeTransfer(msg.sender, amount);
        emit Claimed(lotId, msg.sender, tokens, amount);
    }

    // --------------------------------------------------------------------- producer

    /// @notice Sends the raised capital to the producer once the goal is reached.
    function releaseFundsToProducer(uint256 lotId) external nonReentrant whenNotPaused {
        LotFactory.LotTerms memory t = factory.getLotTerms(lotId);
        LotState storage s = _states[lotId];
        if (s.status != Status.Funded) revert InvalidStatus(lotId, s.status);
        if (s.fundsReleased) revert AlreadyReleased(lotId);

        s.fundsReleased = true;
        usdc.safeTransfer(t.producer, s.raised);
        emit FundsReleased(lotId, t.producer, s.raised);
    }

    /// @notice Producer (or anyone) deposits USDC to cover capital + return before settlement.
    function depositRepayment(uint256 lotId, uint256 amount) external nonReentrant whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        factory.getLotTerms(lotId); // reverts if the lot does not exist
        LotState storage s = _states[lotId];
        if (s.status != Status.Funded) revert InvalidStatus(lotId, s.status);

        s.repaid += amount;
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit RepaymentDeposited(lotId, msg.sender, amount);
    }

    // --------------------------------------------------------------------- settlement

    /// @notice Fixes the payout per share using the latest oracle metrics. Anyone can settle
    ///         after maturity; SETTLER_ROLE can settle earlier (demo).
    function settle(uint256 lotId) external nonReentrant whenNotPaused {
        LotFactory.LotTerms memory t = factory.getLotTerms(lotId);
        LotState storage s = _states[lotId];
        if (s.status != Status.Funded) revert InvalidStatus(lotId, s.status);
        if (block.timestamp < t.maturity && !hasRole(SETTLER_ROLE, msg.sender)) {
            revert NotMatured(lotId);
        }
        if (!oracle.hasMetrics(lotId)) revert NoMetrics(lotId);

        OracleConsumer.Metrics memory m = oracle.latestMetrics(lotId);
        (uint16 multiplierBps, bool drought) = _payoutMultiplier(
            t.targetApyBps,
            m.yieldIndexBps,
            m.ndvi
        );

        // If funds were never released, the raised capital is still here and backs the payout.
        uint256 available = s.repaid + (s.fundsReleased ? 0 : s.raised);
        s.fundsReleased = true;

        uint256 fullPayoutPerToken = (t.pricePerToken * multiplierBps) / BPS;
        uint256 totalOwed = fullPayoutPerToken * s.tokensSold;
        uint256 payoutPerToken = available >= totalOwed
            ? fullPayoutPerToken
            : available / s.tokensSold;

        s.payoutPerToken = payoutPerToken;
        s.settledMultiplierBps = multiplierBps;
        s.status = Status.Settled;
        emit Settled(lotId, m.ndvi, m.yieldIndexBps, multiplierBps, payoutPerToken, totalOwed, available, drought);

        uint256 surplus = available - payoutPerToken * s.tokensSold;
        if (surplus > 0) {
            usdc.safeTransfer(t.producer, surplus);
            emit SurplusReturned(lotId, t.producer, surplus);
        }
    }

    // --------------------------------------------------------------------- views

    function getLotState(uint256 lotId) external view returns (LotState memory) {
        return _states[lotId];
    }

    /// @notice Estimated payout multiplier with the current oracle metrics (for the UI).
    /// @return multiplierBps 0 when there are no metrics yet.
    function previewPayout(
        uint256 lotId
    ) external view returns (uint16 multiplierBps, uint256 payoutPerToken, bool drought) {
        LotFactory.LotTerms memory t = factory.getLotTerms(lotId);
        LotState storage s = _states[lotId];
        if (s.status == Status.Settled) {
            return (s.settledMultiplierBps, s.payoutPerToken, false);
        }
        if (!oracle.hasMetrics(lotId)) return (0, 0, false);
        OracleConsumer.Metrics memory m = oracle.latestMetrics(lotId);
        (multiplierBps, drought) = _payoutMultiplier(t.targetApyBps, m.yieldIndexBps, m.ndvi);
        payoutPerToken = (t.pricePerToken * multiplierBps) / BPS;
    }

    /// @notice Amount the producer must deposit for investors to receive the full payout.
    function requiredRepayment(uint256 lotId) external view returns (uint256) {
        LotFactory.LotTerms memory t = factory.getLotTerms(lotId);
        LotState storage s = _states[lotId];
        if (!oracle.hasMetrics(lotId) || s.status != Status.Funded) return 0;
        OracleConsumer.Metrics memory m = oracle.latestMetrics(lotId);
        (uint16 multiplierBps, ) = _payoutMultiplier(t.targetApyBps, m.yieldIndexBps, m.ndvi);
        uint256 owed = ((t.pricePerToken * multiplierBps) / BPS) * s.tokensSold;
        uint256 have = s.repaid + (s.fundsReleased ? 0 : s.raised);
        return owed > have ? owed - have : 0;
    }

    function _payoutMultiplier(
        uint16 targetApyBps,
        uint16 yieldIndexBps,
        int16 ndvi
    ) internal view returns (uint16, bool) {
        PayoutParams memory p = payoutParams;
        int256 mult = int256(BPS) + int256((uint256(targetApyBps) * yieldIndexBps) / BPS);
        bool drought = ndvi < p.criticalNdvi;
        if (drought) mult -= int256(uint256(p.droughtHaircutBps));
        if (mult < int256(uint256(p.minPayoutBps))) mult = int256(uint256(p.minPayoutBps));
        if (mult > int256(uint256(p.maxPayoutBps))) mult = int256(uint256(p.maxPayoutBps));
        return (uint16(uint256(mult)), drought);
    }

    // --------------------------------------------------------------------- admin

    function setPayoutParams(PayoutParams calldata p) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setPayoutParams(p);
    }

    function _setPayoutParams(PayoutParams memory p) internal {
        if (p.minPayoutBps > p.maxPayoutBps || p.maxPayoutBps > 2 * BPS || p.droughtHaircutBps > BPS) {
            revert InvalidPayoutParams();
        }
        payoutParams = p;
        emit PayoutParamsUpdated(p);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
