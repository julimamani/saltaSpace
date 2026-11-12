// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title InvestorRegistry
/// @notice Platform-wide KYC/AML allowlist for the RWA tokens. A single registry is shared by
///         every LotToken, so an investor is verified once and can hold shares of any lot.
///         Prototype: COMPLIANCE_ROLE can self-verify wallets for the demo.
contract InvestorRegistry is AccessControl {
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    mapping(address => bool) private _verified;

    event InvestorUpdated(address indexed account, bool verified);

    error ZeroAddress();

    constructor(address admin, address compliance) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(COMPLIANCE_ROLE, admin);
        if (compliance != address(0) && compliance != admin) {
            _grantRole(COMPLIANCE_ROLE, compliance);
        }
    }

    function isVerified(address account) external view returns (bool) {
        return _verified[account];
    }

    function setInvestor(address account, bool verified) external onlyRole(COMPLIANCE_ROLE) {
        _verified[account] = verified;
        emit InvestorUpdated(account, verified);
    }

    function setInvestors(address[] calldata accounts, bool verified) external onlyRole(COMPLIANCE_ROLE) {
        for (uint256 i = 0; i < accounts.length; ++i) {
            _verified[accounts[i]] = verified;
            emit InvestorUpdated(accounts[i], verified);
        }
    }
}
