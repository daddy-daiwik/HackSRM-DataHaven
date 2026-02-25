/**
 * SuperAuth V2 — Backend Server (Real DataHaven Integration)
 * 
 * Express API that stores/retrieves credential data on the 
 * DataHaven decentralized storage network via the StorageHub SDK.
 * 
 * Environment variables (.env):
 *   DATAHAVEN_PRIVATE_KEY — 0x-prefixed hex private key for DataHaven testnet
 *   QUAI_PRIVATE_KEY      — Used for smart contract deployment (not needed here)
 *   PORT                  — Server port (default 3001)
 */

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve frontend
app.use(express.static(path.resolve(__dirname, '../frontend')));

const PORT = process.env.PORT || 3001;

// ═══════════════════════════════════════════════════════════
// LOCAL FALLBACK STORE (used only if SDK completely fails)
// ═══════════════════════════════════════════════════════════
const DATAHAVEN_DIR = path.resolve(__dirname, 'datahaven_store');
if (!fs.existsSync(DATAHAVEN_DIR)) fs.mkdirSync(DATAHAVEN_DIR, { recursive: true });

// File key → filename mapping (persisted alongside local store)
const FILE_KEY_MAP_PATH = path.join(DATAHAVEN_DIR, '_filekey_map.json');
let fileKeyMap = {};
try {
    if (fs.existsSync(FILE_KEY_MAP_PATH)) {
        fileKeyMap = JSON.parse(fs.readFileSync(FILE_KEY_MAP_PATH, 'utf8'));
    }
} catch { /* start fresh */ }

function saveFileKeyMap() {
    fs.writeFileSync(FILE_KEY_MAP_PATH, JSON.stringify(fileKeyMap, null, 2), 'utf8');
}

// ═══════════════════════════════════════════════════════════
// DATAHAVEN SDK STATE
// ═══════════════════════════════════════════════════════════
let sdkReady = false;
let mspClient = null;
let sessionToken = undefined;
let walletClient = null;
let publicClient = null;
let storageHubClient = null;
let polkadotApi = null;
let viemAccount = null;
let viemAddress = null;
let polkadotSigner = null;
let bucketId = null;
let chain = null;

// Modules loaded at init time (ESM dynamic imports)
let viem = null;
let FileManager = null;
let ReplicationLevel = null;
let TypeRegistry = null;

// DataHaven testnet config
const DH_NETWORK = {
    id: 55931,
    name: 'DataHaven Testnet',
    rpcUrl: 'https://services.datahaven-testnet.network/testnet',
    wsUrl: 'wss://services.datahaven-testnet.network/testnet',
    mspUrl: 'https://deo-dh-backend.testnet.datahaven-infra.network/',
    nativeCurrency: { name: 'Mock', symbol: 'MOCK', decimals: 18 },
    filesystemContractAddress: '0x0000000000000000000000000000000000000404',
};

/**
 * Initialize the full DataHaven SDK stack:
 * 1) viem wallet + public client
 * 2) Polkadot API (Substrate)
 * 3) StorageHubClient (for on-chain file operations)
 * 4) MspClient (for MSP interaction + file upload/download)
 * 5) SIWE authentication
 * 6) Bucket creation
 */
