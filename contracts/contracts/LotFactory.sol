// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {LotToken} from "./LotToken.sol";

/// @title LotFactory
/// @notice Registry of agricultural lots / funding campaigns. Each lot gets its own LotToken
///         (ERC20 clone) whose only minter is the CampaignVault.
contract LotFactory is Ownable, Pausable {
    /// @notice Minimum price per share, so the minimum ticket is 10 USDC.
    uint256 public constant MIN_PRICE_PER_TOKEN = 10 * 1e6;
    uint16 public constant MAX_APY_BPS = 10_000;

    struct Lot {
        address producer;
        address token;
        string name;
        string crop;
        uint32 hectaresX100; // hectares with 2 decimals (1250 = 12.50 ha)
        string geoJson; // lot polygon (GeoJSON geometry)
        bytes32 geoHash; // keccak256(geoJson), anchors the polygon used by the oracle
        uint256 fundingGoal; // USDC (6 decimals)
        uint256 pricePerToken; // USDC (6 decimals) per share
        uint64 fundingDeadline; // campaign close
        uint64 maturity; // expected harvest / settlement date
        uint16 targetApyBps; // base expected return, e.g. 1800 = 18%
    }

    /// @dev Gas-light subset of Lot used by the vault on every invest/claim.
    struct LotTerms {
        address producer;
        address token;
        uint256 fundingGoal;
        uint256 pricePerToken;
        uint64 fundingDeadline;
        uint64 maturity;
        uint16 targetApyBps;
    }

    struct CreateLotParams {
        string name;
        string symbol;
        string crop;
        uint32 hectaresX100;
        string geoJson;
        uint256 fundingGoal;
        uint256 pricePerToken;
        uint64 fundingDeadline;
        uint64 maturity;
        uint16 targetApyBps;
    }

    address public immutable tokenImplementation;
    /// @notice Shared KYC registry enforced by every cloned LotToken.
    address public immutable investorRegistry;
    address public vault;
    Lot[] private _lots;

    error VaultAlreadySet();
    error VaultNotSet();
    error ZeroAddress();
    error InvalidParams(string reason);
    error LotNotFound(uint256 lotId);

    event VaultSet(address indexed vault);
    event LotCreated(
        uint256 indexed lotId,
        address indexed producer,
        address token,
        string name,
        string crop,
        uint256 fundingGoal,
        uint256 pricePerToken,
        uint64 fundingDeadline,
        bytes32 geoHash
    );

    constructor(address initialOwner, address investorRegistry_) Ownable(initialOwner) {
        if (investorRegistry_ == address(0)) revert ZeroAddress();
        investorRegistry = investorRegistry_;
        tokenImplementation = address(new LotToken());
    }

    /// @notice One-time wiring of the vault (the vault needs the factory address at deploy).
    function setVault(address vault_) external onlyOwner {
        if (vault != address(0)) revert VaultAlreadySet();
        if (vault_ == address(0)) revert ZeroAddress();
        vault = vault_;
        emit VaultSet(vault_);
    }

    function createLot(CreateLotParams calldata p) external whenNotPaused returns (uint256 lotId) {
        if (vault == address(0)) revert VaultNotSet();
        if (bytes(p.name).length == 0 || bytes(p.symbol).length == 0) revert InvalidParams("name");
        if (bytes(p.geoJson).length == 0) revert InvalidParams("geoJson");
        if (p.hectaresX100 == 0) revert InvalidParams("hectares");
        if (p.pricePerToken < MIN_PRICE_PER_TOKEN) revert InvalidParams("price");
        if (p.fundingGoal == 0 || p.fundingGoal % p.pricePerToken != 0) revert InvalidParams("goal");
        if (p.fundingDeadline <= block.timestamp) revert InvalidParams("deadline");
        if (p.maturity <= p.fundingDeadline) revert InvalidParams("maturity");
        if (p.targetApyBps == 0 || p.targetApyBps > MAX_APY_BPS) revert InvalidParams("apy");

        lotId = _lots.length;
        address token = Clones.clone(tokenImplementation);
        LotToken(token).initialize(p.name, p.symbol, vault, lotId, investorRegistry);

        bytes32 geoHash = keccak256(bytes(p.geoJson));
        _lots.push(
            Lot({
                producer: msg.sender,
                token: token,
                name: p.name,
                crop: p.crop,
                hectaresX100: p.hectaresX100,
                geoJson: p.geoJson,
                geoHash: geoHash,
                fundingGoal: p.fundingGoal,
                pricePerToken: p.pricePerToken,
                fundingDeadline: p.fundingDeadline,
                maturity: p.maturity,
                targetApyBps: p.targetApyBps
            })
        );

        emit LotCreated(
            lotId,
            msg.sender,
            token,
            p.name,
            p.crop,
            p.fundingGoal,
            p.pricePerToken,
            p.fundingDeadline,
            geoHash
        );
    }

    function lotCount() external view returns (uint256) {
        return _lots.length;
    }

    function getLot(uint256 lotId) external view returns (Lot memory) {
        if (lotId >= _lots.length) revert LotNotFound(lotId);
        return _lots[lotId];
    }

    function getLotTerms(uint256 lotId) external view returns (LotTerms memory) {
        if (lotId >= _lots.length) revert LotNotFound(lotId);
        Lot storage l = _lots[lotId];
        return
            LotTerms({
                producer: l.producer,
                token: l.token,
                fundingGoal: l.fundingGoal,
                pricePerToken: l.pricePerToken,
                fundingDeadline: l.fundingDeadline,
                maturity: l.maturity,
                targetApyBps: l.targetApyBps
            });
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
