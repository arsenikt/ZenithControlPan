// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./ZenithPrimitives.sol";

contract EscrowVault is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    struct LinkTransfer {
        address sender;
        address ephemeralSigner;
        address token;
        uint128 amount;
        uint64 expiresAt;
        bool claimed;
        bool refunded;
    }

    uint256 public nonce;
    mapping(bytes32 => LinkTransfer) public transfers;

    event LinkCreated(
        bytes32 indexed transferId,
        address indexed sender,
        address indexed ephemeralSigner,
        address token,
        uint256 amount,
        uint256 expiresAt
    );
    event LinkClaimed(bytes32 indexed transferId, address indexed recipient);
    event LinkRefunded(bytes32 indexed transferId);

    function createTransfer(
        address ephemeralSigner,
        address token,
        uint128 amount,
        uint64 expiresAt
    ) external whenNotPaused nonReentrant returns (bytes32 transferId) {
        require(ephemeralSigner != address(0) && token != address(0), "zero address");
        require(amount > 0, "zero amount");
        require(expiresAt > block.timestamp + 5 minutes, "expiry too soon");
        transferId = keccak256(abi.encodePacked(address(this), block.chainid, msg.sender, ephemeralSigner, ++nonce));
        transfers[transferId] = LinkTransfer({
            sender: msg.sender,
            ephemeralSigner: ephemeralSigner,
            token: token,
            amount: amount,
            expiresAt: expiresAt,
            claimed: false,
            refunded: false
        });
        IERC20Zenith(token).safeTransferFrom(msg.sender, address(this), amount);
        emit LinkCreated(transferId, msg.sender, ephemeralSigner, token, amount, expiresAt);
    }

    function claimDigest(bytes32 transferId, address recipient) public view returns (bytes32) {
        return keccak256(abi.encodePacked(address(this), block.chainid, transferId, recipient));
    }

    function claim(bytes32 transferId, address recipient, bytes calldata signature)
        external
        whenNotPaused
        nonReentrant
    {
        LinkTransfer storage item = transfers[transferId];
        require(item.sender != address(0), "unknown transfer");
        require(!item.claimed && !item.refunded, "closed");
        require(block.timestamp <= item.expiresAt, "expired");
        require(recipient != address(0), "zero recipient");
        bytes32 digest = ZenithECDSA.toEthSignedMessageHash(claimDigest(transferId, recipient));
        require(ZenithECDSA.recover(digest, signature) == item.ephemeralSigner, "bad claim signature");
        item.claimed = true;
        IERC20Zenith(item.token).safeTransfer(recipient, item.amount);
        emit LinkClaimed(transferId, recipient);
    }

    function refund(bytes32 transferId) external nonReentrant {
        LinkTransfer storage item = transfers[transferId];
        require(msg.sender == item.sender, "sender only");
        require(!item.claimed && !item.refunded, "closed");
        require(block.timestamp > item.expiresAt, "not expired");
        item.refunded = true;
        IERC20Zenith(item.token).safeTransfer(item.sender, item.amount);
        emit LinkRefunded(transferId);
    }
}

