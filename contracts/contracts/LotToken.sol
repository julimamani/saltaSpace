// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Initializable} from "@openzeppelin/contracts/proxy/utils/Initializable.sol";

/// @title LotToken
/// @notice ERC20 participation token for a single agricultural lot. One token = one share
///         bought at the lot's `pricePerToken`. Deployed as an EIP-1167 clone by LotFactory,
///         so name/symbol live in regular storage set by `initialize` instead of the constructor.
/// @dev Only the CampaignVault (minter) can mint on invest and burn on claim/refund.
contract LotToken is ERC20, Initializable {
    string private _lotName;
    string private _lotSymbol;
    address public minter;
    uint256 public lotId;

    error NotMinter();

    constructor() ERC20("", "") {
        _disableInitializers();
    }

    function initialize(
        string calldata name_,
        string calldata symbol_,
        address minter_,
        uint256 lotId_
    ) external initializer {
        _lotName = name_;
        _lotSymbol = symbol_;
        minter = minter_;
        lotId = lotId_;
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
}
