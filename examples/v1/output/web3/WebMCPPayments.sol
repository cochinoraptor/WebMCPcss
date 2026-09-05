// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/// @title WebMCPPayments — pagos por tool para sitios WebMCPcss
contract WebMCPPayments {
    address public owner;
    IERC20 public immutable usdc;
    mapping(bytes32 => uint256) public priceNative; // wei
    mapping(bytes32 => uint256) public priceUsdc;   // 6 decimales
    mapping(address => mapping(bytes32 => uint256)) public paidUntil;

    event ToolPaid(address indexed payer, bytes32 indexed toolId, uint256 amount, bool usdcPayment);

    modifier onlyOwner() { require(msg.sender == owner, "not owner"); _; }

    constructor(address usdcAddress) { owner = msg.sender; usdc = IERC20(usdcAddress); }

    function setPrice(bytes32 toolId, uint256 nativeWei, uint256 usdcUnits) external onlyOwner {
        priceNative[toolId] = nativeWei; priceUsdc[toolId] = usdcUnits;
    }

    function payTool(bytes32 toolId) external payable {
        require(msg.value >= priceNative[toolId] && msg.value > 0, "insufficient");
        paidUntil[msg.sender][toolId] = block.timestamp + 1 days;
        emit ToolPaid(msg.sender, toolId, msg.value, false);
    }

    function payToolUSDC(bytes32 toolId) external {
        uint256 price = priceUsdc[toolId];
        require(price > 0, "no usdc price");
        require(usdc.transferFrom(msg.sender, address(this), price), "transfer failed");
        paidUntil[msg.sender][toolId] = block.timestamp + 1 days;
        emit ToolPaid(msg.sender, toolId, price, true);
    }

    function hasAccess(address payer, bytes32 toolId) external view returns (bool) {
        return paidUntil[payer][toolId] >= block.timestamp;
    }

    function withdraw() external onlyOwner { payable(owner).transfer(address(this).balance); }
}