async function initDataHaven() {
    let PRIVATE_KEY = process.env.DATAHAVEN_PRIVATE_KEY;
    if (!PRIVATE_KEY) {
        console.warn('⚠️  DATAHAVEN_PRIVATE_KEY not set in .env — using local fallback.');
        return;
    }
    // Normalize: viem requires 0x prefix
    if (!PRIVATE_KEY.startsWith('0x')) PRIVATE_KEY = '0x' + PRIVATE_KEY;

    try {
        // --- Dynamic ESM imports ---
        const { privateKeyToAccount } = await import('viem/accounts');
        viem = await import('viem');
        const storagehubCore = await import('@storagehub-sdk/core');
        const { MspClient } = await import('@storagehub-sdk/msp-client');
        const { ApiPromise, WsProvider, Keyring } = await import('@polkadot/api');
        const { cryptoWaitReady } = await import('@polkadot/util-crypto');
        const typesBundle = await import('@storagehub/types-bundle');
        await import('@storagehub/api-augment');
        const polkadotTypes = await import('@polkadot/types');

        // Extract SDK components
        const { StorageHubClient, initWasm } = storagehubCore;
        FileManager = storagehubCore.FileManager;
        ReplicationLevel = storagehubCore.ReplicationLevel;
        TypeRegistry = polkadotTypes.TypeRegistry;

        // Init WASM (required for @storagehub-sdk/core)
        await initWasm();
        await cryptoWaitReady();

        // 1) viem wallet
        chain = viem.defineChain({
            id: DH_NETWORK.id,
            name: DH_NETWORK.name,
            nativeCurrency: DH_NETWORK.nativeCurrency,
            rpcUrls: { default: { http: [DH_NETWORK.rpcUrl] } },
        });

        viemAccount = privateKeyToAccount(PRIVATE_KEY);
        viemAddress = viemAccount.address;
        console.log(`🔑 DataHaven wallet: ${viemAddress}`);

        walletClient = viem.createWalletClient({
            chain,
            account: viemAccount,
            transport: viem.http(DH_NETWORK.rpcUrl),
        });

        publicClient = viem.createPublicClient({
            chain,
            transport: viem.http(DH_NETWORK.rpcUrl),
        });

        // 2) Polkadot API
        const provider = new WsProvider(DH_NETWORK.wsUrl);
        polkadotApi = await ApiPromise.create({
            provider,
            typesBundle: typesBundle.types || typesBundle.default?.types,
            noInitWarn: true,
        });
        console.log('🔗 Polkadot API connected');

        // Polkadot signer
        const keyring = new Keyring({ type: 'ethereum' });
        polkadotSigner = keyring.addFromUri(PRIVATE_KEY);

        // 3) StorageHubClient
        storageHubClient = new StorageHubClient({
            rpcUrl: DH_NETWORK.rpcUrl,
            chain,
            walletClient,
            filesystemContractAddress: DH_NETWORK.filesystemContractAddress,
        });
        console.log('📦 StorageHubClient ready');

        // 4) MspClient — connect with session provider
        const sessionProvider = async () =>
            sessionToken
                ? { token: sessionToken, user: { address: viemAddress } }
                : undefined;

        mspClient = await MspClient.connect(
            { baseUrl: DH_NETWORK.mspUrl },
            sessionProvider
        );

        const health = await mspClient.info.getHealth();
        console.log(`✅ MSP Health:`, JSON.stringify(health));

        // 5) SIWE auth — must be done before file uploads
        await authenticateWithSIWE();

        // 6) Create / derive bucket
        await ensureBucket();

        sdkReady = true;
        console.log('🚀 DataHaven SDK fully initialized!');

    } catch (err) {
        console.error(`❌ DataHaven SDK init failed: ${err.message}`);
        console.error(err.stack);
        console.error('   Falling back to local storage.');
        sdkReady = false;
    }
}

/**
 * Authenticate with the MSP via SIWE (Sign-In With Ethereum).
 * Per the docs: mspClient.auth.SIWE(walletClient, domain, uri) → { token }
 */
async function authenticateWithSIWE() {
    try {
        const domain = 'localhost';
        const uri = 'http://localhost';
        const siweSession = await mspClient.auth.SIWE(walletClient, domain, uri);
        console.log('🔐 SIWE Session received');

        // Extract token per docs: (siweSession as { token: string }).token
        sessionToken = siweSession?.token || siweSession;
        if (typeof sessionToken === 'object') {
            sessionToken = sessionToken.token || JSON.stringify(sessionToken);
        }

        const profile = await mspClient.auth.getProfile();
        console.log(`🔐 Authenticated as: ${profile.address || viemAddress}`);
    } catch (authErr) {
        console.warn(`⚠️  SIWE auth failed (non-fatal): ${authErr.message}`);
        console.warn('   File uploads may fail without auth. Continuing...');
    }
}

