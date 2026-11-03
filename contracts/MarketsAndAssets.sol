// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ZenithPrimitives.sol";

contract DemoPriceOracle is Owned {
    uint256 public price;
    uint64 public updatedAt;

    event PriceUpdated(uint256 price, uint256 updatedAt);

    constructor(uint256 initialPrice) {
        require(initialPrice > 0, "zero price");
        price = initialPrice;
        updatedAt = uint64(block.timestamp);
    }

    function setPrice(uint256 nextPrice) external onlyOwner {
        require(nextPrice > 0, "zero price");
        price = nextPrice;
        updatedAt = uint64(block.timestamp);
        emit PriceUpdated(nextPrice, block.timestamp);
    }

    function poke() external returns (uint256 nextPrice) {
        uint256 entropy = uint256(keccak256(abi.encodePacked(block.prevrandao, block.timestamp, msg.sender, price)));
        uint256 bps = 5 + entropy % 36;
        if ((entropy & 1) == 0) nextPrice = price * (10_000 + bps) / 10_000;
        else nextPrice = price * (10_000 - bps) / 10_000;
        price = nextPrice;
        updatedAt = uint64(block.timestamp);
        emit PriceUpdated(nextPrice, block.timestamp);
    }
}

contract FlashPredict is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    struct Round {
        uint128 startPrice;
        uint128 endPrice;
        uint128 upPool;
        uint128 downPool;
        uint64 startsAt;
        uint64 endsAt;
        bool settled;
        bool upWon;
    }

    IERC20Zenith public immutable chip;
    DemoPriceOracle public immutable oracle;
    uint64 public roundDuration;
    uint256 public currentRound;
    mapping(uint256 => Round) public rounds;
    mapping(uint256 => mapping(address => uint128)) public upBets;
    mapping(uint256 => mapping(address => uint128)) public downBets;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event RoundOpened(uint256 indexed roundId, uint256 startPrice, uint256 endsAt);
    event BetPlaced(uint256 indexed roundId, address indexed player, bool up, uint256 amount);
    event RoundSettled(uint256 indexed roundId, uint256 endPrice, bool upWon);
    event WinningsClaimed(uint256 indexed roundId, address indexed player, uint256 amount);

    constructor(address chipAddress, address oracleAddress, uint64 duration) {
        require(chipAddress != address(0) && oracleAddress != address(0), "zero dependency");
        require(duration >= 60 && duration <= 1 hours, "bad duration");
        chip = IERC20Zenith(chipAddress);
        oracle = DemoPriceOracle(oracleAddress);
        roundDuration = duration;
        _openRound(oracle.price());
    }

    function bet(bool up, uint128 amount) external whenNotPaused nonReentrant {
        require(amount > 0, "zero bet");
        if (block.timestamp >= rounds[currentRound].endsAt) _settleAndOpen();
        Round storage round = rounds[currentRound];
        if (up) {
            upBets[currentRound][msg.sender] += amount;
            round.upPool += amount;
        } else {
            downBets[currentRound][msg.sender] += amount;
            round.downPool += amount;
        }
        chip.safeTransferFrom(msg.sender, address(this), amount);
        emit BetPlaced(currentRound, msg.sender, up, amount);
    }

    function rollRound() external whenNotPaused returns (uint256) {
        require(block.timestamp >= rounds[currentRound].endsAt, "round active");
        _settleAndOpen();
        return currentRound;
    }

    function claim(uint256 roundId) external nonReentrant {
        Round storage round = rounds[roundId];
        require(round.settled && !claimed[roundId][msg.sender], "not claimable");
        claimed[roundId][msg.sender] = true;
        uint256 ownBet = round.upWon ? upBets[roundId][msg.sender] : downBets[roundId][msg.sender];
        uint256 winningPool = round.upWon ? round.upPool : round.downPool;
        uint256 losingPool = round.upWon ? round.downPool : round.upPool;
        uint256 amount;
        if (winningPool == 0) {
            ownBet = upBets[roundId][msg.sender] + downBets[roundId][msg.sender];
            amount = ownBet;
        } else {
            require(ownBet > 0, "no winning bet");
            amount = ownBet + ownBet * losingPool / winningPool;
        }
        chip.safeTransfer(msg.sender, amount);
        emit WinningsClaimed(roundId, msg.sender, amount);
    }

    function setRoundDuration(uint64 duration) external onlyOwner {
        require(duration >= 60 && duration <= 1 hours, "bad duration");
        roundDuration = duration;
    }

    function _settleAndOpen() internal {
        Round storage round = rounds[currentRound];
        require(!round.settled, "already settled");
        uint256 endPrice = oracle.poke();
        round.endPrice = uint128(endPrice);
        round.upWon = endPrice >= round.startPrice;
        round.settled = true;
        emit RoundSettled(currentRound, endPrice, round.upWon);
        _openRound(endPrice);
    }

    function _openRound(uint256 startPrice) internal {
        uint256 roundId = ++currentRound;
        rounds[roundId] = Round({
            startPrice: uint128(startPrice),
            endPrice: 0,
            upPool: 0,
            downPool: 0,
            startsAt: uint64(block.timestamp),
            endsAt: uint64(block.timestamp + roundDuration),
            settled: false,
            upWon: false
        });
        emit RoundOpened(roundId, startPrice, block.timestamp + roundDuration);
    }
}