contract HabitPool is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    struct Challenge {
        address creator;
        address judge;
        address token;
        string title;
        uint128 stake;
        uint64 startedAt;
        uint8 durationDays;
        uint64 demoOffset;
        uint32 participantCount;
        uint32 winnerCount;
        uint128 payoutPerWinner;
        bool demoMode;
        bool finalized;
    }

    uint256 public challengeCount;
    mapping(uint256 => Challenge) public challenges;
    mapping(uint256 => address[]) private _participants;
    mapping(uint256 => mapping(address => bool)) public joined;
    mapping(uint256 => mapping(address => uint8)) public completedDays;
    mapping(uint256 => mapping(address => mapping(uint8 => bool))) public checkedIn;
    mapping(uint256 => mapping(address => bool)) public winner;
    mapping(uint256 => mapping(address => bool)) public claimed;

    event ChallengeCreated(uint256 indexed challengeId, address indexed creator, string title, uint256 stake, uint8 daysCount, bool demoMode);
    event ParticipantJoined(uint256 indexed challengeId, address indexed participant);
    event CheckedIn(uint256 indexed challengeId, address indexed participant, uint8 day);
    event DemoTimeWarped(uint256 indexed challengeId, uint256 effectiveTimestamp);
    event ChallengeFinalized(uint256 indexed challengeId, uint256 winners, uint256 payoutPerWinner);
    event RewardClaimed(uint256 indexed challengeId, address indexed participant, uint256 amount);

    function createChallenge(
        string calldata title,
        address token,
        uint128 stake,
        uint8 durationDays,
        address judge,
        bool demoMode
    ) external whenNotPaused nonReentrant returns (uint256 challengeId) {
        require(bytes(title).length > 0 && bytes(title).length <= 96, "bad title");
        require(token != address(0) && stake > 0, "bad stake");
        require(durationDays > 0 && durationDays <= 30, "bad duration");
        challengeId = ++challengeCount;
        challenges[challengeId] = Challenge({
            creator: msg.sender,
            judge: judge,
            token: token,
            title: title,
            stake: stake,
            startedAt: uint64(block.timestamp),
            durationDays: durationDays,
            demoOffset: 0,
            participantCount: 1,
            winnerCount: 0,
            payoutPerWinner: 0,
            demoMode: demoMode,
            finalized: false
        });
        joined[challengeId][msg.sender] = true;
        _participants[challengeId].push(msg.sender);
        IERC20Zenith(token).safeTransferFrom(msg.sender, address(this), stake);
        emit ChallengeCreated(challengeId, msg.sender, title, stake, durationDays, demoMode);
        emit ParticipantJoined(challengeId, msg.sender);
    }

    function join(uint256 challengeId) external whenNotPaused nonReentrant {
        Challenge storage item = challenges[challengeId];
        require(item.creator != address(0) && !item.finalized, "closed");
        require(!joined[challengeId][msg.sender], "already joined");
        require(currentDay(challengeId) == 0 && _participants[challengeId].length < 32, "join window closed");
        joined[challengeId][msg.sender] = true;
        item.participantCount += 1;
        _participants[challengeId].push(msg.sender);
        IERC20Zenith(item.token).safeTransferFrom(msg.sender, address(this), item.stake);
        emit ParticipantJoined(challengeId, msg.sender);
    }

    function currentDay(uint256 challengeId) public view returns (uint8) {
        Challenge storage item = challenges[challengeId];
        if (item.creator == address(0)) return 0;
        uint256 elapsed = block.timestamp + item.demoOffset - item.startedAt;
        uint256 day = elapsed / 1 days;
        return uint8(day > type(uint8).max ? type(uint8).max : day);
    }

    function checkIn(uint256 challengeId) external whenNotPaused {
        Challenge storage item = challenges[challengeId];
        require(joined[challengeId][msg.sender] && !item.finalized, "not active");
        uint8 day = currentDay(challengeId);
        require(day < item.durationDays, "challenge ended");
        require(!checkedIn[challengeId][msg.sender][day], "already checked");
        checkedIn[challengeId][msg.sender][day] = true;
        completedDays[challengeId][msg.sender] += 1;
        emit CheckedIn(challengeId, msg.sender, day);
    }

    function demoTimeWarp(uint256 challengeId) external {
        Challenge storage item = challenges[challengeId];
        require(item.demoMode && msg.sender == item.creator && !item.finalized, "demo creator only");
        item.demoOffset += 1 days;
        emit DemoTimeWarped(challengeId, block.timestamp + item.demoOffset);
    }

    function finalize(uint256 challengeId) external {
        Challenge storage item = challenges[challengeId];
        require(!item.finalized && currentDay(challengeId) >= item.durationDays, "not ready");
        address[] storage participantList = _participants[challengeId];
        uint256 winners;
        for (uint256 i; i < participantList.length; ++i) {
            if (completedDays[challengeId][participantList[i]] == item.durationDays) {
                winner[challengeId][participantList[i]] = true;
                ++winners;
            }
        }
        if (winners == 0) {
            winners = participantList.length;
            for (uint256 i; i < participantList.length; ++i) winner[challengeId][participantList[i]] = true;
        }
        item.finalized = true;
        item.winnerCount = uint32(winners);
        item.payoutPerWinner = uint128(uint256(item.stake) * participantList.length / winners);
        emit ChallengeFinalized(challengeId, winners, item.payoutPerWinner);
    }

    function claimReward(uint256 challengeId) external nonReentrant {
        Challenge storage item = challenges[challengeId];
        require(item.finalized && winner[challengeId][msg.sender] && !claimed[challengeId][msg.sender], "nothing to claim");
        claimed[challengeId][msg.sender] = true;
        IERC20Zenith(item.token).safeTransfer(msg.sender, item.payoutPerWinner);
        emit RewardClaimed(challengeId, msg.sender, item.payoutPerWinner);
    }

    function participants(uint256 challengeId) external view returns (address[] memory) {
        return _participants[challengeId];
    }
}