/**
 * Create or find a bucket using the official SDK flow.
 * Per docs: deriveBucketId → check on-chain → createBucket → wait for indexer
 */
async function ensureBucket() {
    const BUCKET_NAME = 'superauth-credentials';
    try {
        const mspInfo = await mspClient.info.getInfo();
        const mspId = mspInfo.mspId;
        console.log(`📡 MSP ID: ${mspId}`);

        // Step 1: Derive deterministic bucket ID using the SDK method
        let derivedBucketId;
        try {
            derivedBucketId = await storageHubClient.deriveBucketId(viemAddress, BUCKET_NAME);
            console.log(`🪣 SDK-derived Bucket ID: ${derivedBucketId}`);
        } catch (deriveErr) {
            // Fallback derivation if SDK method not available
            const { keccak256, toUtf8Bytes, concat, zeroPadValue } = await import('ethers');
            derivedBucketId = keccak256(concat([zeroPadValue(viemAddress, 32), keccak256(toUtf8Bytes(BUCKET_NAME))]));
            console.log(`🪣 Fallback-derived Bucket ID: ${derivedBucketId}`);
        }

        // Step 2: Check if bucket already exists on-chain
        let bucketExists = false;
        try {
            const bucketInfo = await polkadotApi.query.providers.buckets(derivedBucketId);
            bucketExists = !bucketInfo.isEmpty;
            console.log(`🪣 Bucket on-chain: ${bucketExists ? 'EXISTS' : 'NOT FOUND'}`);
        } catch (queryErr) {
            console.warn(`⚠️ Could not query bucket on-chain: ${queryErr.message}`);
        }

        // Step 3: Create bucket if it doesn't exist
        if (!bucketExists) {
            const valueProps = await mspClient.info.getValuePropositions();
            const valuePropId = valueProps && valueProps.length > 0 ? valueProps[0].id : null;

            if (!valuePropId || !mspId) {
                console.warn('⚠️ No value propositions or MSP ID — using derived bucket ID');
                bucketId = derivedBucketId;
                return;
            }

            console.log(`🪣 Creating bucket on-chain (valueProp: ${valuePropId})...`);

            // Use the SDK's createBucket method per documentation
            let txHash;
            try {
                txHash = await storageHubClient.createBucket(
                    mspId,
                    BUCKET_NAME,
                    false,       // isPrivate
                    valuePropId,
                );
            } catch (createErr) {
                // If bucket already exists, that's OK
                if (createErr.message && (
                    createErr.message.includes('Already') ||
                    createErr.message.includes('BucketAlreadyExists')
                )) {
                    console.log(`🪣 Bucket already exists on-chain`);
                    bucketId = derivedBucketId;
                } else {
                    console.warn(`⚠️ createBucket error: ${createErr.message.split('\n')[0]}`);
                    bucketId = derivedBucketId;
                }
                // Even if creation failed, try waiting for MSP indexer
                await waitForMspBucketReady(derivedBucketId);
                return;
            }

            if (txHash) {
                console.log(`🪣 createBucket txHash: ${txHash}`);
                // Wait for on-chain confirmation
                const txReceipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
                if (txReceipt.status !== 'success') {
                    console.warn(`⚠️ Bucket creation tx failed on-chain`);
                }
            }

            bucketId = derivedBucketId;
            console.log(`🪣 Bucket ID: ${bucketId}`);

            // Step 4: Wait for MSP backend indexer to pick up the new bucket
            await waitForMspBucketReady(bucketId);
        } else {
            bucketId = derivedBucketId;
            console.log(`🪣 Using existing Bucket ID: ${bucketId}`);

            // Verify MSP backend knows about it
            await waitForMspBucketReady(bucketId);
        }
    } catch (bucketErr) {
        console.warn(`⚠️ Bucket setup error: ${bucketErr.message}`);
        // Final fallback derivation
        try {
            const { keccak256, toUtf8Bytes, concat, zeroPadValue } = await import('ethers');
            bucketId = keccak256(concat([zeroPadValue(viemAddress, 32), keccak256(toUtf8Bytes(BUCKET_NAME))]));
        } catch {
            bucketId = '0x' + crypto.createHash('sha256').update(viemAddress + BUCKET_NAME).digest('hex');
        }
        console.log(`🪣 Using fallback Bucket ID: ${bucketId}`);
    }
}

