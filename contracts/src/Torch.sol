// SPDX-License-Identifier: MIT
// By Sean Brennan
// Deployed to 0x

pragma solidity ^0.8.20;

import {ERC721} from "../lib/openzeppelin-contracts/contracts/token/ERC721/ERC721.sol";

contract TheCryptoGameTorchS01 is ERC721 {
    uint256 currentTokenId = 0;

    constructor() ERC721("GameTorch", "TORCH") {}

    function mint(address to) public {
        ++currentTokenId;
        _mint(to, currentTokenId);
    }

    function _beforeTokenTransfer(address from, address to, uint256) pure override internal {
        require(from == address(0) || to == address(0), "This is a Soulbound token. It cannot be transferred.");
    }

    function tokenURI(uint256 tokenId) public pure override returns (string memory) {
        return "ipfs://bafybeid3qfbopsw4jsoptbyrw5jryvm2ex5kgiccyvoor56qhy5z4gm4km";
    }
}