contract GroupTab is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    struct Group {
        address token;
        string name;
        uint64 createdAt;
        uint16 memberCount;
        uint32 expenseCount;
    }

    uint256 public groupCount;
    mapping(uint256 => Group) public groups;
    mapping(uint256 => address[]) private _members;
    mapping(uint256 => mapping(address => bool)) public isMember;
    mapping(uint256 => mapping(address => string)) public nickname;
    mapping(uint256 => mapping(address => int256)) public balance;

    event GroupCreated(uint256 indexed groupId, string name, address token);
    event ExpenseAdded(uint256 indexed groupId, uint256 indexed expenseId, address indexed payer, uint256 amount, string memo);
    event Settled(uint256 indexed groupId, address indexed debtor, address indexed creditor, uint256 amount);

    function createDemoTrip(address token, address friendA, address friendB)
        external
        whenNotPaused
        returns (uint256 groupId)
    {
        require(token != address(0) && friendA != address(0) && friendB != address(0), "bad demo members");
        require(friendA != friendB && friendA != msg.sender && friendB != msg.sender, "duplicate demo member");
        groupId = ++groupCount;
        groups[groupId] = Group(token, "Lisbon demo trip", uint64(block.timestamp), 3, 2);
        address[3] memory demoMembers = [msg.sender, friendA, friendB];
        string[3] memory demoNames = ["You", "Maya", "Leo"];
        for (uint256 i; i < 3; ++i) {
            isMember[groupId][demoMembers[i]] = true;
            nickname[groupId][demoMembers[i]] = demoNames[i];
            _members[groupId].push(demoMembers[i]);
        }
        uint256 unit = 10 ** 6;
        balance[groupId][msg.sender] = -int256(172 * unit);
        balance[groupId][friendA] = int256(248 * unit);
        balance[groupId][friendB] = -int256(76 * unit);
        emit GroupCreated(groupId, "Lisbon demo trip", token);
        emit ExpenseAdded(groupId, 1, friendA, 420 * unit, "Hotel - 3 nights");
        emit ExpenseAdded(groupId, 2, friendB, 96 * unit, "Dinner - Bairro Alto");
    }

    function createGroup(
        string calldata name,
        address token,
        address[] calldata memberAccounts,
        string[] calldata nicknames
    ) external whenNotPaused returns (uint256 groupId) {
        require(token != address(0) && memberAccounts.length > 1 && memberAccounts.length <= 20, "bad group");
        require(memberAccounts.length == nicknames.length, "length mismatch");
        groupId = ++groupCount;
        groups[groupId] = Group(token, name, uint64(block.timestamp), uint16(memberAccounts.length), 0);
        bool creatorIncluded;
        for (uint256 i; i < memberAccounts.length; ++i) {
            address member = memberAccounts[i];
            require(member != address(0) && !isMember[groupId][member], "bad member");
            isMember[groupId][member] = true;
            nickname[groupId][member] = nicknames[i];
            _members[groupId].push(member);
            if (member == msg.sender) creatorIncluded = true;
        }
        require(creatorIncluded, "creator missing");
        emit GroupCreated(groupId, name, token);
    }

    function addExpense(
        uint256 groupId,
        address payer,
        uint128 amount,
        address[] calldata beneficiaries,
        string calldata memo
    ) external whenNotPaused {
        Group storage group = groups[groupId];
        require(isMember[groupId][msg.sender] && isMember[groupId][payer], "member only");
        require(amount > 0 && beneficiaries.length > 0 && beneficiaries.length <= group.memberCount, "bad expense");
        uint256 share = uint256(amount) / beneficiaries.length;
        uint256 remainder = uint256(amount) % beneficiaries.length;
        require(share > 0, "expense too small");
        balance[groupId][payer] += int256(uint256(amount));
        for (uint256 i; i < beneficiaries.length; ++i) {
            require(isMember[groupId][beneficiaries[i]], "unknown beneficiary");
            balance[groupId][beneficiaries[i]] -= int256(share + (i == 0 ? remainder : 0));
        }
        group.expenseCount += 1;
        emit ExpenseAdded(groupId, group.expenseCount, payer, amount, memo);
    }

    function settleUp(uint256 groupId) external whenNotPaused nonReentrant {
        Group storage group = groups[groupId];
        int256 current = balance[groupId][msg.sender];
        require(current < 0, "no debt");
        uint256 debt = uint256(-current);
        address[] storage memberList = _members[groupId];
        for (uint256 i; i < memberList.length && debt > 0; ++i) {
            address creditor = memberList[i];
            int256 credit = balance[groupId][creditor];
            if (credit <= 0) continue;
            uint256 payment = uint256(credit) < debt ? uint256(credit) : debt;
            balance[groupId][msg.sender] += int256(payment);
            balance[groupId][creditor] -= int256(payment);
            debt -= payment;
            IERC20Zenith(group.token).safeTransferFrom(msg.sender, creditor, payment);
            emit Settled(groupId, msg.sender, creditor, payment);
        }
    }

    function members(uint256 groupId) external view returns (address[] memory) {
        return _members[groupId];
    }
}