/**
 * Poll MSP backend until the indexer has indexed this bucket.
 * Per docs: mspClient.buckets.getBucket(bucketId) returns 404 until ready.
 */
async function waitForMspBucketReady(targetBucketId) {
    const MAX_ATTEMPTS = 10;
    const DELAY_MS = 2000;

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
        console.log(`   Checking MSP indexer for bucket... attempt ${i + 1}/${MAX_ATTEMPTS}`);
        try {
            const bucket = await mspClient.buckets.getBucket(targetBucketId);
            if (bucket) {
                console.log(`✅ Bucket confirmed in MSP backend (files: ${bucket.fileCount || 0})`);
                return;
            }
        } catch (err) {
            if (err?.status === 404 || err?.body?.error?.includes('Not found')) {
                console.log(`   Bucket not indexed yet (404)...`);
            } else {
                // Non-404 errors are unexpected
                console.warn(`   Unexpected bucket check error: ${err.message?.split('\n')[0]}`);
            }
        }
        await new Promise(r => setTimeout(r, DELAY_MS));
    }
    console.warn(`⚠️ Bucket not found in MSP after ${MAX_ATTEMPTS} attempts — uploads may fail`);
}

// ═══════════════════════════════════════════════════════════
// HELPER: Store data via DataHaven MSP (proper SDK flow)
// ═══════════════════════════════════════════════════════════
async function storeViaDataHaven(jsonStr, filename) {
    if (!sdkReady || !mspClient) throw new Error('SDK not ready');

    // Always persist locally as well for quick retrieval
    const tmpPath = path.join(DATAHAVEN_DIR, filename);
    fs.writeFileSync(tmpPath, jsonStr, 'utf8');

    const fileBuffer = Buffer.from(jsonStr, 'utf8');
    const fileSize = fileBuffer.length;
    let storageMode = 'local-backup';

    try {
        // -- STEP 1: Create a FileManager from the JSON string --
        const { Readable } = require('stream');
        const fileManager = new FileManager({
            size: fileSize,
            stream: () => Readable.toWeb(Readable.from(fileBuffer)),
        });

        // -- STEP 2: Compute fingerprint --
        const fingerprint = await fileManager.getFingerprint();
        console.log(`📋 Fingerprint: ${fingerprint.toHex()}`);

        const fileSizeBigInt = BigInt(fileManager.getFileSize());

        // -- STEP 3: Compute a deterministic file key --
        let fileKeyHex;
        try {
            const registry = new TypeRegistry();
            const owner = registry.createType('AccountId20', viemAddress);
            const bucketIdH256 = registry.createType('H256', bucketId);
            const fileKey = await fileManager.computeFileKey(owner, bucketIdH256, filename);
            fileKeyHex = fileKey.toHex();
            console.log(`🔑 Computed file key: ${fileKeyHex}`);
        } catch (keyErr) {
            fileKeyHex = '0x' + crypto.createHash('sha256').update(viemAddress + bucketId + filename).digest('hex');
            console.log(`🔑 Derived file key: ${fileKeyHex}`);
        }

        // -- STEP 4: (Optional) Try on-chain storage request --
        // This may fail if the bucket hasn't been confirmed on-chain yet — that's OK,
        // the MSP upload can still work without it.
        let storageRequestOk = false;
        try {
            const mspInfo = await mspClient.info.getInfo();
            const mspId = mspInfo.mspId;
            const multiaddresses = mspInfo.multiaddresses || [];
            const peerIds = (multiaddresses || [])
                .map(addr => addr.split('/p2p/').pop())
                .filter(id => !!id);

            const txHash = await storageHubClient.issueStorageRequest(
                bucketId,
                filename,
                fingerprint.toHex(),
                fileSizeBigInt,
                mspId,
                peerIds.length > 0 ? peerIds : [mspId],
                ReplicationLevel ? ReplicationLevel.Custom : 0,
                1,
            );

            if (txHash) {
                console.log(`📝 Storage request txHash: ${txHash}`);
                const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
                storageRequestOk = receipt.status === 'success';
                console.log(`📝 Storage request ${storageRequestOk ? 'confirmed' : 'failed on-chain'}`);
            }
        } catch (storageReqErr) {
            // Non-fatal: the bucket might not exist on-chain yet, or insufficient balance
            console.warn(`⚠️ On-chain storage request skipped: ${storageReqErr.message.split('\n')[0]}`);
        }

        // -- STEP 5: Re-authenticate if needed --
        if (!sessionToken) {
            await authenticateWithSIWE();
        }

        // -- STEP 6: Upload file to MSP --
        let uploadResult;
        const fileBlob = await fileManager.getFileBlob();

        // Try uploadFile (main documented method)
        try {
            uploadResult = await mspClient.files.uploadFile(
                bucketId, fileKeyHex, fileBlob, viemAddress, filename,
            );
            console.log(`📤 Upload receipt:`, JSON.stringify(uploadResult));
            storageMode = 'datahaven-network';
        } catch (uploadErr) {
            console.warn(`⚠️ uploadFile failed: ${uploadErr.message.split('\n')[0]}`);

            // Fallback: try .upload() with object params
            try {
                uploadResult = await mspClient.files.upload({
                    bucket: bucketId, fileKey: fileKeyHex,
                    file: fileBlob, fileName: filename, address: viemAddress,
                });
                storageMode = 'datahaven-network';
                console.log(`📤 Upload (alt):`, JSON.stringify(uploadResult));
            } catch (altErr) {
                console.warn(`⚠️ Alt upload also failed: ${altErr.message.split('\n')[0]}`);

                // Final fallback: try with Blob wrapper
                try {
                    uploadResult = await mspClient.files.uploadFile(
                        bucketId, fileKeyHex, new Blob([fileBuffer]), viemAddress, filename,
                    );
                    storageMode = 'datahaven-network';
                    console.log(`📤 Upload (blob):`, JSON.stringify(uploadResult));
                } catch (blobErr) {
                    console.warn(`⚠️ All upload methods exhausted: ${blobErr.message.split('\n')[0]}`);
                    // Data is saved locally — return gracefully instead of throwing
                    storageMode = 'datahaven-local-backup';
                }
            }
        }

        // Verify upload success
        if (uploadResult && uploadResult.status === 'upload_successful') {
            console.log(`✅ File uploaded successfully to DataHaven!`);
            storageMode = 'datahaven-network';
        }

        // Store file key mapping for retrieval
        const resultKey = uploadResult?.fileKey || fileKeyHex;
        fileKeyMap[filename] = resultKey;
        fileKeyMap[resultKey] = filename;
        saveFileKeyMap();

        return {
            fileKey: resultKey,
            storageMode,
            raw: uploadResult || null,
            fingerprint: fingerprint.toHex(),
            bucketId: bucketId,
            storageRequestOk,
        };

    } catch (err) {
        console.error(`DataHaven store error: ${err.message}`);
        // Data is already saved locally — return local reference instead of throwing
        return {
            fileKey: filename.replace('.json', ''),
            storageMode: 'datahaven-local-backup',
            raw: null,
            error: err.message.split('\n')[0],
        };
    }
}

