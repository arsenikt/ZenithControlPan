// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ZenithPrimitives.sol";

contract SubStream is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    struct Stream {
        address payer;
        address payee;
        address token;
        uint128 deposit;
        uint128 claimed;
        uint96 ratePerSecond;
        uint64 startedAt;
        uint64 cancelledAt;
        bytes32 serviceId;
    }

    uint256 public streamCount;
    mapping(uint256 => Stream) public streams;

    event StreamOpened(uint256 indexed streamId, address indexed payer, address indexed payee, bytes32 serviceId, uint256 deposit, uint256 ratePerSecond);
    event StreamWithdrawn(uint256 indexed streamId, address indexed payee, uint256 amount);
    event StreamCancelled(uint256 indexed streamId, uint256 paidToService, uint256 refundedToPayer);

    function createStream(
        address payee,
        address token,
        uint128 deposit,
        uint96 ratePerSecond,
        bytes32 serviceId
    ) external whenNotPaused nonReentrant returns (uint256 streamId) {
        require(payee != address(0) && token != address(0), "zero address");
        require(deposit > 0 && ratePerSecond > 0 && ratePerSecond <= deposit, "bad stream");
        streamId = ++streamCount;
        streams[streamId] = Stream({
            payer: msg.sender,
            payee: payee,
            token: token,
            deposit: deposit,
            claimed: 0,
            ratePerSecond: ratePerSecond,
            startedAt: uint64(block.timestamp),
            cancelledAt: 0,
            serviceId: serviceId
        });
        IERC20Zenith(token).safeTransferFrom(msg.sender, address(this), deposit);
        emit StreamOpened(streamId, msg.sender, payee, serviceId, deposit, ratePerSecond);
    }

    function unlocked(uint256 streamId) public view returns (uint256) {
        Stream storage item = streams[streamId];
        if (item.payer == address(0)) return 0;
        uint256 until = item.cancelledAt == 0 ? block.timestamp : item.cancelledAt;
        uint256 value = (until - item.startedAt) * item.ratePerSecond;
        return value > item.deposit ? item.deposit : value;
    }

    function remaining(uint256 streamId) external view returns (uint256) {
        Stream storage item = streams[streamId];
        return item.deposit - unlocked(streamId);
    }

    function hasAccess(uint256 streamId) external view returns (bool) {
        Stream storage item = streams[streamId];
        return item.payer != address(0) && item.cancelledAt == 0 && unlocked(streamId) < item.deposit;
    }

    function withdraw(uint256 streamId) external whenNotPaused nonReentrant {
        Stream storage item = streams[streamId];
        require(msg.sender == item.payee, "payee only");
        uint256 available = unlocked(streamId) - item.claimed;
        require(available > 0, "nothing unlocked");
        item.claimed += uint128(available);
        IERC20Zenith(item.token).safeTransfer(item.payee, available);
        emit StreamWithdrawn(streamId, item.payee, available);
    }

    function cancel(uint256 streamId) external nonReentrant {
        Stream storage item = streams[streamId];
        require(msg.sender == item.payer && item.cancelledAt == 0, "payer only");
        item.cancelledAt = uint64(block.timestamp);
        uint256 earned = unlocked(streamId);
        uint256 payeeAmount = earned - item.claimed;
        uint256 refundAmount = item.deposit - earned;
        item.claimed = uint128(earned);
        if (payeeAmount > 0) IERC20Zenith(item.token).safeTransfer(item.payee, payeeAmount);
        if (refundAmount > 0) IERC20Zenith(item.token).safeTransfer(item.payer, refundAmount);
        emit StreamCancelled(streamId, payeeAmount, refundAmount);
    }
}

