// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.26;

/**
 * @title SuperAuth - Decentralized Credential Management System
 * @notice Issues, updates, revokes, and verifies credentials with full IPFS integration and history tracking
 * @dev Maintains backward compatibility with the original SuperAuth contract
 *
 * Architecture:
 *   - Government wallet sets authorities per credential type
 *   - Authorities issue/update/revoke credentials via signature verification
 *   - Each credential stores an IPFS CID pointing to raw data
 *   - Full version history is maintained on-chain
 *   - Revoked credentials remain permanently stored with reason
 */
contract SuperAuth {

    // ═══════════════════════════════════════════════════════════════
    // ORIGINAL STATE (preserved for backward compatibility)
    // ═══════════════════════════════════════════════════════════════

    uint storedData;
    address private government;
    mapping(address => mapping(bytes32 => bytes32)) public credentials;
    mapping(bytes32 => address) public authorities;

    // ═══════════════════════════════════════════════════════════════
    // NEW STRUCTS
    // ═══════════════════════════════════════════════════════════════

    /// @notice A single version snapshot of a credential
    struct CredentialVersion {
        bytes32 credentialHash;   // keccak256 hash of the credential data
        string  ipfsCid;         // IPFS CID pointing to raw data JSON
        address authority;       // Authority that wrote this version
        uint256 timestamp;       // Block timestamp of this version
    }

    /// @notice Full record for one (user, credentialType) pair
    struct CredentialRecord {
        bool    exists;              // Whether this credential has ever been issued
        bool    revoked;             // Whether the credential is currently revoked
        string  revocationReason;    // Reason for revocation (empty if not revoked)
        uint256 revocationTimestamp; // Timestamp of revocation (0 if not revoked)
        address revocationAuthority; // Authority who revoked (address(0) if not revoked)
        CredentialVersion[] versions; // Complete history of all versions
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW STATE
    // ═══════════════════════════════════════════════════════════════

    /// @notice Full credential records: user => credentialType => CredentialRecord
    mapping(address => mapping(bytes32 => CredentialRecord)) private credentialRecords;

    /// @notice Track all credential types a user has received
    mapping(address => bytes32[]) private userCredentialTypes;

    // ═══════════════════════════════════════════════════════════════
    // EVENTS
    // ═══════════════════════════════════════════════════════════════

    event CredentialIssued(
        address indexed user,
        bytes32 indexed credentialType,
        bytes32 credentialHash,
        string  ipfsCid,
        address authority,
        uint256 timestamp
    );

    event CredentialUpdated(
        address indexed user,
        bytes32 indexed credentialType,
        bytes32 newHash,
        string  newCid,
        bytes32 previousHash,
        uint256 version,
        uint256 timestamp
    );

    event CredentialRevoked(
        address indexed user,
        bytes32 indexed credentialType,
        string  reason,
        address authority,
        uint256 timestamp
    );

    // ═══════════════════════════════════════════════════════════════
    // CONSTRUCTOR (original, unchanged)
    // ═══════════════════════════════════════════════════════════════

    constructor(address _government) {
        government = _government;
    }

    function get() public view returns (uint) {
        return storedData;
    }

    function setAuthority(bytes32 credentialType, address authority) public {
        require(msg.sender == government, "Only government");
        authorities[credentialType] = authority;
    }

    /**
     * @notice Original issueCredential — kept for backward compatibility
     * @dev Still writes to the legacy `credentials` mapping.
     *      For full features (IPFS, history) use issueCredentialV2.
     */
    function issueCredential(
        address user,
        bytes32 credentialType,
        bytes32 credentialHash,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        bytes32 messageHash = keccak256(
            abi.encodePacked(user, credentialType, credentialHash, address(this))
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        address signer = ecrecover(ethSignedHash, v, r, s);
        require(signer == authorities[credentialType], "Invalid signer");

        credentials[user][credentialType] = credentialHash;
    }

    function getCredentialHash(address user, bytes32 credentialType) public view returns (bytes32) {
        return credentials[user][credentialType];
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: ISSUE CREDENTIAL V2 (with IPFS CID + history)
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Issue a new credential with IPFS CID storage and full history tracking
     * @param user          Wallet address of the credential holder
     * @param credentialType keccak256 hash of the credential category (e.g. "PERSONAL")
     * @param credentialHash keccak256 hash of the raw credential data
     * @param ipfsCid       IPFS CID where the raw data JSON is pinned
     * @param v             Signature recovery id
     * @param r             Signature r component
     * @param s             Signature s component
     */
    function issueCredentialV2(
        address user,
        bytes32 credentialType,
        bytes32 credentialHash,
        string calldata ipfsCid,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        // Verify authority signature (same replay-protected scheme)
        bytes32 messageHash = keccak256(
            abi.encodePacked(user, credentialType, credentialHash, address(this))
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        address signer = ecrecover(ethSignedHash, v, r, s);
        require(signer == authorities[credentialType], "Invalid signer");

        CredentialRecord storage record = credentialRecords[user][credentialType];
        require(!record.exists, "Credential already exists, use update");

        // Write legacy mapping for backward compatibility
        credentials[user][credentialType] = credentialHash;

        // Build new version
        record.exists = true;
        record.versions.push(CredentialVersion({
            credentialHash: credentialHash,
            ipfsCid: ipfsCid,
            authority: signer,
            timestamp: block.timestamp
        }));

        // Track credential type for user
        userCredentialTypes[user].push(credentialType);

        emit CredentialIssued(user, credentialType, credentialHash, ipfsCid, signer, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: UPDATE CREDENTIAL
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Update an existing credential with new data. Only the original authority can update.
     * @dev Pushes a new version; previous versions remain in history.
     */
    function updateCredential(
        address user,
        bytes32 credentialType,
        bytes32 newCredentialHash,
        string calldata newIpfsCid,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) public {
        CredentialRecord storage record = credentialRecords[user][credentialType];
        require(record.exists, "Credential does not exist");
        require(!record.revoked, "Credential is revoked");

        // Verify signature
        bytes32 messageHash = keccak256(
            abi.encodePacked(user, credentialType, newCredentialHash, address(this))
        );
        bytes32 ethSignedHash = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash)
        );
        address signer = ecrecover(ethSignedHash, v, r, s);
        require(signer == authorities[credentialType], "Invalid signer");

        // Only original issuing authority can update
        require(signer == record.versions[0].authority, "Only original authority can update");

        // Store previous hash for event
        bytes32 previousHash = record.versions[record.versions.length - 1].credentialHash;

        // Push new version
        record.versions.push(CredentialVersion({
            credentialHash: newCredentialHash,
            ipfsCid: newIpfsCid,
            authority: signer,
            timestamp: block.timestamp
        }));

        // Update legacy mapping
        credentials[user][credentialType] = newCredentialHash;

        emit CredentialUpdated(
            user,
            credentialType,
            newCredentialHash,
            newIpfsCid,
            previousHash,
            record.versions.length,
            block.timestamp
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: REVOKE CREDENTIAL
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Revoke a credential permanently. Only the credential's authority can revoke.
     * @dev Credential data remains on-chain; the revoked flag prevents further updates.
     */
    function revokeCredential(
        address user,
        bytes32 credentialType,
        string calldata reason
    ) public {
        CredentialRecord storage record = credentialRecords[user][credentialType];
        require(record.exists, "Credential does not exist");
        require(!record.revoked, "Already revoked");

        // Only the authority assigned to this credential type can revoke
        require(
            msg.sender == authorities[credentialType],
            "Only assigned authority can revoke"
        );
        // Must be the same authority that originally issued
        require(
            msg.sender == record.versions[0].authority,
            "Only original authority can revoke"
        );

        record.revoked = true;
        record.revocationReason = reason;
        record.revocationTimestamp = block.timestamp;
        record.revocationAuthority = msg.sender;

        emit CredentialRevoked(user, credentialType, reason, msg.sender, block.timestamp);
    }

    // ═══════════════════════════════════════════════════════════════
    // NEW: READ / QUERY FUNCTIONS
    // ═══════════════════════════════════════════════════════════════

    /**
     * @notice Get the latest version of a credential
     * @return credentialHash  Latest hash
     * @return ipfsCid         Latest IPFS CID
     * @return authority        Authority address
     * @return timestamp        Timestamp of latest version
     * @return revoked          Whether credential is revoked
     * @return version          Current version number (1-indexed)
     */
    function getCredential(
        address user,
        bytes32 credentialType
    ) public view returns (
        bytes32 credentialHash,
        string memory ipfsCid,
        address authority,
        uint256 timestamp,
        bool revoked,
        uint256 version
    ) {
        CredentialRecord storage record = credentialRecords[user][credentialType];
        require(record.exists, "Credential does not exist");

        uint256 len = record.versions.length;
        CredentialVersion storage latest = record.versions[len - 1];

        return (
            latest.credentialHash,
            latest.ipfsCid,
            latest.authority,
            latest.timestamp,
            record.revoked,
            len
        );
    }

    /**
     * @notice Alias for getCredential — returns only the latest version data
     */
    function getLatestCredential(
        address user,
        bytes32 credentialType
    ) public view returns (
        bytes32 credentialHash,
        string memory ipfsCid,
        address authority,
        uint256 timestamp,
        bool revoked,
        uint256 version
    ) {
        return getCredential(user, credentialType);
    }

    /**
     * @notice Get a specific version of a credential
     * @param versionIndex 0-indexed version number
     */
    function getCredentialVersion(
        address user,
        bytes32 credentialType,
        uint256 versionIndex
    ) public view returns (
        bytes32 credentialHash,
        string memory ipfsCid,
        address authority,
        uint256 timestamp
    ) {
        CredentialRecord storage record = credentialRecords[user][credentialType];
        require(record.exists, "Credential does not exist");
        require(versionIndex < record.versions.length, "Version out of range");

        CredentialVersion storage ver = record.versions[versionIndex];
        return (ver.credentialHash, ver.ipfsCid, ver.authority, ver.timestamp);
    }

    /**
     * @notice Get the full history arrays for a credential
     * @return hashes     Array of all credential hashes across versions
     * @return cids       Array of all IPFS CIDs across versions
     * @return timestamps Array of all version timestamps
     * @return auths      Array of all authority addresses per version
     */
    function getCredentialHistory(
        address user,
        bytes32 credentialType
    ) public view returns (
        bytes32[] memory hashes,
        string[]  memory cids,
        uint256[] memory timestamps,
        address[] memory auths
    ) {
        CredentialRecord storage record = credentialRecords[user][credentialType];
        require(record.exists, "Credential does not exist");

        uint256 len = record.versions.length;
        hashes     = new bytes32[](len);
        cids       = new string[](len);
        timestamps = new uint256[](len);
        auths      = new address[](len);

        for (uint256 i = 0; i < len; i++) {
            hashes[i]     = record.versions[i].credentialHash;
            cids[i]       = record.versions[i].ipfsCid;
            timestamps[i] = record.versions[i].timestamp;
            auths[i]      = record.versions[i].authority;
        }
    }

    /**
     * @notice Check whether a credential is currently valid (exists and not revoked)
     */
    function isCredentialValid(
        address user,
        bytes32 credentialType
    ) public view returns (bool) {
        CredentialRecord storage record = credentialRecords[user][credentialType];
        return record.exists && !record.revoked;
    }

    /**
     * @notice Get the total number of versions for a credential
     */
    function getCredentialVersionCount(
        address user,
        bytes32 credentialType
    ) public view returns (uint256) {
        return credentialRecords[user][credentialType].versions.length;
    }

    /**
     * @notice Get revocation details for a credential
     */
    function getRevocationInfo(
        address user,
        bytes32 credentialType
    ) public view returns (
        bool    revoked,
        string memory reason,
        uint256 timestamp,
        address authority
    ) {
        CredentialRecord storage record = credentialRecords[user][credentialType];
        return (record.revoked, record.revocationReason, record.revocationTimestamp, record.revocationAuthority);
    }

    /**
     * @notice Get all credential type hashes a user has been issued
     */
    function getUserCredentialTypes(address user) public view returns (bytes32[] memory) {
        return userCredentialTypes[user];
    }

    /**
     * @notice Verify whether a given hash matches the latest stored credential hash
     */
    function verifyCredentialHash(
        address user,
        bytes32 credentialType,
        bytes32 hashToVerify
    ) public view returns (bool) {
        CredentialRecord storage record = credentialRecords[user][credentialType];
        if (!record.exists || record.versions.length == 0) return false;
        return record.versions[record.versions.length - 1].credentialHash == hashToVerify;
    }
}