// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @notice Minimal view into the shared KYC registry.
interface IInvestorRegistry {
    function isVerified(address account) external view returns (bool);
}

/// @title LotToken
/// @notice ERC20 participation token for a single agricultural lot. One token = one share
///         bought at the lot's `pricePerToken`. Deployed as an EIP-1167 clone by LotFactory,
///         so name/symbol live in regular storage set by `initialize` instead of the constructor.
/// @dev Only the CampaignVault (minter) can mint on invest and burn on claim/refund.
///      RWA compliance: tokens can only be *received* by wallets verified in the shared
///      InvestorRegistry (KYC allowlist); burning on claim/refund is always allowed.
contract LotToken is ERC20, Initializable {
    string private _lotName;
    string private _lotSymbol;
    address public minter;
    uint256 public lotId;
    IInvestorRegistry public registry;

    error NotMinter();
    error NotVerified(address account);

    constructor() ERC20("", "") {
        _disableInitializers();
    }

    function initialize(
        string calldata name_,
        string calldata symbol_,
        address minter_,
        uint256 lotId_,
        address registry_
    ) external initializer {
        _lotName = name_;
        _lotSymbol = symbol_;
        minter = minter_;
        lotId = lotId_;
        registry = IInvestorRegistry(registry_);
    }

    modifier onlyMinter() {
        if (msg.sender != minter) revert NotMinter();
        _;
    }

    function name() public view override returns (string memory) {
        return _lotName;
    }

    function symbol() public view override returns (string memory) {
        return _lotSymbol;
    }

    /// @notice Shares are whole units: 1 token = 1 share of `pricePerToken` USDC.
    function decimals() public pure override returns (uint8) {
        return 0;
    }

    function mint(address to, uint256 amount) external onlyMinter {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyMinter {
        _burn(from, amount);
    }

    /// @dev KYC gate: only verified investors may *receive* tokens (mints and transfers).
    ///      Burns (`to == 0`) are unrestricted so claim/refund never get stuck.
    function _update(address from, address to, uint256 value) internal override {
        if (to != address(0) && !registry.isVerified(to)) revert NotVerified(to);
        super._update(from, to, value);
    }
}
