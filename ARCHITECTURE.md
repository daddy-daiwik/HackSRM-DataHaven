# SuperAuth V2 — Architecture & Workflow Documentation

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Smart Contract Design](#smart-contract-design)
3. [Workflow — Issuing a Credential](#workflow-issuing)
4. [Workflow — Updating a Credential](#workflow-updating)
5. [Workflow — Revoking a Credential](#workflow-revoking)
6. [Workflow — Verifying a Credential](#workflow-verifying)
7. [Website Architecture](#website-architecture)
8. [IPFS Integration](#ipfs-integration)
9. [Security Model](#security-model)
10. [Gas Optimization](#gas-optimization)
11. [Deployment Guide](#deployment-guide)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SuperAuth V2 System                         │
├──────────────────┬──────────────────┬───────────────────────────────┤
│    Frontend      │     Backend      │       Blockchain              │
│  (Browser)       │   (Express.js)   │    (Quai Network)             │
│                  │                  │                               │
│  ┌────────────┐  │  ┌────────────┐  │  ┌─────────────────────────┐  │
│  │ MetaMask   │──┼──│ /api/pin   │──┼──│  SuperAuth Contract     │  │
│  │ + ethers.js│  │  │ /api/ipfs  │  │  │  ├── issueCredentialV2  │  │
│  │            │  │  │ /api/hash  │  │  │  ├── updateCredential   │  │
│  └────────────┘  │  └─────┬──────┘  │  │  ├── revokeCredential   │  │
│                  │        │         │  │  ├── getCredential       │  │
│                  │        ▼         │  │  ├── getHistory          │  │
│                  │  ┌────────────┐  │  │  └── verifyHash         │  │
│                  │  │   Pinata   │  │  └─────────────────────────┘  │
│                  │  │   (IPFS)   │  │                               │
│                  │  └────────────┘  │                               │
└──────────────────┴──────────────────┴───────────────────────────────┘
```

### Component Roles

| Component | Role |
|-----------|------|
| **Frontend** | MetaMask connection, UI for all user roles (user, authority, verifier) |
| **Backend** | IPFS pinning via Pinata, data hashing, serves frontend static files |
| **Smart Contract** | On-chain credential storage, signature verification, history tracking |
| **IPFS (Pinata)** | Stores raw credential data JSON, referenced by CID on-chain |

---

## 2. Smart Contract Design

### Data Structures

```solidity
// Single version snapshot
struct CredentialVersion {
    bytes32 credentialHash;   // keccak256 of the raw data
    string  ipfsCid;          // IPFS CID pointing to the raw JSON
    address authority;        // Authority that created this version
    uint256 timestamp;        // Block timestamp
}

// Full credential record
struct CredentialRecord {
    bool    exists;
    bool    revoked;
    string  revocationReason;
    uint256 revocationTimestamp;
    address revocationAuthority;
    CredentialVersion[] versions;  // Complete history
}
```

### Storage Layout

```
credentials[user][type] = bytes32 hash          (legacy V1 — backward compatible)
credentialRecords[user][type] = CredentialRecord (V2 — full features)
userCredentialTypes[user] = bytes32[]            (all types per user)
authorities[type] = address                      (authority registry)
```

### Function Summary

| Function | Access | Purpose |
|----------|--------|---------|
| `setAuthority()` | Government only | Register authority for a credential type |
| `issueCredential()` | Authority (V1) | Legacy issuance — hash only |
| `issueCredentialV2()` | Authority | Issue with IPFS CID + history tracking |
| `updateCredential()` | Original authority | Push new version, preserve history |
| `revokeCredential()` | Original authority | Mark credential as revoked with reason |
| `getCredential()` | Public | Get latest version details |
| `getCredentialHistory()` | Public | Get all versions (hashes, CIDs, timestamps) |
| `isCredentialValid()` | Public | Check if credential exists and is not revoked |
| `verifyCredentialHash()` | Public | Verify a hash matches on-chain record |
| `getRevocationInfo()` | Public | Get revocation details |
| `getUserCredentialTypes()` | Public | List all credential types for a user |

---

## 3. Workflow — Issuing a Credential

```
Authority                    IPFS (Pinata)              Smart Contract
   │                             │                          │
   │ 1. Prepare JSON data        │                          │
   │ ──────────────────►         │                          │
   │                             │                          │
   │ 2. Pin JSON to IPFS         │                          │
   │ ────────────────────────►   │                          │
   │         ◄── CID returned    │                          │
   │                             │                          │
   │ 3. Compute keccak256(JSON)  │                          │
   │ (local computation)         │                          │
   │                             │                          │
   │ 4. Sign message:            │                          │
   │    hash(user, type, hash,   │                          │
   │         contractAddress)    │                          │
   │                             │                          │
   │ 5. Call issueCredentialV2   │                          │
   │ ──────────────────────────────────────────────────►    │
   │                             │    6. Verify signature   │
   │                             │    7. Store record       │
   │                             │    8. Emit event         │
   │         ◄── tx confirmed    │                          │
   │                             │                          │
```

### Code Flow (Frontend)

```javascript
// 1. Hash credential data
const hash = ethers.keccak256(ethers.toUtf8Bytes(JSON.stringify(data)));

// 2. Create replay-protected message
const messageHash = ethers.solidityPackedKeccak256(
    ['address', 'bytes32', 'bytes32', 'address'],
    [user, typeHash, hash, CONTRACT_ADDRESS]
);

// 3. Sign with EIP-191 prefix
const signature = signer.signingKey.sign(
    ethers.hashMessage(ethers.getBytes(messageHash))
);

// 4. Send transaction
await contract.issueCredentialV2(
    user, typeHash, hash, ipfsCid,
    signature.v, signature.r, signature.s
);
```

---

## 4. Workflow — Updating a Credential

Same signing process as issuance, but calls `updateCredential()`. The contract:

1. Verifies the credential exists and is not revoked
2. Verifies the signer is the original issuing authority
3. Pushes a new `CredentialVersion` onto the `versions` array
4. Updates the legacy `credentials` mapping
5. Emits `CredentialUpdated` event with `previousHash`

**Key: Previous versions are NEVER deleted** — full history is preserved on-chain.

---

## 5. Workflow — Revoking a Credential

```javascript
// Authority calls directly (no signature needed — msg.sender check)
await contract.revokeCredential(user, typeHash, "Document expired");
```

The contract:

1. Verifies the credential exists and is not already revoked
2. Verifies `msg.sender == authorities[type]` AND `msg.sender == original authority`
3. Sets `revoked = true`, stores reason and timestamp
4. Emits `CredentialRevoked` event
5. **Credential data remains permanently stored** — it's just flagged

---

## 6. Workflow — Verifying a Credential

Anyone can verify without connecting a wallet:

```
Verifier                         Smart Contract
   │                                 │
   │ 1. Enter wallet + type          │
   │ ──────────────────────────►     │
   │                                 │
   │ 2. isCredentialValid()          │
   │      → returns true/false       │
   │                                 │
   │ 3. getCredential()              │
   │      → hash, CID, authority,    │
   │        timestamp, version       │
   │                                 │
   │ 4. (Optional) Verify data hash  │
   │    verifyCredentialHash()       │
   │      → true if hash matches     │
   │                                 │
   │ 5. (Optional) Fetch IPFS data   │
   │    https://ipfs.io/ipfs/{CID}   │
   │                                 │
```

### Hash Verification

The verifier can paste raw JSON data, and the frontend computes `keccak256` locally, then calls `verifyCredentialHash()` on-chain to confirm the data hasn't been tampered with.

---

## 7. Website Architecture

```
frontend/
├── index.html      ← Single-page app (all tabs)
├── styles.css      ← Design system (dark theme, glassmorphism)
├── contract.js     ← ABI + contract config
└── app.js          ← Application logic

backend/
└── server.js       ← Express API + IPFS pinning

examples/
└── ipfs_integration.js  ← End-to-end issuance example
```

### Tab Structure

| Tab | Purpose | Requires Wallet |
|-----|---------|:---:|
| **Dashboard** | View all credentials linked to connected wallet | ✅ |
| **Issue** | Authority issues new credentials | ✅ |
| **Manage** | Authority updates/revokes credentials | ✅ |
| **Verify** | Public verification by any wallet address | ❌ |

### Design System

- **Theme**: Premium dark with glassmorphism
- **Colors**: Indigo (#6366f1) + Cyan (#06b6d4) gradient
- **Font**: Inter (Google Fonts)
- **Animations**: Floating background glows, fade-in transitions, hover effects
- **Responsive**: Fully responsive down to mobile

---

## 8. IPFS Integration

### Pinning via Pinata (Free Tier)

1. Sign up at [pinata.cloud](https://app.pinata.cloud/register)
2. Get API key and secret
3. Add to `.env`:
   ```
   PINATA_API_KEY=your_key
   PINATA_SECRET_KEY=your_secret
   ```
4. Use the backend `/api/pin` endpoint or the `examples/ipfs_integration.js` script

### Data Flow

```
Raw JSON → Pin to IPFS → Get CID → Store CID on-chain → Verify via gateway
                                         │
                                    keccak256(JSON) stored as hash
                                    for integrity verification
```

### IPFS Gateways

- `https://ipfs.io/ipfs/{CID}` (default)
- `https://gateway.pinata.cloud/ipfs/{CID}` (Pinata)
- `https://cloudflare-ipfs.com/ipfs/{CID}` (Cloudflare)

---

## 9. Security Model

### Authentication

| Role | Auth Method |
|------|-------------|
| Government | Wallet address check (`msg.sender == government`) |
| Authority | ECDSA signature verification via `ecrecover` |
| User | Wallet ownership proved by connecting MetaMask |
| Verifier | No auth needed — read-only public data |

### Replay Protection

Messages include `address(this)` (contract address) in the signed hash, preventing replay attacks across contracts or chains:

```solidity
bytes32 messageHash = keccak256(
    abi.encodePacked(user, credentialType, credentialHash, address(this))
);
```

### Access Control

- **setAuthority**: Only `government` address
- **issueCredentialV2**: Only the registered authority for that credential type
- **updateCredential**: Only the **original** issuing authority
- **revokeCredential**: Only the **original** issuing authority (via `msg.sender`)
- **Read functions**: Public — anyone can verify

### Data Integrity

- Raw data is hashed using `keccak256` before going on-chain
- The hash can be verified against raw data at any time
- IPFS CIDs are content-addressed — changing data changes the CID
- Double verification: on-chain hash + IPFS CID

---

## 10. Gas Optimization

| Technique | Details |
|-----------|---------|
| `bytes32` for types | Credential types stored as `bytes32` hashes, not strings |
| `calldata` parameters | `string calldata` instead of `string memory` for IPFS CIDs |
| Packed encoding | `abi.encodePacked` for smaller hashes |
| Optimizer enabled | 1000 runs in Hardhat config |
| Minimal storage writes | Only append to arrays, never rewrite |

---

## 11. Deployment Guide

### Step 1: Deploy Contract

```bash
npx hardhat run scripts/deploy.js --network cyprus1
```

### Step 2: Update Contract Address

After deployment, update the address in:
- `frontend/contract.js` → `CONTRACT_ADDRESS`
- `examples/ipfs_integration.js` → `CONTRACT_ADDRESS`

### Step 3: Set Authority

Using `govt.js` or `govt.py`:
```bash
node scripts/govt.js
```

### Step 4: Start Backend

```bash
cd backend
npm install express cors axios dotenv
node server.js
```

### Step 5: Open Frontend

Navigate to `http://localhost:3001` in your browser, or open `frontend/index.html` directly.

### Step 6: Issue First Credential

1. Connect MetaMask (authority wallet)
2. Go to **Issue** tab
3. Enter user address, credential type, JSON data, IPFS CID
4. Click **Issue Credential**

---

## Environment Variables (.env)

```env
QUAI_PRIVATE_KEY=0x...          # Government/deployer private key
PINATA_API_KEY=your_key         # Pinata IPFS API key
PINATA_SECRET_KEY=your_secret   # Pinata IPFS secret key
PORT=3001                       # Backend server port
```