// ═══════════════════════════════════════════════════════════
// HELPER: Retrieve data from DataHaven MSP
// ═══════════════════════════════════════════════════════════
async function retrieveFromDataHaven(fileKeyOrId) {
    if (!sdkReady || !mspClient) throw new Error('SDK not ready');

    // Re-authenticate if needed
    if (!sessionToken) {
        await authenticateWithSIWE();
    }

    try {
        // Try download by file key
        let result;
        try {
            result = await mspClient.files.downloadFile(fileKeyOrId);
        } catch {
            try {
                result = await mspClient.files.download(fileKeyOrId);
            } catch {
                result = await mspClient.files.downloadFile(bucketId, fileKeyOrId);
            }
        }

        // Check for HTTP error responses
        if (result && result.status && result.status >= 400) {
            throw new Error(`MSP returned HTTP ${result.status}`);
        }

        // Handle stream response: { stream: ReadableStream, status: 200, contentType: ... }
        if (result && result.stream) {
            console.log('Got stream response from MSP, reading...');
            try {
                const { Readable } = require('stream');
                let chunks = [];

                // Handle Web ReadableStream
                if (typeof result.stream.getReader === 'function') {
                    const reader = result.stream.getReader();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        chunks.push(Buffer.from(value));
                    }
                }
                // Handle Node.js Readable stream
                else if (result.stream.on || result.stream.pipe) {
                    const nodeStream = result.stream instanceof Readable ? result.stream : Readable.from(result.stream);
                    for await (const chunk of nodeStream) {
                        chunks.push(Buffer.from(chunk));
                    }
                }
                // Handle body/arrayBuffer
                else if (typeof result.stream.arrayBuffer === 'function') {
                    const ab = await result.stream.arrayBuffer();
                    return Buffer.from(ab).toString('utf8');
                }

                if (chunks.length > 0) {
                    return Buffer.concat(chunks).toString('utf8');
                }
            } catch (streamErr) {
                console.warn('Stream reading failed:', streamErr.message);
            }
        }

        // Handle direct data
        if (result && result.data) {
            return typeof result.data === 'string' ? result.data : JSON.stringify(result.data);
        }
        if (result && result.file) {
            return result.file.toString('utf8');
        }
        if (Buffer.isBuffer(result)) {
            return result.toString('utf8');
        }
        if (result instanceof Blob || (result && typeof result.text === 'function')) {
            return await result.text();
        }
        if (typeof result === 'string') {
            return result;
        }

        // If we got a metadata object, don't return it as data
        throw new Error('Unrecognized download response format');
    } catch (err) {
        console.warn(`DataHaven download failed: ${err.message}`);
        throw err;
    }
}

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/datahaven/store
 * Body: { data: {...} }
 * Returns: { success, dataHavenId, hash, storage }
 */
