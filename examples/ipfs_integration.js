/**
 * SuperAuth V2 — IPFS Integration Example
 * 
 * This file demonstrates the complete flow of:
 *   1. Preparing credential data
 *   2. Pinning to IPFS via Pinata
 *   3. Computing the keccak256 hash
 *   4. Issuing the credential on-chain via issueCredentialV2
 * 
 * Prerequisites:
 *   npm install axios ethers dotenv
 *   Set PINATA_API_KEY, PINATA_SECRET_KEY, and QUAI_PRIVATE_KEY in .env
 * 
 * Usage:
 *   node examples/ipfs_integration.js
 */

const axios = require('axios');
const { ethers } = require('ethers');
require('dotenv').config();

// ═══════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════

const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;
const RPC_URL = 'https://orchard.rpc.quai.network/cyprus1';
const PRIVATE_KEY = process.env.QUAI_PRIVATE_KEY;
const CONTRACT_ADDRESS = '0x005c956Ad47da754EAF6364F92B09a30530E5a19'; // ← update after deploy

// Minimal ABI for issueCredentialV2
const ABI = [
    'function issueCredentialV2(address user, bytes32 credentialType, bytes32 credentialHash, string ipfsCid, uint8 v, bytes32 r, bytes32 s) external',
    'function authorities(bytes32) view returns (address)'
];

// ═══════════════════════════════════════════════════════════
// STEP 1: Prepare Credential Data
// ═══════════════════════════════════════════════════════════

const credentialData = {
    name: "Anmol Sarkar",
    dob: "2000-01-01",
    birthplace: "Pune",
    father: "Joydeep Sarkar",
    mother: "Sampa Sarkar",
    gender: "male",
    citizenship: "Indian",
    main_address: "Pune",
    married: "false",
    spouse: "",
    // Additional metadata
    issued_at: new Date().toISOString(),
    schema_version: "2.0"
};

const USER_ADDRESS = '0x0076FeE06D650B33988addDee6A4a2f9A474112e';
const CREDENTIAL_TYPE = 'PERSONAL';

// ═══════════════════════════════════════════════════════════
// STEP 2: Pin to IPFS
// ═══════════════════════════════════════════════════════════

async function pinToIPFS(data) {
    console.log('\n📦 Step 2: Pinning credential data to IPFS via Pinata...');

    if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
        console.log('⚠️  Pinata keys not set. Skipping IPFS pinning.');
        console.log('   Set PINATA_API_KEY and PINATA_SECRET_KEY in .env');
        console.log('   Get free keys at: https://app.pinata.cloud/register');
        return 'QmPLACEHOLDER_replace_with_real_cid_after_pinning';
    }

    const response = await axios.post(
        'https://api.pinata.cloud/pinning/pinJSONToIPFS',
        {
            pinataContent: data,
            pinataMetadata: {
                name: `superauth_${CREDENTIAL_TYPE}_${USER_ADDRESS.slice(0, 8)}`
            },
            pinataOptions: {
                cidVersion: 0  // Use CIDv0 (Qm... format) for simplicity
            }
        },
        {
            headers: {
                'Content-Type': 'application/json',
                'pinata_api_key': PINATA_API_KEY,
                'pinata_secret_api_key': PINATA_SECRET_KEY
            }
        }
    );

    const cid = response.data.IpfsHash;
    console.log('✅ Pinned to IPFS!');
    console.log('   CID:', cid);
    console.log('   View: https://ipfs.io/ipfs/' + cid);
    return cid;
}

// ═══════════════════════════════════════════════════════════
// STEP 3: Compute Hash
// ═══════════════════════════════════════════════════════════

function computeHash(data) {
    console.log('\n🔒 Step 3: Computing Keccak256 hash...');

    const jsonStr = JSON.stringify(data);
    const hash = ethers.keccak256(ethers.toUtf8Bytes(jsonStr));

    console.log('   JSON string:', jsonStr.slice(0, 60) + '...');
    console.log('   Keccak256:  ', hash);
    return hash;
}

// ═══════════════════════════════════════════════════════════
// STEP 4: Issue On-Chain
// ═══════════════════════════════════════════════════════════

async function issueOnChain(user, typeStr, hash, cid) {
    console.log('\n📡 Step 4: Issuing credential on-chain...');

    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
    const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

    const credentialTypeHash = ethers.keccak256(ethers.toUtf8Bytes(typeStr));

    console.log('   Signer:', wallet.address);
    console.log('   Type hash:', credentialTypeHash);

    // Check authority
    const registeredAuthority = await contract.authorities(credentialTypeHash);
    console.log('   Registered authority:', registeredAuthority);

    if (registeredAuthority.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error(`Signer ${wallet.address} is not the registered authority (${registeredAuthority})`);
    }

    // Create replay-protected message hash
    const messageHash = ethers.solidityPackedKeccak256(
        ['address', 'bytes32', 'bytes32', 'address'],
        [user, credentialTypeHash, hash, CONTRACT_ADDRESS]
    );

    // Sign with EIP-191 prefix
    const signature = wallet.signingKey.sign(ethers.hashMessage(ethers.getBytes(messageHash)));

    console.log('   Signature v:', signature.v);

    // Send transaction
    const tx = await contract.issueCredentialV2(
        user,
        credentialTypeHash,
        hash,
        cid,
        signature.v,
        signature.r,
        signature.s
    );

    console.log('   Tx hash:', tx.hash);
    console.log('   Waiting for confirmation...');

    const receipt = await tx.wait();
    console.log('✅ Credential issued on-chain!');
    console.log('   Block:', receipt.blockNumber);
    console.log('   Gas used:', receipt.gasUsed.toString());

    return tx.hash;
}

// ═══════════════════════════════════════════════════════════
// MAIN FLOW
// ═══════════════════════════════════════════════════════════

async function main() {
    console.log('═══════════════════════════════════════════');
    console.log('  SuperAuth V2 — IPFS Integration Example');
    console.log('═══════════════════════════════════════════');

    // Step 1
    console.log('\n📋 Step 1: Credential data prepared');
    console.log('   User:', USER_ADDRESS);
    console.log('   Type:', CREDENTIAL_TYPE);
    console.log('   Fields:', Object.keys(credentialData).join(', '));

    // Step 2
    const cid = await pinToIPFS(credentialData);

    // Step 3
    const hash = computeHash(credentialData);

    // Step 4
    const txHash = await issueOnChain(USER_ADDRESS, CREDENTIAL_TYPE, hash, cid);

    console.log('\n═══════════════════════════════════════════');
    console.log('  ✅ Complete! Credential issued with IPFS');
    console.log('═══════════════════════════════════════════');
    console.log('  User:     ', USER_ADDRESS);
    console.log('  Type:     ', CREDENTIAL_TYPE);
    console.log('  IPFS CID: ', cid);
    console.log('  Hash:     ', hash);
    console.log('  Tx:       ', txHash);
    console.log('  IPFS URL: ', 'https://ipfs.io/ipfs/' + cid);
    console.log('═══════════════════════════════════════════\n');
}

main().catch(err => {
    console.error('\n❌ Error:', err.message || err);
    process.exit(1);
});
