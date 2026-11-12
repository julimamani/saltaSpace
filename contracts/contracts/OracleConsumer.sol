// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title OracleConsumer
/// @notice Stores the latest crop-health metrics per lot, pushed by the off-chain oracle
///         (FastAPI backend) holding ORACLE_ROLE. Full history lives in MetricsUpdated events.
contract OracleConsumer is AccessControl {
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    int16 public constant NDVI_SCALE = 10_000; // NDVI x 10_000, range [-10000, 10000]
    uint16 public constant MIN_YIELD_INDEX_BPS = 5_000; // 0.5
    uint16 public constant MAX_YIELD_INDEX_BPS = 13_000; // 1.3
    uint64 public constant MAX_FUTURE_DRIFT = 15 minutes;

    struct Metrics {
        int16 ndvi; // Sentinel-2 NDVI x 10_000
        int16 ndwi; // Sentinel-2 NDWI (NIR-SWIR, leaf water) x 10_000
        uint8 riskScore; // 0-100
        uint16 yieldIndexBps; // 5000-13000
        int32 waterBalanceMm; // season rain - ETc (FAO-56 Penman-Monteith x Kc), mm
        uint16 criticalDryDays; // flowering days with soil water under the stress threshold
        uint16 rainVsNormalBps; // season rain / 2001-2025 NASA POWER normal, 10_000 = 100%
        uint16 ndviDropBps; // NDVI fall from the season peak, 10_000 = 100%
        uint16 soilDryDays; // consecutive days Sentinel-1 backscatter flags dry soil
        uint64 timestamp; // observation time (unix seconds)
        bytes32 dataHash; // hash of the off-chain payload (scene ids, weather, formula version)
    }

    mapping(uint256 => Metrics) private _latest;
    mapping(uint256 => uint256) public updateCount;

    error InvalidNdvi(int16 ndvi);
    error InvalidNdwi(int16 ndwi);
    error InvalidNdviDrop(uint16 ndviDropBps);
    error InvalidRiskScore(uint8 riskScore);
    error InvalidYieldIndex(uint16 yieldIndexBps);
    error StaleTimestamp(uint64 timestamp, uint64 latest);
    error FutureTimestamp(uint64 timestamp);

    event MetricsUpdated(uint256 indexed lotId, Metrics metrics, address indexed oracle);

    constructor(address admin, address oracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (oracle != address(0)) _grantRole(ORACLE_ROLE, oracle);
    }

    function updateLotMetrics(uint256 lotId, Metrics calldata m) external onlyRole(ORACLE_ROLE) {
        if (m.ndvi < -NDVI_SCALE || m.ndvi > NDVI_SCALE) revert InvalidNdvi(m.ndvi);
        if (m.ndwi < -NDVI_SCALE || m.ndwi > NDVI_SCALE) revert InvalidNdwi(m.ndwi);
        if (m.riskScore > 100) revert InvalidRiskScore(m.riskScore);
        if (m.ndviDropBps > 10_000) revert InvalidNdviDrop(m.ndviDropBps);
        if (m.yieldIndexBps < MIN_YIELD_INDEX_BPS || m.yieldIndexBps > MAX_YIELD_INDEX_BPS) {
            revert InvalidYieldIndex(m.yieldIndexBps);
        }
        uint64 last = _latest[lotId].timestamp;
        // Strictly increasing, so a replayed or out-of-order push cannot overwrite newer data.
        if (m.timestamp <= last) revert StaleTimestamp(m.timestamp, last);
        if (m.timestamp > block.timestamp + MAX_FUTURE_DRIFT) revert FutureTimestamp(m.timestamp);

        _latest[lotId] = m;
        unchecked {
            updateCount[lotId]++;
        }
        emit MetricsUpdated(lotId, m, msg.sender);
    }

    function latestMetrics(uint256 lotId) external view returns (Metrics memory) {
        return _latest[lotId];
    }

    function hasMetrics(uint256 lotId) external view returns (bool) {
        return _latest[lotId].timestamp != 0;
    }
}
