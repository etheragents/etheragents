// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @notice Local/testnet stand-in for the canonical ERC-8004 IdentityRegistry (mainnet:
///         0x8004A169FB4a3325136EB29fA0ceB6D2e539a432). Same `register` / `setAgentURI` / `tokenURI` surface.
contract MockIdentityRegistry is ERC721 {
    uint256 public nextId;
    mapping(uint256 => string) internal _uris;

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);
    event URIUpdated(uint256 indexed agentId, string newURI, address indexed updatedBy);

    constructor() ERC721("AgentIdentity", "AGENT") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = nextId++;
        _uris[agentId] = agentURI;
        _safeMint(msg.sender, agentId);
        emit Registered(agentId, agentURI, msg.sender);
    }

    function setAgentURI(uint256 agentId, string calldata newURI) external {
        require(ownerOf(agentId) == msg.sender, "not owner");
        _uris[agentId] = newURI;
        emit URIUpdated(agentId, newURI, msg.sender);
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _uris[agentId];
    }
}
