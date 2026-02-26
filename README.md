# DataHaven: Unhackable Citizen Identity & Credential System

**Built by Team Daddy's Island**

DataHaven is a blockchain-based solution built on the **Quai Network** designed to create, modify, store, and verify all information about a citizen—from birth till death—in a completely tamper-proof and trustless manner.

---

## 🛑 The Problem

We looked at the current condition of our country and found deeply rooted systemic issues caused by the mismanagement, modification, and siloing of user data. A few prominent examples:

1. **Justice System Flaws**: People being wrongly convicted of crimes by police without proper, verifiable proof.
2. **Medical Fraud**: Hospitals inflating patient bills with unnecessary items to increase profits.
3. **Electoral Fraud**: Votes being cast under the names of deceased people or non-citizens.
4. **Political Opacity**: Zero transparency regarding the true background, criminal history, or financial records of election candidates.
5. **System Abuse**: Financially stable individuals generating fake caste or income certificates to exploit government benefits.
6. **Identity Tampering**: The creation of fake birth certificates to artificially lower ages for exams or employment.

This is just the tip of the iceberg. The root cause is always the same: **Centralized data can be modified without trace or consequence.**

## 💡 The Solution

To tackle all these problems at once, we built **DataHaven**. Everything a citizen does or achieves—from medical records to criminal history—is hashed, signed, and stored securely on-chain. 

No one can modify or read the state of the blockchain without proper administrative permissions, ensuring absolute data integrity.

### 🔐 3-Tier Permission Architecture

Our solution utilizes strict role-based access control:

1. **Government (Root)**: Has the ultimate authority to set and register specific "Authorities". The Government decides which entity has permission to modify which type of data (e.g., Medical Board for health records, Police for criminal records).
2. **Authorities (Managers)**: Entities (like hospitals or courts) that have permission to issue, view, manage, and revoke credentials for users within their specific jurisdiction.
3. **Users (Citizens)**: Can view their own data and request modifications. They cannot unilaterally alter their own records.

### ⚙️ How Data is Handled & Verified

1. **Raw Data**: All user data is structured in JSON format.
2. **Decentralized Storage**: To save gas and ensure massive scalability, the actual raw JSON data is stored off-chain securely in **DataHaven (StorageHub)**.
3. **On-Chain Hashing**: The JSON data is hashed using `keccak256`.
4. **Cryptographic Signatures**: The issuing Authority signs the hash with their wallet's private key. Both the hash and the signature are stored immutably on the Quai Network.
5. **Trustless Verification**: Anyone needing to verify the integrity of the data can recalculate the signer's address using the hash and the signature (`ecrecover`). If the recovered address matches the designated Authority's address, the data is 100% authentic and untampered.

By validating data using blockchain cryptography, all the current shortcomings of centralized record-keeping are solved.

---

## 🛠️ Tech Stack

- **Blockchain**: Quai Network (Cyprus-1 Testnet)
- **Smart Contracts**: Solidity ^0.8.26
- **Backend / Storage**: Node.js, Express, DataHaven (StorageHub SDK)
- **Frontend**: Vanilla HTML/CSS/JS, ethers.js, MetaMask
- **Cryptography**: ECDSA Signatures, keccak256 Hashing

---

## 🚀 Getting Started

Read the full technical breakdown in our [ARCHITECTURE.md](ARCHITECTURE.md).