contract FairTix is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    struct TicketEvent {
        address organizer;
        address paymentToken;
        string name;
        string venue;
        string metadataUri;
        uint128 mintPrice;
        uint64 startsAt;
        uint32 supply;
        uint32 sold;
    }

    string public constant name = "FairTix Ticket";
    string public constant symbol = "FTIX";
    uint256 public eventCount;
    uint256 public totalSupply;
    mapping(uint256 => TicketEvent) public events;
    mapping(uint256 => address) public ownerOf;
    mapping(address => uint256) public balanceOf;
    mapping(uint256 => uint256) public ticketEvent;
    mapping(uint256 => uint256) public originalPrice;
    mapping(uint256 => uint256) public resalePrice;
    mapping(uint256 => bool) public checkedIn;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);
    event EventCreated(uint256 indexed eventId, address indexed organizer, string name, uint256 price, uint256 supply);
    event TicketMinted(uint256 indexed eventId, uint256 indexed tokenId, address indexed holder);
    event TicketListed(uint256 indexed tokenId, uint256 price);
    event TicketResold(uint256 indexed tokenId, address indexed seller, address indexed buyer, uint256 price);
    event TicketCheckedIn(uint256 indexed tokenId, address indexed holder);

    function createEvent(
        string calldata eventName,
        string calldata venue,
        string calldata metadataUri,
        address paymentToken,
        uint128 mintPrice,
        uint64 startsAt,
        uint32 supply
    ) external whenNotPaused returns (uint256 eventId) {
        require(bytes(eventName).length > 0 && paymentToken != address(0), "bad event");
        require(mintPrice > 0 && startsAt > block.timestamp && supply > 0, "bad sale");
        eventId = ++eventCount;
        events[eventId] = TicketEvent(msg.sender, paymentToken, eventName, venue, metadataUri, mintPrice, startsAt, supply, 0);
        emit EventCreated(eventId, msg.sender, eventName, mintPrice, supply);
    }

    function buyTicket(uint256 eventId) external whenNotPaused nonReentrant returns (uint256 tokenId) {
        TicketEvent storage item = events[eventId];
        require(item.organizer != address(0) && block.timestamp < item.startsAt, "sale closed");
        require(item.sold < item.supply, "sold out");
        IERC20Zenith(item.paymentToken).safeTransferFrom(msg.sender, item.organizer, item.mintPrice);
        item.sold += 1;
        tokenId = ++totalSupply;
        ownerOf[tokenId] = msg.sender;
        balanceOf[msg.sender] += 1;
        ticketEvent[tokenId] = eventId;
        originalPrice[tokenId] = item.mintPrice;
        emit Transfer(address(0), msg.sender, tokenId);
        emit TicketMinted(eventId, tokenId, msg.sender);
    }

    function listForResale(uint256 tokenId, uint256 price) external whenNotPaused {
        require(ownerOf[tokenId] == msg.sender, "holder only");
        require(!checkedIn[tokenId] && price > 0 && price <= originalPrice[tokenId], "price above face value");
        resalePrice[tokenId] = price;
        emit TicketListed(tokenId, price);
    }

    function cancelListing(uint256 tokenId) external {
        require(ownerOf[tokenId] == msg.sender, "holder only");
        resalePrice[tokenId] = 0;
    }

    function buyResale(uint256 tokenId) external whenNotPaused nonReentrant {
        address seller = ownerOf[tokenId];
        uint256 price = resalePrice[tokenId];
        require(seller != address(0) && seller != msg.sender && price > 0, "not listed");
        TicketEvent storage item = events[ticketEvent[tokenId]];
        require(block.timestamp < item.startsAt && !checkedIn[tokenId], "event started");
        resalePrice[tokenId] = 0;
        ownerOf[tokenId] = msg.sender;
        balanceOf[seller] -= 1;
        balanceOf[msg.sender] += 1;
        IERC20Zenith(item.paymentToken).safeTransferFrom(msg.sender, seller, price);
        emit Transfer(seller, msg.sender, tokenId);
        emit TicketResold(tokenId, seller, msg.sender, price);
    }

    function entryDigest(uint256 tokenId, uint64 timestamp) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), block.chainid, tokenId, timestamp, "FAIRTIX_ENTRY"));
    }

    function checkIn(uint256 tokenId, uint64 timestamp, bytes calldata signature) external {
        TicketEvent storage item = events[ticketEvent[tokenId]];
        require(msg.sender == item.organizer && !checkedIn[tokenId], "organizer only");
        require(timestamp + 2 minutes >= block.timestamp && timestamp <= block.timestamp + 2 minutes, "stale QR");
        bytes32 digest = ZenithECDSA.toEthSignedMessageHash(entryDigest(tokenId, timestamp));
        address holder = ownerOf[tokenId];
        require(ZenithECDSA.recover(digest, signature) == holder, "invalid ticket proof");
        checkedIn[tokenId] = true;
        emit TicketCheckedIn(tokenId, holder);
    }

    function transferFrom(address, address, uint256) external pure {
        revert("FairTix: use capped resale");
    }

    function safeTransferFrom(address, address, uint256) external pure {
        revert("FairTix: use capped resale");
    }
}

