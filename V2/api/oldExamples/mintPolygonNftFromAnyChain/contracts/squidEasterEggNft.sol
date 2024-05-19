// SPDX-License-Identifier: MIT

pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";

contract squidEasterEggNft is ERC721 {
    uint256 private _currentTokenId = 0;
    string private _baseTokenURI;
    mapping(address => bool) private _minted;

    constructor(string memory name, string memory symbol, string memory baseTokenURI_)
        ERC721(name, symbol)
    {
        _baseTokenURI = baseTokenURI_;
    }

    function mint(address _receiver) external {
        require(!_minted[_receiver], "You have already minted this NFT.");
        _minted[_receiver] = true;
        _currentTokenId += 1;
        uint256 newItemId = _currentTokenId;
        _safeMint(_receiver, newItemId);
    }

    function _baseURI() internal view override returns (string memory) {
        return _baseTokenURI;
    }
}