contract SafeDealP2P is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    uint16 public constant COLLATERAL_BPS = 2_000;
    uint256 public constant BPS = 10_000;
    uint256 public constant SELLER_FUNDING_WINDOW = 1 days;
    uint256 public constant BOT_CONFIRM_DELAY = 10 seconds;

    struct Deal {
        address buyer;
        address seller;
        address token;
        uint128 price;
        uint128 collateral;
        uint64 createdAt;
        bytes32 termsHash;
        bool sellerFunded;
        bool buyerConfirmed;
        bool sellerConfirmed;
        bool botSeller;
        bool closed;
    }

    uint256 public dealCount;
    mapping(uint256 => Deal) public deals;
    mapping(address => uint256) public botReserve;

    event BotReserveFunded(address indexed token, uint256 amount);
    event DealCreated(uint256 indexed dealId, address indexed buyer, address indexed seller, uint256 price, uint256 collateral, bool botSeller, bytes32 termsHash);
    event SellerFunded(uint256 indexed dealId);
    event DealConfirmed(uint256 indexed dealId, address indexed party);
    event DealCompleted(uint256 indexed dealId);
    event DealAborted(uint256 indexed dealId);

    function fundBotReserve(address token, uint256 amount) external onlyOwner nonReentrant {
        require(token != address(0) && amount > 0, "bad reserve");
        IERC20Zenith(token).safeTransferFrom(msg.sender, address(this), amount);
        botReserve[token] += amount;
        emit BotReserveFunded(token, amount);
    }

    function createDeal(
        address seller,
        address token,
        uint128 price,
        bytes32 termsHash,
        bool botSeller
    ) external whenNotPaused nonReentrant returns (uint256 dealId) {
        require(token != address(0) && price > 0 && termsHash != bytes32(0), "bad deal");
        require(botSeller || (seller != address(0) && seller != msg.sender), "bad seller");
        uint128 collateral = uint128(uint256(price) * COLLATERAL_BPS / BPS);
        dealId = ++dealCount;
        address effectiveSeller = botSeller ? owner : seller;
        bool funded;
        if (botSeller) {
            require(botReserve[token] >= collateral, "bot reserve low");
            botReserve[token] -= collateral;
            funded = true;
        }
        deals[dealId] = Deal({
            buyer: msg.sender,
            seller: effectiveSeller,
            token: token,
            price: price,
            collateral: collateral,
            createdAt: uint64(block.timestamp),
            termsHash: termsHash,
            sellerFunded: funded,
            buyerConfirmed: false,
            sellerConfirmed: false,
            botSeller: botSeller,
            closed: false
        });
        IERC20Zenith(token).safeTransferFrom(msg.sender, address(this), uint256(price) + collateral);
        emit DealCreated(dealId, msg.sender, effectiveSeller, price, collateral, botSeller, termsHash);
        if (funded) emit SellerFunded(dealId);
    }

    function fundSeller(uint256 dealId) external whenNotPaused nonReentrant {
        Deal storage item = deals[dealId];
        require(msg.sender == item.seller && !item.botSeller && !item.sellerFunded && !item.closed, "seller only");
        require(block.timestamp <= item.createdAt + SELLER_FUNDING_WINDOW, "funding expired");
        item.sellerFunded = true;
        IERC20Zenith(item.token).safeTransferFrom(msg.sender, address(this), item.collateral);
        emit SellerFunded(dealId);
    }

    function confirm(uint256 dealId) external whenNotPaused {
        Deal storage item = deals[dealId];
        require(item.sellerFunded && !item.closed, "not active");
        if (msg.sender == item.buyer) item.buyerConfirmed = true;
        else if (msg.sender == item.seller && !item.botSeller) item.sellerConfirmed = true;
        else revert("party only");
        emit DealConfirmed(dealId, msg.sender);
    }

    function complete(uint256 dealId) external nonReentrant {
        Deal storage item = deals[dealId];
        require(item.sellerFunded && !item.closed, "not active");
        if (item.botSeller && block.timestamp >= item.createdAt + BOT_CONFIRM_DELAY) {
            item.sellerConfirmed = true;
        }
        require(item.buyerConfirmed && item.sellerConfirmed, "waiting for confirmations");
        item.closed = true;
        IERC20Zenith(item.token).safeTransfer(item.buyer, item.collateral);
        if (item.botSeller) {
            botReserve[item.token] += item.collateral;
            IERC20Zenith(item.token).safeTransfer(owner, item.price);
        } else {
            IERC20Zenith(item.token).safeTransfer(item.seller, uint256(item.price) + item.collateral);
        }
        emit DealCompleted(dealId);
    }

    function abortUnfunded(uint256 dealId) external nonReentrant {
        Deal storage item = deals[dealId];
        require(msg.sender == item.buyer && !item.sellerFunded && !item.closed, "cannot abort");
        require(block.timestamp > item.createdAt + SELLER_FUNDING_WINDOW, "funding open");
        item.closed = true;
        IERC20Zenith(item.token).safeTransfer(item.buyer, uint256(item.price) + item.collateral);
        emit DealAborted(dealId);
    }
}
