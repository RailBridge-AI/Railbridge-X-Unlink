// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract RevenueRegistry {
    address public owner;
    mapping(bytes32 => bool) public seen;

    struct Settlement {
        string merchantId;
        string apiId;
        uint256 amount;
        address payer;
        bytes32 sourceTxHash;
        uint64 recordedAt;
    }

    mapping(bytes32 => Settlement) private settlements;

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    event SettlementRecorded(
        bytes32 indexed settlementId,
        string merchantId,
        string apiId,
        uint256 amount,
        address indexed payer,
        bytes32 indexed sourceTxHash,
        uint64 recordedAt
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "not_owner");
        _;
    }

    constructor(address initialOwner) {
        require(initialOwner != address(0), "invalid_owner");
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "invalid_owner");
        address previous = owner;
        owner = newOwner;
        emit OwnershipTransferred(previous, newOwner);
    }

    function recordSettlement(
        bytes32 settlementId,
        string calldata merchantId,
        string calldata apiId,
        uint256 amount,
        address payer,
        bytes32 sourceTxHash
    ) external onlyOwner {
        require(!seen[settlementId], "duplicate_settlement");

        seen[settlementId] = true;
        settlements[settlementId] = Settlement({
            merchantId: merchantId,
            apiId: apiId,
            amount: amount,
            payer: payer,
            sourceTxHash: sourceTxHash,
            recordedAt: uint64(block.timestamp)
        });

        emit SettlementRecorded(
            settlementId,
            merchantId,
            apiId,
            amount,
            payer,
            sourceTxHash,
            uint64(block.timestamp)
        );
    }

    function getSettlement(bytes32 settlementId)
        external
        view
        returns (
            string memory merchantId,
            string memory apiId,
            uint256 amount,
            address payer,
            bytes32 sourceTxHash,
            uint64 recordedAt
        )
    {
        require(seen[settlementId], "not_found");
        Settlement storage item = settlements[settlementId];
        return (
            item.merchantId,
            item.apiId,
            item.amount,
            item.payer,
            item.sourceTxHash,
            item.recordedAt
        );
    }
}
