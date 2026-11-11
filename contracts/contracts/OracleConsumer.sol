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
        int16 ndvi;
        uint8 riskScore; // 0-100
        uint16 yieldIndexBps; // 5000-13000
        uint64 timestamp; // observation time (unix seconds)
        bytes32 dataHash; // hash of the off-chain payload (scene id, weather, formula version)
    }

    mapping(uint256 => Metrics) private _latest;
    mapping(uint256 => uint256) public updateCount;

    error InvalidNdvi(int16 ndvi);
    error InvalidRiskScore(uint8 riskScore);
    error InvalidYieldIndex(uint16 yieldIndexBps);
    error StaleTimestamp(uint64 timestamp, uint64 latest);
    error FutureTimestamp(uint64 timestamp);

    event MetricsUpdated(
        uint256 indexed lotId,
        int16 ndvi,
        uint8 riskScore,
        uint16 yieldIndexBps,
        uint64 timestamp,
        bytes32 dataHash,
        address indexed oracle
    );

    constructor(address admin, address oracle) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (oracle != address(0)) _grantRole(ORACLE_ROLE, oracle);
    }

    function updateLotMetrics(
        uint256 lotId,
        int16 ndvi,
        uint8 riskScore,
        uint16 yieldIndexBps,
        uint64 timestamp,
        bytes32 dataHash
    ) external onlyRole(ORACLE_ROLE) {
        if (ndvi < -NDVI_SCALE || ndvi > NDVI_SCALE) revert InvalidNdvi(ndvi);
        if (riskScore > 100) revert InvalidRiskScore(riskScore);
        if (yieldIndexBps < MIN_YIELD_INDEX_BPS || yieldIndexBps > MAX_YIELD_INDEX_BPS) {
            revert InvalidYieldIndex(yieldIndexBps);
        }
        uint64 last = _latest[lotId].timestamp;
        // Strictly increasing, so a replayed or out-of-order push cannot overwrite newer data.
        if (timestamp <= last) revert StaleTimestamp(timestamp, last);
        if (timestamp > block.timestamp + MAX_FUTURE_DRIFT) revert FutureTimestamp(timestamp);

        _latest[lotId] = Metrics(ndvi, riskScore, yieldIndexBps, timestamp, dataHash);
        unchecked {
            updateCount[lotId]++;
        }
        emit MetricsUpdated(lotId, ndvi, riskScore, yieldIndexBps, timestamp, dataHash, msg.sender);
    }

    function latestMetrics(uint256 lotId) external view returns (Metrics memory) {
        return _latest[lotId];
    }

    function hasMetrics(uint256 lotId) external view returns (bool) {
        return _latest[lotId].timestamp != 0;
    }
}