interface IDemoYieldToken is IERC20Zenith {
    function mintYield(address to, uint256 amount) external;
}

contract MockTBondVault is Managed, ReentrancyLock {
    using SafeToken for IERC20Zenith;

    string public constant name = "Zenith Micro T-Bond Share";
    string public constant symbol = "zTBILL";
    uint8 public constant decimals = 6;
    uint256 public constant NORMAL_RATE_PER_SECOND = 4_756_468_797; // ~15% simple APY
    uint256 public constant DEMO_RATE_PER_SECOND = 166_666_666_666_666; // 1% per minute

    IDemoYieldToken public immutable asset;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public baseIndex = 1e18;
    uint64 public indexStartedAt;
    bool public demoMode;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Deposit(address indexed caller, address indexed owner, uint256 assets, uint256 shares);
    event Withdraw(address indexed caller, address indexed receiver, address indexed owner, uint256 assets, uint256 shares);
    event YieldModeChanged(bool demoMode, uint256 index);

    constructor(address assetAddress, bool startInDemoMode) {
        require(assetAddress != address(0), "zero asset");
        asset = IDemoYieldToken(assetAddress);
        demoMode = startInDemoMode;
        indexStartedAt = uint64(block.timestamp);
    }

    function ratePerSecond() public view returns (uint256) {
        return demoMode ? DEMO_RATE_PER_SECOND : NORMAL_RATE_PER_SECOND;
    }

    function sharePrice() public view returns (uint256) {
        return baseIndex + (block.timestamp - indexStartedAt) * ratePerSecond();
    }

    function totalAssets() public view returns (uint256) {
        return totalSupply * sharePrice() / 1e18;
    }

    function previewDeposit(uint256 assets) public view returns (uint256) {
        return assets * 1e18 / sharePrice();
    }

    function previewRedeem(uint256 shares) public view returns (uint256) {
        return shares * sharePrice() / 1e18;
    }

    function deposit(uint256 assets, address receiver) external whenNotPaused nonReentrant returns (uint256 shares) {
        require(assets > 0 && receiver != address(0), "bad deposit");
        shares = previewDeposit(assets);
        require(shares > 0, "zero shares");
        IERC20Zenith(address(asset)).safeTransferFrom(msg.sender, address(this), assets);
        totalSupply += shares;
        balanceOf[receiver] += shares;
        emit Transfer(address(0), receiver, shares);
        emit Deposit(msg.sender, receiver, assets, shares);
    }

    function redeem(uint256 shares, address receiver, address shareOwner)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        require(shares > 0 && receiver != address(0), "bad redeem");
        if (msg.sender != shareOwner) {
            uint256 allowed = allowance[shareOwner][msg.sender];
            require(allowed >= shares, "allowance");
            if (allowed != type(uint256).max) allowance[shareOwner][msg.sender] = allowed - shares;
        }
        require(balanceOf[shareOwner] >= shares, "shares");
        assets = previewRedeem(shares);
        balanceOf[shareOwner] -= shares;
        totalSupply -= shares;
        emit Transfer(shareOwner, address(0), shares);
        uint256 liquid = asset.balanceOf(address(this));
        if (liquid < assets) asset.mintYield(address(this), assets - liquid);
        IERC20Zenith(address(asset)).safeTransfer(receiver, assets);
        emit Withdraw(msg.sender, receiver, shareOwner, assets, shares);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "allowance");
        if (allowed != type(uint256).max) allowance[from][msg.sender] = allowed - amount;
        _transfer(from, to, amount);
        return true;
    }

    function setDemoMode(bool enabled) external onlyOwner {
        baseIndex = sharePrice();
        indexStartedAt = uint64(block.timestamp);
        demoMode = enabled;
        emit YieldModeChanged(enabled, baseIndex);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0) && balanceOf[from] >= amount, "bad transfer");
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }
}
