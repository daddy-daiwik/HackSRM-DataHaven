/**
 * SuperAuth V2 — Backend Server
 * 
 * Express API for:
 *   1. IPFS pinning (via Pinata or local IPFS node)
 *   2. Credential data retrieval from IPFS
 *   3. Server-side hash computation for verification
 * 
 * Usage:
 *   npm install express cors multer axios dotenv
 *   node backend/server.js
 * 
 * Environment variables:
 *   PINATA_API_KEY       — Pinata API key (free tier supports 500 pins)
 *   PINATA_SECRET_KEY    — Pinata secret API key
 *   PORT                 — Server port (default 3001)
 */

const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

// Serve frontend files
app.use(express.static(path.resolve(__dirname, '../frontend')));

const PORT = process.env.PORT || 3001;
const PINATA_API_KEY = process.env.PINATA_API_KEY || '';
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY || '';

// ═══════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════

/**
 * POST /api/pin
 * Pin JSON data to IPFS via Pinata.
 * 
 * Body: { data: {...}, name: "credential_name" }
 * Returns: { success: true, cid: "Qm...", hash: "0x..." }
 */
app.post('/api/pin', async (req, res) => {
    try {
        const { data, name } = req.body;

        if (!data) {
            return res.status(400).json({ success: false, error: 'Missing data field' });
        }

        if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
            // Fallback: return a computed hash without pinning
            const jsonStr = JSON.stringify(data);
            const hash = '0x' + crypto.createHash('sha256').update(jsonStr).digest('hex');
            return res.json({
                success: true,
                cid: null,
                hash,
                warning: 'Pinata keys not configured. Data was NOT pinned to IPFS. Set PINATA_API_KEY and PINATA_SECRET_KEY in .env.'
            });
        }

        // Pin to Pinata
        const pinataRes = await axios.post(
            'https://api.pinata.cloud/pinning/pinJSONToIPFS',
            {
                pinataContent: data,
                pinataMetadata: { name: name || 'superauth_credential' }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                    'pinata_api_key': PINATA_API_KEY,
                    'pinata_secret_api_key': PINATA_SECRET_KEY
                }
            }
        );

        const cid = pinataRes.data.IpfsHash;
        const jsonStr = JSON.stringify(data);
        // Compute keccak256 matching Solidity's keccak256(toUtf8Bytes(jsonStr))
        const hash = ethersKeccak256(jsonStr);

        res.json({ success: true, cid, hash });

    } catch (err) {
        console.error('Pin error:', err.response?.data || err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/ipfs/:cid
 * Fetch data from IPFS gateway.
 */
app.get('/api/ipfs/:cid', async (req, res) => {
    try {
        const { cid } = req.params;
        const response = await axios.get(`https://ipfs.io/ipfs/${cid}`, { timeout: 15000 });
        res.json({ success: true, data: response.data });
    } catch (err) {
        res.status(502).json({ success: false, error: 'Failed to fetch from IPFS: ' + err.message });
    }
});

/**
 * POST /api/hash
 * Compute keccak256 hash of JSON data (matches Solidity computation).
 * 
 * Body: { data: {...} }
 * Returns: { hash: "0x..." }
 */
app.post('/api/hash', (req, res) => {
    try {
        const { data } = req.body;
        if (!data) return res.status(400).json({ error: 'Missing data' });
        const hash = ethersKeccak256(JSON.stringify(data));
        res.json({ hash });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/**
 * GET /api/health
 * Server health check.
 */
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        pinata: PINATA_API_KEY ? 'configured' : 'not configured',
    });
});

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

/**
 * Compute keccak256 of a UTF-8 string.
 * Matches: ethers.keccak256(ethers.toUtf8Bytes(str))
 */
function ethersKeccak256(str) {
    const { createKeccak } = require('keccak');
    // fallback using node's crypto if keccak not installed
    try {
        const hash = createKeccak('keccak256');
        hash.update(Buffer.from(str, 'utf8'));
        return '0x' + hash.digest('hex');
    } catch {
        // Use js-sha3 or ethers as fallback
        const { keccak256 } = require('ethers');
        const { toUtf8Bytes } = require('ethers');
        return keccak256(toUtf8Bytes(str));
    }
}

// ═══════════════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════════════

app.listen(PORT, () => {
    console.log(`\n🚀 SuperAuth Backend running on http://localhost:${PORT}`);
    console.log(`📁 Frontend served from: /frontend`);
    console.log(`📡 API endpoints:`);
    console.log(`   POST /api/pin     — Pin data to IPFS`);
    console.log(`   GET  /api/ipfs/:cid — Fetch IPFS data`);
    console.log(`   POST /api/hash    — Compute keccak256`);
    console.log(`   GET  /api/health  — Health check\n`);
});