contract DeadMansVault is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    struct Vault {
        address vaultOwner;
        address token;
        uint128 deposited;
        uint64 heartbeatAt;
        uint64 inactivityPeriod;
        uint16 beneficiaryCount;
        bool closed;
    }

    uint256 public vaultCount;
    mapping(uint256 => Vault) public vaults;
    mapping(uint256 => address[]) private _beneficiaries;
    mapping(uint256 => mapping(address => uint16)) public shareBps;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event VaultCreated(uint256 indexed vaultId, address indexed owner, address token, uint256 inactivityPeriod);
    event VaultFunded(uint256 indexed vaultId, uint256 amount);
    event Heartbeat(uint256 indexed vaultId, uint256 nextUnlockAt);
    event InheritanceClaimed(uint256 indexed vaultId, address indexed beneficiary, uint256 amount);
    event VaultClosed(uint256 indexed vaultId, uint256 amountReturned);

    function createVault(
        address token,
        uint64 inactivityPeriod,
        address[] calldata beneficiaryAccounts,
        uint16[] calldata shares
    ) external whenNotPaused returns (uint256 vaultId) {
        require(token != address(0) && inactivityPeriod >= 60, "bad vault");
        require(beneficiaryAccounts.length > 0 && beneficiaryAccounts.length <= 10 && beneficiaryAccounts.length == shares.length, "bad beneficiaries");
        uint256 total;
        vaultId = ++vaultCount;
        for (uint256 i; i < beneficiaryAccounts.length; ++i) {
            address beneficiary = beneficiaryAccounts[i];
            require(beneficiary != address(0) && beneficiary != msg.sender && shareBps[vaultId][beneficiary] == 0, "bad beneficiary");
            shareBps[vaultId][beneficiary] = shares[i];
            _beneficiaries[vaultId].push(beneficiary);
            total += shares[i];
        }
        require(total == 10_000, "shares must total 10000");
        vaults[vaultId] = Vault(msg.sender, token, 0, uint64(block.timestamp), inactivityPeriod, uint16(beneficiaryAccounts.length), false);
        emit VaultCreated(vaultId, msg.sender, token, inactivityPeriod);
    }

    function fund(uint256 vaultId, uint128 amount) external whenNotPaused nonReentrant {
        Vault storage item = vaults[vaultId];
        require(msg.sender == item.vaultOwner && !item.closed && amount > 0, "owner only");
        item.deposited += amount;
        item.heartbeatAt = uint64(block.timestamp);
        IERC20Zenith(item.token).safeTransferFrom(msg.sender, address(this), amount);
        emit VaultFunded(vaultId, amount);
        emit Heartbeat(vaultId, block.timestamp + item.inactivityPeriod);
    }

    function ping(uint256 vaultId) external {
        Vault storage item = vaults[vaultId];
        require(msg.sender == item.vaultOwner && !item.closed, "owner only");
        item.heartbeatAt = uint64(block.timestamp);
        emit Heartbeat(vaultId, block.timestamp + item.inactivityPeriod);
    }

    function unlockAt(uint256 vaultId) external view returns (uint256) {
        Vault storage item = vaults[vaultId];
        return item.heartbeatAt + item.inactivityPeriod;
    }

    function claim(uint256 vaultId) external nonReentrant {
        Vault storage item = vaults[vaultId];
        uint256 bps = shareBps[vaultId][msg.sender];
        require(!item.closed && bps > 0 && !claimed[vaultId][msg.sender], "not beneficiary");
        require(block.timestamp > item.heartbeatAt + item.inactivityPeriod, "heartbeat active");
        claimed[vaultId][msg.sender] = true;
        uint256 amount = uint256(item.deposited) * bps / 10_000;
        IERC20Zenith(item.token).safeTransfer(msg.sender, amount);
        emit InheritanceClaimed(vaultId, msg.sender, amount);
    }

    function closeVault(uint256 vaultId) external nonReentrant {
        Vault storage item = vaults[vaultId];
        require(msg.sender == item.vaultOwner && !item.closed, "owner only");
        require(block.timestamp <= item.heartbeatAt + item.inactivityPeriod, "already unlocked");
        item.closed = true;
        uint256 amount = item.deposited;
        IERC20Zenith(item.token).safeTransfer(item.vaultOwner, amount);
        emit VaultClosed(vaultId, amount);
    }

    function beneficiaries(uint256 vaultId) external view returns (address[] memory) {
        return _beneficiaries[vaultId];
    }
}