app.post('/api/datahaven/store', async (req, res) => {
    try {
        const { data } = req.body;
        if (!data) return res.status(400).json({ success: false, error: 'Missing data field' });

        const jsonStr = JSON.stringify(data);
        const dataHavenId = crypto.randomUUID();
        const hash = ethersKeccak256(jsonStr);
        const filename = `${dataHavenId}.json`;

        if (sdkReady) {
            const result = await storeViaDataHaven(jsonStr, filename);
            const finalId = result.fileKey || dataHavenId;

            // Map the UUID to the file key for easy retrieval
            fileKeyMap[dataHavenId] = finalId;
            fileKeyMap[finalId] = filename;
            saveFileKeyMap();

            res.json({
                success: true,
                dataHavenId: finalId,
                hash,
                storage: result.storageMode || 'datahaven-local-backup',
                fingerprint: result.fingerprint,
                details: result.raw,
                error: result.error
            });
            return;
        }

        // Local fallback (if SDK completely offline)
        const filePath = path.join(DATAHAVEN_DIR, filename);
        fs.writeFileSync(filePath, jsonStr, 'utf8');
        console.log(`📦 Stored locally: ${dataHavenId}`);

        res.json({
            success: true,
            dataHavenId,
            hash,
            storage: 'local-fallback',
        });
    } catch (err) {
        console.error('Store error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/datahaven/retrieve/:id
 */
app.get('/api/datahaven/retrieve/:id', async (req, res) => {
    try {
        const id = req.params.id;

        // Try DataHaven network first
        if (sdkReady) {
            try {
                // Resolve the ID through our key map
                const resolvedKey = fileKeyMap[id] || id;
                const data = await retrieveFromDataHaven(resolvedKey);
                return res.json({ success: true, data: JSON.parse(data), source: 'datahaven-network' });
            } catch (netErr) {
                console.warn(`Network retrieve failed for ${id}: ${netErr.message}`);
            }
        }

        // Try local fallback — direct filename
        const filePath = path.join(DATAHAVEN_DIR, `${id}.json`);
        if (fs.existsSync(filePath)) {
            const raw = fs.readFileSync(filePath, 'utf8');
            return res.json({ success: true, data: JSON.parse(raw), source: 'local' });
        }

        // Resolve via key map then try local
        const mappedFilename = fileKeyMap[id];
        if (mappedFilename) {
            const mappedPath = path.join(DATAHAVEN_DIR, mappedFilename.endsWith('.json') ? mappedFilename : `${mappedFilename}.json`);
            if (fs.existsSync(mappedPath)) {
                const raw = fs.readFileSync(mappedPath, 'utf8');
                return res.json({ success: true, data: JSON.parse(raw), source: 'local-mapped' });
            }
        }

        // Search local store by partial match
        const files = fs.readdirSync(DATAHAVEN_DIR).filter(f => !f.startsWith('_'));
        const match = files.find(f => f.startsWith(id) || f.includes(id));
        if (match) {
            const raw = fs.readFileSync(path.join(DATAHAVEN_DIR, match), 'utf8');
            return res.json({ success: true, data: JSON.parse(raw), source: 'local' });
        }

        res.status(404).json({ success: false, error: 'Not found' });
    } catch (err) {
        console.error('Retrieve error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/datahaven/health
 */
app.get('/api/datahaven/health', async (req, res) => {
    try {
        if (sdkReady && mspClient) {
            let health = null;
            try {
                health = await mspClient.info.getHealth();
            } catch (e) {
                health = { error: e.message };
            }
            return res.json({
                success: true,
                sdkReady: true,
                authenticated: !!sessionToken,
                wallet: viemAddress,
                mspHealth: health,
                bucketId,
            });
        }
        res.json({
            success: true,
            sdkReady: false,
            storage: 'local-fallback',
            reason: 'SDK not initialized',
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/datahaven/reauth
 * Force re-authentication with SIWE
 */
app.post('/api/datahaven/reauth', async (req, res) => {
    try {
        if (!sdkReady || !mspClient) {
            return res.status(503).json({ success: false, error: 'SDK not ready' });
        }
        await authenticateWithSIWE();
        res.json({
            success: true,
            authenticated: !!sessionToken,
            wallet: viemAddress,
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ═══════════════════════════════════════════════════════════
// KECCAK256 HASHING
// ═══════════════════════════════════════════════════════════
function ethersKeccak256(str) {
    try {
        const { createKeccak } = require('keccak');
        const hash = createKeccak('keccak256');
        hash.update(Buffer.from(str, 'utf8'));
        return '0x' + hash.digest('hex');
    } catch {
        try {
            const { keccak256, toUtf8Bytes } = require('ethers');
            return keccak256(toUtf8Bytes(str));
        } catch {
            return '0x' + crypto.createHash('sha256').update(str).digest('hex');
        }
    }
}

app.post('/api/hash', (req, res) => {
    try {
        const { data } = req.body;
        if (!data) return res.status(400).json({ error: 'Missing data' });
        const str = typeof data === 'string' ? data : JSON.stringify(data);
        res.json({ hash: ethersKeccak256(str) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        sdkReady,
        authenticated: !!sessionToken,
        wallet: viemAddress || 'not configured',
    });
});
// ═══════════════════════════════════════════════════════════
// REQUEST QUEUE — Server-side shared store
// ═══════════════════════════════════════════════════════════
const REQUESTS_FILE = path.join(DATAHAVEN_DIR, '_requests.json');
let requestQueue = [];
try {
    if (fs.existsSync(REQUESTS_FILE)) {
        requestQueue = JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf8'));
    }
} catch { /* start fresh */ }

function saveRequestQueue() {
    fs.writeFileSync(REQUESTS_FILE, JSON.stringify(requestQueue, null, 2), 'utf8');
}

// Submit a new request
app.post('/api/requests', (req, res) => {
    try {
        const { requester, credentialType, typeHash, action, rawData, dataHash, notes } = req.body;
        if (!requester || !credentialType || !rawData) {
            return res.status(400).json({ success: false, error: 'Missing required fields' });
        }
        const newReq = {
            id: 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            timestamp: new Date().toISOString(),
            requester,
            credentialType,
            typeHash: typeHash || '',
            action: action || 'issue',
            rawData,
            dataHash: dataHash || '',
            notes: notes || '',
            status: 'pending'
        };
        requestQueue.push(newReq);
        saveRequestQueue();
        console.log(`📨 New request: ${newReq.id} from ${requester} for ${credentialType}`);
        res.json({ success: true, request: newReq });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get requests (optionally filter by status, requester, or credentialType)
app.get('/api/requests', (req, res) => {
    try {
        let results = [...requestQueue];
        if (req.query.status) results = results.filter(r => r.status === req.query.status);
        if (req.query.requester) results = results.filter(r => r.requester.toLowerCase() === req.query.requester.toLowerCase());
        if (req.query.type) results = results.filter(r => r.credentialType === req.query.type);
        res.json({ success: true, requests: results });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Update a request status (accept/reject)
app.patch('/api/requests/:id', (req, res) => {
    try {
        const { id } = req.params;
        const { status, txHash } = req.body;
        const reqItem = requestQueue.find(r => r.id === id);
        if (!reqItem) return res.status(404).json({ success: false, error: 'Request not found' });
        if (status) reqItem.status = status;
        if (txHash) reqItem.txHash = txHash;
        saveRequestQueue();
        console.log(`📨 Request ${id} updated: ${status}`);
        res.json({ success: true, request: reqItem });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Catch-all for SPA (Express v5 requires named splat param)
app.get('{*path}', (req, res) => {
    res.sendFile(path.resolve(__dirname, '../frontend/index.html'));
});

// ═══════════════════════════════════════════════════════════
// START SERVER + INIT SDK
// ═══════════════════════════════════════════════════════════
app.listen(PORT, async () => {
    console.log(`\n🚀 SuperAuth Backend running on http://localhost:${PORT}`);
    console.log(`📁 Frontend served from: /frontend`);
    console.log(`📡 API endpoints:`);
    console.log(`   POST /api/datahaven/store      — Store data in DataHaven`);
    console.log(`   GET  /api/datahaven/retrieve/:id — Fetch DataHaven data`);
    console.log(`   GET  /api/datahaven/health      — DataHaven connection status`);
    console.log(`   POST /api/datahaven/reauth      — Force re-auth with SIWE`);
    console.log(`   POST /api/hash                  — Compute keccak256`);
    console.log(`   GET  /api/health                — Health check`);
    console.log(`\n⏳ Initializing DataHaven SDK...`);

    await initDataHaven();

    if (sdkReady) {
        console.log(`\n✅ DataHaven is LIVE — storing data on the decentralized network!`);
    } else {
        console.log(`\n⚠️  DataHaven SDK not connected — using local fallback storage.`);
    }
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    if (polkadotApi) {
        try { await polkadotApi.disconnect(); } catch { }
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    if (polkadotApi) {
        try { await polkadotApi.disconnect(); } catch { }
    }
    process.exit(0);
});
