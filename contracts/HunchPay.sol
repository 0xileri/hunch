// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal ERC-20 surface: the payment tokens Hunch accepts.
interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function decimals() external view returns (uint8);
}

/**
 * @title HunchPay
 * @notice Funds a watch: the payer sends an accepted token straight to Hunch's treasury and the
 *         payment is tagged on-chain with the watch it belongs to.
 *
 * The contract never holds anyone's money. `fund` moves tokens from the payer to the treasury in
 * one call, so there is no balance here to drain and no withdraw function to get wrong. All it
 * adds is the `Funded` event, which tells the agent which watch a payment was for — something a
 * bare ERC-20 transfer cannot carry.
 *
 * The agent watches for `Funded`, credits that watch's investigation budget, and gets to work.
 * A second accepted token (HUNCH) can be added later with `setAccepted`, which is how the token
 * becomes a way to pay for something rather than a promise.
 */
contract HunchPay {
    /// @notice Where payments land. Hunch's treasury wallet, which buys CREDIT with what it holds.
    address public treasury;

    /// @notice Who may change the treasury and the accepted token list.
    address public owner;

    /// @notice Tokens this contract will accept, e.g. USDG today and HUNCH later.
    mapping(address => bool) public accepted;

    event Funded(bytes32 indexed watchId, address indexed payer, address indexed token, uint256 amount);
    event AcceptedSet(address indexed token, bool ok);
    event TreasurySet(address indexed treasury);
    event OwnerSet(address indexed owner);

    error NotOwner();
    error TokenNotAccepted(address token);
    error ZeroAmount();
    error ZeroAddress();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address treasury_, address firstToken) {
        if (treasury_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        treasury = treasury_;
        emit OwnerSet(msg.sender);
        emit TreasurySet(treasury_);
        if (firstToken != address(0)) {
            accepted[firstToken] = true;
            emit AcceptedSet(firstToken, true);
        }
    }

    /**
     * @notice Pay into a watch. Approve this contract for `amount` of `token` first.
     * @param watchId The watch being funded, as the agent issued it.
     * @param token   An accepted payment token.
     * @param amount  Amount in the token's own decimals.
     */
    function fund(bytes32 watchId, address token, uint256 amount) external {
        if (!accepted[token]) revert TokenNotAccepted(token);
        if (amount == 0) revert ZeroAmount();
        // Straight to the treasury: this contract is a receipt, not a vault.
        (bool ok, bytes memory data) = token.call(
            abi.encodeCall(IERC20.transferFrom, (msg.sender, treasury, amount))
        );
        // Tokens that return nothing on success are accepted; a false return is not.
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
        emit Funded(watchId, msg.sender, token, amount);
    }

    function setAccepted(address token, bool ok) external onlyOwner {
        if (token == address(0)) revert ZeroAddress();
        accepted[token] = ok;
        emit AcceptedSet(token, ok);
    }

    function setTreasury(address treasury_) external onlyOwner {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function setOwner(address owner_) external onlyOwner {
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerSet(owner_);
    }
}