contract DigitalShop is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    struct Product {
        address seller;
        address token;
        string title;
        string previewUri;
        bytes32 contentCommitment;
        uint128 price;
        uint32 sales;
        bool active;
    }

    uint256 public productCount;
    mapping(uint256 => Product) public products;
    mapping(uint256 => mapping(address => bool)) public hasPurchased;

    event ProductPublished(uint256 indexed productId, address indexed seller, string title, uint256 price);
    event ProductPurchased(uint256 indexed productId, address indexed buyer, bytes32 licenseKey);
    event ProductStatusChanged(uint256 indexed productId, bool active);

    function publish(
        string calldata title,
        string calldata previewUri,
        address token,
        uint128 price,
        bytes32 contentCommitment
    ) external whenNotPaused returns (uint256 productId) {
        require(bytes(title).length > 0 && token != address(0) && price > 0, "bad product");
        productId = ++productCount;
        products[productId] = Product(msg.sender, token, title, previewUri, contentCommitment, price, 0, true);
        emit ProductPublished(productId, msg.sender, title, price);
    }

    function purchase(uint256 productId) external whenNotPaused nonReentrant {
        Product storage product = products[productId];
        require(product.active && !hasPurchased[productId][msg.sender], "unavailable");
        hasPurchased[productId][msg.sender] = true;
        product.sales += 1;
        IERC20Zenith(product.token).safeTransferFrom(msg.sender, product.seller, product.price);
        emit ProductPurchased(productId, msg.sender, licenseFor(productId, msg.sender));
    }

    function licenseFor(uint256 productId, address buyer) public view returns (bytes32) {
        require(hasPurchased[productId][buyer], "not purchased");
        return keccak256(abi.encodePacked(address(this), block.chainid, productId, buyer, products[productId].contentCommitment));
    }

    function verifyLicense(uint256 productId, address buyer, bytes32 key) external view returns (bool) {
        return hasPurchased[productId][buyer] && licenseFor(productId, buyer) == key;
    }

    function setActive(uint256 productId, bool active) external {
        Product storage product = products[productId];
        require(msg.sender == product.seller, "seller only");
        product.active = active;
        emit ProductStatusChanged(productId, active);
    }
}

contract ZenithSuiteRegistry is Owned {
    string public constant suiteVersion = "1.0.0";
    mapping(bytes32 => address) public application;
    bytes32[] private _keys;
    mapping(bytes32 => bool) private _known;

    event ApplicationRegistered(bytes32 indexed key, address indexed implementation);

    function setApplication(bytes32 key, address implementation) external onlyOwner {
        require(key != bytes32(0) && implementation != address(0), "bad registration");
        if (!_known[key]) {
            _known[key] = true;
            _keys.push(key);
        }
        application[key] = implementation;
        emit ApplicationRegistered(key, implementation);
    }

    function keys() external view returns (bytes32[] memory) {
        return _keys;
    }
}
