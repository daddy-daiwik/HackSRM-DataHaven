/**
 * SuperAuth V2 — Frontend Application
 *
 * ROLES (detected on wallet connect):
 *   Government → Authority powers + Set Authorities tab
 *   Authority  → Inbox (pending requests), Manage (issue/update/revoke), Verify
 *   User       → Dashboard (auto-loaded), Request (new/modify), Verify
 *
 * REQUEST FLOW:
 *   User submits request → stored in localStorage → appears in Authority Inbox
 *   Authority accepts → signs tx → credential issued/updated on-chain
 *   Authority rejects → request marked rejected
 *
 * Uses ethers.js v6 for hashing. Uses window.pelagus for wallet interactions.
 */

// ═══════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════

let provider = null;
let signer = null;
let contract = null;
let readContract = null;
let connectedAddress = null;
let pelagusProvider = null;

// Role flags
let userRole = 'user'; // 'user' | 'authority' | 'government'
let authorityTypes = []; // Which credential types this authority can manage

const KNOWN_TYPES = ['PERSONAL', 'EDUCATION', 'EMPLOYMENT', 'MEDICAL', 'FINANCIAL'];

// Request storage key
const REQUESTS_KEY = 'superauth_requests_v2';

// ═══════════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initWallet();
    initRequestPage();
    initManagePage();
    initVerifyPage();
    initModal();
    initReadOnlyProvider();
    waitForPelagus();
    // Check DataHaven backend status on load
    checkDataHavenHealth().then(h => {
        if (h && h.sdkReady) console.log('✅ DataHaven network is live');
        else console.log('⚠️ DataHaven using local fallback');
    });
});

function waitForPelagus() {
    let attempts = 0;
    const check = setInterval(() => {
        attempts++;
        const p = window.pelagus || (window.ethereum && window.ethereum.isPelagus ? window.ethereum : null);
        if (p) { clearInterval(check); pelagusProvider = p; console.log('Pelagus detected'); }
        else if (attempts >= 50) { clearInterval(check); }
    }, 100);
}

function initReadOnlyProvider() {
    try {
        const rpc = 'https://orchard.rpc.quai.network/cyprus1';
        const fallback = new ethers.JsonRpcProvider(rpc);
        readContract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, fallback);
    } catch (e) { console.warn('Read-only provider failed:', e); }
}

// ═══════════════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════════════

function initTabs() {
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
            const target = document.getElementById('tab-' + tab.dataset.tab);
            if (target) target.classList.add('active');
        });
    });
}

function switchToTab(tabName) {
    const tab = document.querySelector(`[data-tab="${tabName}"]`);
    if (tab) tab.click();
}

// ═══════════════════════════════════════════════════════════
// ROLE DETECTION
// ═══════════════════════════════════════════════════════════

async function detectRole(contractInstance, address) {
    userRole = 'user';
    authorityTypes = [];
    const norm = address.toLowerCase();

    // Check government
    if (GOVERNMENT_ADDRESS && norm === GOVERNMENT_ADDRESS.toLowerCase()) {
        userRole = 'government';
        // Government is also authority for all types
        authorityTypes = [...KNOWN_TYPES];
        console.log('Role: GOVERNMENT');
    } else {
        // Check authority for each type
        for (const typeName of KNOWN_TYPES) {
            try {
                const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeName));
                const auth = await contractInstance.authorities(typeHash);
                if (auth && auth.toLowerCase() === norm) {
                    authorityTypes.push(typeName);
                }
            } catch (e) { /* skip */ }
        }
        if (authorityTypes.length > 0) {
            userRole = 'authority';
            console.log('Role: AUTHORITY for', authorityTypes);
        } else {
            console.log('Role: USER');
        }
    }

    applyRoleUI();
}

function applyRoleUI() {
    const roleBadge = document.getElementById('role-badge');
    const roleIcon = document.getElementById('role-icon');
    const roleLabel = document.getElementById('role-label');
    roleBadge.style.display = 'flex';

    // Reset all role-specific tabs
    document.getElementById('nav-request').style.display = 'none';
    document.getElementById('nav-inbox').style.display = 'none';
    document.getElementById('nav-manage').style.display = 'none';
    document.getElementById('nav-authorities').style.display = 'none';

    if (userRole === 'government') {
        roleIcon.textContent = '🏛️';
        roleLabel.textContent = 'Government';
        roleBadge.className = 'role-badge government';

        document.getElementById('nav-inbox').style.display = '';
        document.getElementById('nav-manage').style.display = '';
        document.getElementById('nav-authorities').style.display = '';

        document.getElementById('dashboard-title').textContent = 'Government Dashboard';
        document.getElementById('dashboard-subtitle').textContent = 'Overview of all credential activity';

        document.getElementById('btn-issue').disabled = false;
        document.getElementById('btn-manage-lookup').disabled = false;
        document.getElementById('btn-set-authority').disabled = false;

        loadAuthorityAssignments();
        loadInbox();

    } else if (userRole === 'authority') {
        roleIcon.textContent = '🔐';
        roleLabel.textContent = 'Authority';
        roleBadge.className = 'role-badge authority';

        document.getElementById('nav-inbox').style.display = '';
        document.getElementById('nav-manage').style.display = '';

        document.getElementById('dashboard-title').textContent = 'Authority Dashboard';
        document.getElementById('dashboard-subtitle').textContent = 'Credentials under your authority (' + authorityTypes.join(', ') + ')';

        document.getElementById('btn-issue').disabled = false;
        document.getElementById('btn-manage-lookup').disabled = false;

        loadInbox();

    } else {
        roleIcon.textContent = '👤';
        roleLabel.textContent = 'User';
        roleBadge.className = 'role-badge user';

        document.getElementById('nav-request').style.display = '';

        document.getElementById('dashboard-title').textContent = 'My Credentials';
        document.getElementById('dashboard-subtitle').textContent = 'All credentials linked to your wallet';

        document.getElementById('btn-submit-request').disabled = false;
        renderMyRequests();
    }
}

// ═══════════════════════════════════════════════════════════
// WALLET CONNECTION
// ═══════════════════════════════════════════════════════════

function initWallet() {
    document.getElementById('btn-connect').addEventListener('click', connectWallet);
}

async function connectWallet() {
    const wp = window.pelagus
        || (window.ethereum && window.ethereum.isPelagus ? window.ethereum : null)
        || window.ethereum;

    if (!wp) {
        showToast('Pelagus wallet not detected! Install it from pelaguswallet.io', 'error');
        window.open('https://pelaguswallet.io/', '_blank');
        return;
    }
    pelagusProvider = wp;

    try {
        const btn = document.getElementById('btn-connect');
        btn.innerHTML = '<span class="spinner"></span> Connecting...';

        let accounts;
        try {
            accounts = await wp.request({ method: 'quai_requestAccounts' });
        } catch (e) {
            accounts = await wp.request({ method: 'eth_requestAccounts' });
        }

        if (!accounts || accounts.length === 0) {
            showToast('No accounts returned. Unlock your wallet.', 'error');
            resetConnectButton();
            return;
        }

        connectedAddress = accounts[0];
        provider = new ethers.BrowserProvider(wp);
        signer = await provider.getSigner();
        contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, signer);

        const short = connectedAddress.slice(0, 8) + '...' + connectedAddress.slice(-4);
        btn.classList.add('connected');
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg><span>${short}</span>`;

        document.getElementById('network-badge').classList.add('connected');
        document.getElementById('network-name').textContent = 'Quai Network';

        showToast('Connected: ' + short, 'success');

        await detectRole(contract, connectedAddress);
        loadDashboard();

        wp.on('accountsChanged', () => location.reload());
        wp.on('chainChanged', () => location.reload());
    } catch (err) {
        console.error(err);
        showToast('Connection failed: ' + (err.code === 4001 ? 'Rejected by user' : err.message || err), 'error');
        resetConnectButton();
    }
}

function resetConnectButton() {
    const btn = document.getElementById('btn-connect');
    btn.classList.remove('connected');
    btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span>Connect Wallet</span>`;
}

// ═══════════════════════════════════════════════════════════
// DASHBOARD — Auto-loaded credentials
// ═══════════════════════════════════════════════════════════

async function loadDashboard() {
    if (!contract || !connectedAddress) return;

    const list = document.getElementById('credential-list');
    list.innerHTML = '<div class="empty-state"><span class="spinner"></span><p>Loading...</p></div>';

    try {
        const types = await contract.getUserCredentialTypes(connectedAddress);
        let total = types.length, valid = 0, revoked = 0;
        const cards = [];

        for (const typeHash of types) {
            try {
                const [hash, dataHavenId, authority, timestamp, rev, version] = await contract.getCredential(connectedAddress, typeHash);
                const typeName = resolveTypeName(typeHash);
                rev ? revoked++ : valid++;
                cards.push({ typeHash, hash, dataHavenId, authority, timestamp, revoked: rev, version, typeName });
            } catch (e) { console.warn('Skip type', typeHash); }
        }

        document.getElementById('stat-total').textContent = total;
        document.getElementById('stat-valid').textContent = valid;
        document.getElementById('stat-revoked').textContent = revoked;

        if (cards.length === 0) {
            const requestLink = userRole === 'user'
                ? '<br><br><a href="#" onclick="switchToTab(\'request\'); return false;" style="color:var(--accent-cyan);text-decoration:underline;">Request your first credential →</a>'
                : '';
            list.innerHTML = `<div class="empty-state">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                <p>No credentials found${requestLink}</p>
            </div>`;
            return;
        }

        list.innerHTML = '';
        for (const c of cards) {
            const card = document.createElement('div');
            card.className = 'credential-card';
            card.innerHTML = `
                <div class="cred-icon">${getTypeIcon(c.typeName)}</div>
                <div class="cred-info">
                    <div class="cred-type">${c.typeName}</div>
                    <div class="cred-meta">
                        <span>v${c.version.toString()}</span>
                        <span>${formatTimestamp(c.timestamp)}</span>
                        <span>By: ${c.authority.slice(0, 6)}…${c.authority.slice(-4)}</span>
                    </div>
                </div>
                <div class="cred-status ${c.revoked ? 'revoked' : 'valid'}">
                    <span class="status-dot"></span>
                    ${c.revoked ? 'Revoked' : 'Verified'}
                </div>
                <svg class="cred-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"/></svg>
            `;
            card.addEventListener('click', () => showCredentialDetail(connectedAddress, c.typeHash, c.typeName));
            list.appendChild(card);
        }
    } catch (err) {
        list.innerHTML = `<div class="empty-state"><p style="color:var(--accent-red);">Error: ${err.message}</p></div>`;
    }
}

async function showCredentialDetail(user, typeHash, typeName) {
    const c = contract || readContract;
    if (!c) return;
    openModal('<div style="text-align:center"><span class="spinner"></span><p style="margin-top:12px">Loading...</p></div>');

    try {
        const [hash, dataHavenId, authority, timestamp, revoked, version] = await c.getCredential(user, typeHash);
        const [hashes, dataHavenIds, timestamps, auths] = await c.getCredentialHistory(user, typeHash);

        let revHtml = '';
        if (revoked) {
            const [, reason, revTs, revAuth] = await c.getRevocationInfo(user, typeHash);
            revHtml = `<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:16px;margin-top:16px;">
                <div style="color:#ef4444;font-weight:700;margin-bottom:8px;">⚠ Revoked</div>
                <div class="result-grid">
                    <span class="result-label">Reason</span><span class="result-value">${reason || 'N/A'}</span>
                    <span class="result-label">When</span><span class="result-value">${formatTimestamp(revTs)}</span>
                    <span class="result-label">By</span><span class="result-value">${revAuth}</span>
                </div></div>`;
        }

        const historyItems = hashes.map((h, i) => {
            const isLatest = (i === hashes.length - 1);
            const statusLabel = revoked
                ? '<span class="badge badge-red">DEPRECATED</span>'
                : (isLatest ? '<span class="badge badge-green">ACTIVE VERSION</span>' : '<span class="badge badge-indigo">SUPERSEDED</span>');

            return `
                <div class="history-item ${isLatest && !revoked ? 'active' : 'past'}">
                    <div class="hi-version">Version ${i + 1} ${statusLabel}</div>
                    <div class="hi-hash">Hash: ${h}</div>
                    <div class="hi-dhid">DataHaven: ${formatDataHavenDisplay(dataHavenIds[i])}</div>
                    <div class="hi-time">${formatTimestamp(timestamps[i])} • Signed by Authority</div>
                </div>
            `;
        }).reverse().join('');

        const histHtml = `<div class="history-timeline">${historyItems}</div>`;

        const dataHavenLink = isValidDataHavenId(dataHavenId) ? ` <a href="http://localhost:3001/api/datahaven/retrieve/${dataHavenId}" target="_blank" class="ipfs-link">📦 View DataHaven →</a>` : '';

        openModal(`
            <h2>${getTypeIcon(typeName)} ${typeName}</h2>
            <div class="result-grid" style="margin-bottom:16px;">
                <span class="result-label">Status</span><span class="result-value"><span class="badge ${revoked ? 'badge-red' : 'badge-green'}">${revoked ? 'Revoked' : 'Valid'}</span></span>
                <span class="result-label">Version</span><span class="result-value">${version.toString()}</span>
                <span class="result-label">Hash</span><span class="result-value">${hash}</span>
                <span class="result-label">DataHaven ID</span><span class="result-value">${formatDataHavenDisplay(dataHavenId)}${dataHavenLink}</span>
                <span class="result-label">Authority</span><span class="result-value">${authority}</span>
                <span class="result-label">Updated</span><span class="result-value">${formatTimestamp(timestamp)}</span>
            </div>
            ${revHtml}
            <h3 style="margin-top:24px;margin-bottom:12px;">Version History</h3>
            ${histHtml}
        `);
    } catch (err) {
        openModal(`<h2>Error</h2><p style="color:var(--accent-red);">${err.message || err}</p>`);
    }
}

// ═══════════════════════════════════════════════════════════
// REQUEST SYSTEM — localStorage-based queue
// ═══════════════════════════════════════════════════════════

function getRequests() {
    try { return JSON.parse(localStorage.getItem(REQUESTS_KEY) || '[]'); }
    catch { return []; }
}
function saveRequests(reqs) {
    localStorage.setItem(REQUESTS_KEY, JSON.stringify(reqs));
}

function initRequestPage() {
    document.getElementById('btn-submit-request').addEventListener('click', handleSubmitRequest);
}

function handleSubmitRequest() {
    if (!connectedAddress) { showToast('Connect wallet first', 'error'); return; }

    const typeVal = document.getElementById('req-type').value;
    const action = document.getElementById('req-action').value;
    const dataStr = document.getElementById('req-data').value.trim();
    const notes = document.getElementById('req-notes').value.trim();

    if (!dataStr) { showToast('Enter your data', 'error'); return; }
    try {
        JSON.parse(dataStr);
    } catch (e) {
        showToast('JSON Error: ' + e.message, 'error');
        console.error('JSON Parse Error:', e);
        return;
    }

    const dataHash = ethers.keccak256(ethers.toUtf8Bytes(dataStr));
    const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeVal));

    const req = {
        id: 'req_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
        timestamp: new Date().toISOString(),
        requester: connectedAddress,
        credentialType: typeVal,
        typeHash: typeHash,
        action: action,
        rawData: dataStr,
        dataHash: dataHash,
        notes: notes,
        status: 'pending'
    };

    const reqs = getRequests();
    reqs.push(req);
    saveRequests(reqs);

    showToast(`Request submitted! It will appear in the ${typeVal} authority's inbox.`, 'success');

    // Clear form
    document.getElementById('req-data').value = '';
    document.getElementById('req-notes').value = '';

    // Refresh user's request list
    renderMyRequests();
}

function renderMyRequests() {
    const container = document.getElementById('my-requests-list');
    if (!connectedAddress) { container.innerHTML = '<p style="color:var(--text-muted);">Connect wallet to see requests.</p>'; return; }

    const reqs = getRequests().filter(r => r.requester.toLowerCase() === connectedAddress.toLowerCase());

    if (reqs.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">No requests submitted yet.</p>';
        return;
    }

    container.innerHTML = reqs.slice().reverse().map(r => {
        const statusClass = r.status === 'accepted' ? 'badge-green' : r.status === 'rejected' ? 'badge-red' : 'badge-indigo';
        const statusLabel = r.status === 'accepted' ? '✓ Accepted' : r.status === 'rejected' ? '✕ Rejected' : '⏳ Pending';
        return `<div class="request-card">
            <div class="request-card-header">
                <span>${getTypeIcon(r.credentialType)} <strong>${r.credentialType}</strong> — ${r.action === 'issue' ? 'New' : 'Modify'}</span>
                <span class="badge ${statusClass}">${statusLabel}</span>
            </div>
            <div class="request-card-meta">
                <span>Submitted: ${new Date(r.timestamp).toLocaleString()}</span>
                ${r.txHash ? `<span>Tx: ${r.txHash.slice(0, 14)}…</span>` : ''}
            </div>
            ${r.notes ? `<div class="request-card-notes">${r.notes}</div>` : ''}
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════════════════════
// INBOX — Authority sees pending requests
// ═══════════════════════════════════════════════════════════

function loadInbox() {
    const container = document.getElementById('inbox-list');
    const reqs = getRequests().filter(r => {
        // Show requests for credential types this authority manages
        return r.status === 'pending' && authorityTypes.includes(r.credentialType);
    });

    // Update badge count
    const badge = document.getElementById('inbox-count');
    if (reqs.length > 0) {
        badge.style.display = 'inline';
        badge.textContent = reqs.length;
    } else {
        badge.style.display = 'none';
    }

    if (reqs.length === 0) {
        container.innerHTML = `<div class="empty-state">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></svg>
            <p>No pending requests</p></div>`;
        return;
    }

    container.innerHTML = reqs.map(r => `
        <div class="inbox-card" id="inbox-${r.id}">
            <div class="inbox-card-header">
                <div>
                    <span class="badge badge-indigo">${r.action === 'issue' ? 'NEW' : 'MODIFY'}</span>
                    <strong style="margin-left:8px;">${getTypeIcon(r.credentialType)} ${r.credentialType}</strong>
                </div>
                <span style="font-size:0.75rem;color:var(--text-muted);">${new Date(r.timestamp).toLocaleString()}</span>
            </div>
            <div class="inbox-card-body">
                <div class="result-grid">
                    <span class="result-label">Requester</span><span class="result-value">${r.requester}</span>
                    <span class="result-label">Data Hash</span><span class="result-value">${r.dataHash}</span>
                </div>
                ${r.notes ? `<div class="request-card-notes" style="margin-top:12px;">📝 ${r.notes}</div>` : ''}
                <details style="margin-top:12px;">
                    <summary style="cursor:pointer;color:var(--accent-cyan);font-size:0.82rem;">View Raw Data</summary>
                    <pre style="background:var(--bg-input);border:1px solid var(--border-default);border-radius:8px;padding:12px;margin-top:8px;font-size:0.78rem;overflow-x:auto;color:var(--text-secondary);">${escapeHtml(r.rawData)}</pre>
                </details>
            </div>
            <div class="inbox-card-actions">
                <button class="btn-primary" onclick="handleAcceptRequest('${r.id}')">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
                    Accept & Sign
                </button>
                <button class="btn-danger btn-sm" onclick="handleRejectRequest('${r.id}')">Reject</button>
            </div>
        </div>
    `).join('');
}

async function handleAcceptRequest(reqId) {
    if (!contract || !signer) { showToast('Connect wallet', 'error'); return; }

    const reqs = getRequests();
    const req = reqs.find(r => r.id === reqId);
    if (!req) { showToast('Request not found', 'error'); return; }

    const cardEl = document.getElementById('inbox-' + reqId);
    if (cardEl) {
        const btns = cardEl.querySelector('.inbox-card-actions');
        btns.innerHTML = '<span class="spinner"></span> Signing & submitting...';
    }

    try {
        const credentialTypeHash = ethers.keccak256(ethers.toUtf8Bytes(req.credentialType));
        const credentialHash = ethers.keccak256(ethers.toUtf8Bytes(req.rawData));

        const messageHash = ethers.solidityPackedKeccak256(
            ['address', 'bytes32', 'bytes32', 'address'],
            [req.requester, credentialTypeHash, credentialHash, CONTRACT_ADDRESS]
        );
        const msgBytes = ethers.getBytes(messageHash);
        const flatSig = await signer.signMessage(msgBytes);
        const sig = ethers.Signature.from(flatSig);

        let tx;
        if (req.action === 'issue') {
            // Store data in DataHaven
            let dataHavenId = 'none';
            try {
                const parsed = JSON.parse(req.rawData);
                const id = await storeInDataHaven(parsed);
                if (id) dataHavenId = id;
            } catch (e) { console.warn('DataHaven store skipped:', e.message); }


            tx = await contract.issueCredentialV2(
                req.requester, credentialTypeHash, credentialHash, dataHavenId,
                sig.v, sig.r, sig.s
            );
        } else {
            // Modify/update existing
            let newDataHavenId = 'none';
            try {
                const parsed = JSON.parse(req.rawData);
                const id = await storeInDataHaven(parsed);
                if (id) newDataHavenId = id;
            } catch (e) { console.warn('DataHaven store skipped:', e.message); }

            tx = await contract.updateCredential(
                req.requester, credentialTypeHash, credentialHash, newDataHavenId,
                sig.v, sig.r, sig.s
            );
        }

        showToast('Tx sent: ' + tx.hash.slice(0, 14) + '...', 'info');
        await tx.wait();

        // Mark accepted
        req.status = 'accepted';
        req.txHash = tx.hash;
        req.respondedAt = new Date().toISOString();
        saveRequests(reqs);

        showToast(`Credential ${req.action === 'issue' ? 'issued' : 'updated'} successfully!`, 'success');
        loadInbox();

    } catch (err) {
        console.error(err);
        showToast('Failed: ' + (err.reason || err.message || err), 'error');
        loadInbox(); // Reset UI
    }
}

function handleRejectRequest(reqId) {
    const reqs = getRequests();
    const req = reqs.find(r => r.id === reqId);
    if (!req) return;

    if (!confirm('Reject this request from ' + req.requester.slice(0, 10) + '...?')) return;

    req.status = 'rejected';
    req.respondedAt = new Date().toISOString();
    saveRequests(reqs);

    showToast('Request rejected', 'info');
    loadInbox();
}

// ═══════════════════════════════════════════════════════════
// MANAGE TAB — Issue / Update / Revoke
// ═══════════════════════════════════════════════════════════

function initManagePage() {
    document.getElementById('btn-manage-lookup').addEventListener('click', handleManageLookup);
    document.getElementById('btn-issue').addEventListener('click', handleIssue);
    document.getElementById('btn-update').addEventListener('click', handleUpdate);
    document.getElementById('btn-revoke').addEventListener('click', handleRevoke);
}

async function handleManageLookup() {
    if (!contract) return;
    const user = document.getElementById('manage-user').value.trim();
    const typeVal = document.getElementById('manage-type').value;
    if (!user || user.length < 10) { showToast('Invalid address', 'error'); return; }

    const resultDiv = document.getElementById('manage-result');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<span class="spinner"></span> Looking up...';
    document.getElementById('update-section').classList.add('hidden');
    document.getElementById('revoke-section').classList.add('hidden');

    try {
        const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeVal));
        const [hash, dataHavenId, authority, timestamp, revoked, version] = await contract.getCredential(user, typeHash);

        resultDiv.innerHTML = `<div class="manage-result" style="margin-bottom:0;">
            <div class="result-grid">
                <span class="result-label">Status</span><span class="result-value"><span class="badge ${revoked ? 'badge-red' : 'badge-green'}">${revoked ? 'Revoked' : 'Valid'}</span></span>
                <span class="result-label">Version</span><span class="result-value">${version.toString()}</span>
                <span class="result-label">Hash</span><span class="result-value">${hash}</span>
                <span class="result-label">DataHaven ID</span><span class="result-value">${formatDataHavenDisplay(dataHavenId)}</span>
                <span class="result-label">Authority</span><span class="result-value">${authority}</span>
                <span class="result-label">Updated</span><span class="result-value">${formatTimestamp(timestamp)}</span>
            </div></div>`;

        if (!revoked) {
            document.getElementById('update-section').classList.remove('hidden');
            document.getElementById('revoke-section').classList.remove('hidden');
        }
    } catch (err) {
        resultDiv.innerHTML = `<p style="color:var(--accent-amber);">Not found: ${err.reason || err.message}</p>`;
    }
}

async function handleIssue() {
    if (!contract || !signer) return;
    if (userRole === 'user') { showToast('Only authorities can issue', 'error'); return; }

    const btn = document.getElementById('btn-issue');
    const user = document.getElementById('issue-user').value.trim();
    const typeVal = document.getElementById('issue-type').value;
    const dataStr = document.getElementById('issue-data').value.trim();
    const dataHavenId = document.getElementById('issue-datahaven').value.trim() || 'none';

    if (!user || user.length < 10) { showToast('Invalid address', 'error'); return; }
    if (!dataStr) { showToast('Enter data', 'error'); return; }
    try { JSON.parse(dataStr); } catch { showToast('Invalid JSON', 'error'); return; }

    btn.innerHTML = '<span class="spinner"></span> Signing...';
    btn.disabled = true;

    try {
        const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeVal));
        const credHash = ethers.keccak256(ethers.toUtf8Bytes(dataStr));
        const msgHash = ethers.solidityPackedKeccak256(
            ['address', 'bytes32', 'bytes32', 'address'],
            [user, typeHash, credHash, CONTRACT_ADDRESS]
        );
        const flatSig = await signer.signMessage(ethers.getBytes(msgHash));
        const sig = ethers.Signature.from(flatSig);

        // Auto-store in DataHaven if user didn't manually store
        let finalDataHavenId = dataHavenId;
        if (finalDataHavenId === 'none') {
            try {
                const parsed = JSON.parse(dataStr);
                const id = await storeInDataHaven(parsed);
                if (id) {
                    finalDataHavenId = id;
                    document.getElementById('issue-datahaven').value = id;
                }
            } catch (e) { console.warn('Auto DataHaven store skipped:', e.message); }
        }

        const tx = await contract.issueCredentialV2(user, typeHash, credHash, finalDataHavenId, sig.v, sig.r, sig.s);
        showToast('Tx sent: ' + tx.hash.slice(0, 14) + '...', 'info');
        await tx.wait();
        showToast('Credential issued!', 'success');

        document.getElementById('issue-user').value = '';
        document.getElementById('issue-data').value = '';
        document.getElementById('issue-datahaven').value = '';
    } catch (err) {
        showToast('Issue failed: ' + (err.reason || err.message), 'error');
    } finally {
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg> Sign & Issue Credential`;
        btn.disabled = false;
    }
}

async function handleUpdate() {
    if (!contract || !signer) return;
    const btn = document.getElementById('btn-update');
    const user = document.getElementById('manage-user').value.trim();
    const typeVal = document.getElementById('manage-type').value;
    const dataStr = document.getElementById('update-data').value.trim();
    const newDataHavenId = document.getElementById('update-datahaven').value.trim() || 'none';

    if (!dataStr) { showToast('Enter new data', 'error'); return; }
    try { JSON.parse(dataStr); } catch { showToast('Invalid JSON', 'error'); return; }

    btn.innerHTML = '<span class="spinner"></span> Updating...';
    btn.disabled = true;

    try {
        const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeVal));
        const newHash = ethers.keccak256(ethers.toUtf8Bytes(dataStr));
        const msgHash = ethers.solidityPackedKeccak256(
            ['address', 'bytes32', 'bytes32', 'address'],
            [user, typeHash, newHash, CONTRACT_ADDRESS]
        );
        const flatSig = await signer.signMessage(ethers.getBytes(msgHash));
        const sig = ethers.Signature.from(flatSig);

        // Auto-store in DataHaven if user didn't manually store
        let finalDataHavenId = newDataHavenId;
        if (finalDataHavenId === 'none') {
            try {
                const parsed = JSON.parse(dataStr);
                const id = await storeInDataHaven(parsed);
                if (id) {
                    finalDataHavenId = id;
                    document.getElementById('update-datahaven').value = id;
                }
            } catch (e) { console.warn('Auto DataHaven store skipped:', e.message); }
        }

        const tx = await contract.updateCredential(user, typeHash, newHash, finalDataHavenId, sig.v, sig.r, sig.s);
        showToast('Tx sent: ' + tx.hash.slice(0, 14) + '...', 'info');
        await tx.wait();
        showToast('Credential updated!', 'success');
        handleManageLookup();
    } catch (err) {
        showToast('Update failed: ' + (err.reason || err.message), 'error');
    } finally {
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/></svg> Sign & Update`;
        btn.disabled = false;
    }
}

async function handleRevoke() {
    if (!contract) return;
    const btn = document.getElementById('btn-revoke');
    const user = document.getElementById('manage-user').value.trim();
    const typeVal = document.getElementById('manage-type').value;
    const reason = document.getElementById('revoke-reason').value.trim();

    if (!reason) { showToast('Enter a reason', 'error'); return; }
    if (!confirm(`Revoke ${typeVal} credential for ${user.slice(0, 10)}...? This is permanent.`)) return;

    btn.innerHTML = '<span class="spinner"></span> Revoking...';
    btn.disabled = true;

    try {
        const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeVal));
        const tx = await contract.revokeCredential(user, typeHash, reason);
        showToast('Tx sent...', 'info');
        await tx.wait();
        showToast('Credential revoked.', 'success');
        handleManageLookup();
    } catch (err) {
        showToast('Revoke failed: ' + (err.reason || err.message), 'error');
    } finally {
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg> Revoke Credential`;
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════
// SET AUTHORITIES — Government only
// ═══════════════════════════════════════════════════════════

async function loadAuthorityAssignments() {
    const container = document.getElementById('authority-list');
    container.innerHTML = '<span class="spinner"></span>';

    const c = contract || readContract;
    if (!c) return;

    let html = '<div class="authority-grid">';
    for (const typeName of KNOWN_TYPES) {
        try {
            const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeName));
            const auth = await c.authorities(typeHash);
            const isSet = auth && auth !== '0x0000000000000000000000000000000000000000';
            html += `<div class="authority-row">
                <div class="authority-type">${getTypeIcon(typeName)} ${typeName}</div>
                <div class="authority-addr ${isSet ? '' : 'empty'}">${isSet ? auth : 'Not assigned'}</div>
            </div>`;
        } catch (e) {
            html += `<div class="authority-row"><div class="authority-type">${typeName}</div><div class="authority-addr empty">Error</div></div>`;
        }
    }
    html += '</div>';
    container.innerHTML = html;

    // Wire up set authority button
    document.getElementById('btn-set-authority').addEventListener('click', handleSetAuthority);
}

async function handleSetAuthority() {
    if (!contract || userRole !== 'government') { showToast('Only government can set authorities', 'error'); return; }

    const btn = document.getElementById('btn-set-authority');
    const typeVal = document.getElementById('set-auth-type').value;
    const addr = document.getElementById('set-auth-address').value.trim();

    if (!addr || addr.length < 10) { showToast('Invalid address', 'error'); return; }

    btn.innerHTML = '<span class="spinner"></span> Setting...';
    btn.disabled = true;

    try {
        const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeVal));
        const tx = await contract.setAuthority(typeHash, addr);
        showToast('Tx sent...', 'info');
        await tx.wait();
        showToast(`Authority for ${typeVal} set to ${addr.slice(0, 10)}...`, 'success');
        loadAuthorityAssignments();
    } catch (err) {
        showToast('Failed: ' + (err.reason || err.message), 'error');
    } finally {
        btn.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg> Set Authority`;
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════
// VERIFY TAB
// ═══════════════════════════════════════════════════════════

function initVerifyPage() {
    document.getElementById('btn-verify').addEventListener('click', handleVerify);
    document.getElementById('btn-verify-hash').addEventListener('click', handleVerifyHash);
}

async function handleVerify() {
    const c = contract || readContract;
    if (!c) { showToast('No provider', 'error'); return; }
    const user = document.getElementById('verify-user').value.trim();
    const typeVal = document.getElementById('verify-type').value;
    if (!user || user.length < 10) { showToast('Invalid address', 'error'); return; }

    const resultDiv = document.getElementById('verify-result');
    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<div style="text-align:center;padding:24px;"><span class="spinner"></span></div>';

    try {
        const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeVal));
        const isValid = await c.isCredentialValid(user, typeHash);

        if (!isValid) {
            try {
                const [, , , , revoked] = await c.getCredential(user, typeHash);
                if (revoked) {
                    const [, reason, revTs, revAuth] = await c.getRevocationInfo(user, typeHash);
                    resultDiv.innerHTML = `<div class="verify-card revoked"><div class="verify-status"><div class="verify-status-icon revoked">✕</div><div class="verify-status-text"><h3 style="color:var(--accent-red);">Credential Revoked</h3><p>Reason: ${reason || 'N/A'}</p></div></div><div class="result-grid"><span class="result-label">Revoked</span><span class="result-value">${formatTimestamp(revTs)}</span><span class="result-label">By</span><span class="result-value">${revAuth}</span></div></div>`;
                    return;
                }
            } catch { }
            resultDiv.innerHTML = `<div class="verify-card not-found"><div class="verify-status"><div class="verify-status-icon not-found">?</div><div class="verify-status-text"><h3 style="color:var(--accent-amber);">Not Found</h3><p>No ${typeVal} credential for this wallet.</p></div></div></div>`;
            return;
        }

        const [hash, dataHavenId, authority, timestamp, , version] = await c.getCredential(user, typeHash);
        const [hashes, dataHavenIds, timestamps, auths] = await c.getCredentialHistory(user, typeHash);

        let histHtml = '<div class="history-timeline">';
        for (let i = hashes.length - 1; i >= 0; i--) {
            histHtml += `<div class="history-item">
                <div class="hi-version">v${i + 1} ${i === hashes.length - 1 ? '<span class="badge badge-indigo">Latest</span>' : ''}</div>
                <div class="hi-hash">Hash: ${hashes[i]}</div>
                <div class="hi-dhid">DataHaven: ${formatDataHavenDisplay(dataHavenIds[i])}</div>
                <div class="hi-time">${formatTimestamp(timestamps[i])}</div>
            </div>`;
        }
        histHtml += '</div>';

        resultDiv.innerHTML = `<div class="verify-card valid"><div class="verify-status"><div class="verify-status-icon valid">✓</div><div class="verify-status-text"><h3 style="color:var(--accent-green);">Credential Valid</h3><p>${typeVal} — active and verified on-chain</p></div></div>
            <div class="result-grid" style="margin-top:16px;"><span class="result-label">Version</span><span class="result-value">${version.toString()}</span>
            <span class="result-label">Hash</span><span class="result-value">${hash}</span>
            <span class="result-label">DataHaven ID</span><span class="result-value">${formatDataHavenDisplay(dataHavenId)}</span>
            <span class="result-label">Authority</span><span class="result-value">${authority}</span>
            <span class="result-label">Updated</span><span class="result-value">${formatTimestamp(timestamp)}</span></div>
            <h3 style="margin-top:24px;margin-bottom:12px;">History</h3>${histHtml}</div>`;
    } catch (err) {
        resultDiv.innerHTML = `<div class="verify-card not-found"><p style="color:var(--accent-red);">${err.reason || err.message}</p></div>`;
    }
}

async function handleVerifyHash() {
    const c = contract || readContract;
    if (!c) { showToast('No provider', 'error'); return; }
    const user = document.getElementById('verify-hash-user').value.trim();
    const typeVal = document.getElementById('verify-hash-type').value;
    const dataStr = document.getElementById('verify-hash-data').value.trim();
    const resultDiv = document.getElementById('verify-hash-result');

    if (!user) { showToast('Enter address', 'error'); return; }
    if (!dataStr) { showToast('Enter data', 'error'); return; }

    resultDiv.classList.remove('hidden');
    resultDiv.innerHTML = '<span class="spinner"></span>';

    try {
        const typeHash = ethers.keccak256(ethers.toUtf8Bytes(typeVal));
        const computed = ethers.keccak256(ethers.toUtf8Bytes(dataStr));
        const matches = await c.verifyCredentialHash(user, typeHash, computed);

        resultDiv.innerHTML = matches
            ? `<div class="hash-match"><span style="font-size:1.5rem;">✓</span><div><div>Hash Match — Data is Authentic</div><div style="font-size:0.75rem;color:var(--text-secondary);margin-top:4px;">Hash: ${computed.slice(0, 18)}…</div></div></div>`
            : `<div class="hash-mismatch"><span style="font-size:1.5rem;">✕</span><div><div>Hash Mismatch — Data does NOT match on-chain</div><div style="font-size:0.75rem;color:var(--text-secondary);margin-top:4px;">Hash: ${computed.slice(0, 18)}…</div></div></div>`;
    } catch (err) {
        resultDiv.innerHTML = `<p style="color:var(--accent-red);">${err.reason || err.message}</p>`;
    }
}

// ═══════════════════════════════════════════════════════════
// MODAL
// ═══════════════════════════════════════════════════════════

function initModal() {
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(); });
}
function openModal(html) {
    document.getElementById('modal-body').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}
function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
    document.body.style.overflow = '';
}

// ═══════════════════════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════════════════════

function showToast(msg, type = 'info') {
    const icons = { success: '✓', error: '✕', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-icon">${icons[type] || 'ℹ'}</span><span>${msg}</span>`;
    document.getElementById('toast-container').appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0'; toast.style.transform = 'translateX(20px)'; toast.style.transition = 'all 0.3s ease';
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ═══════════════════════════════════════════════════════════
// DATAHAVEN STORAGE
// ═══════════════════════════════════════════════════════════

let dataHavenStatus = 'unknown'; // 'online' | 'offline' | 'unknown'

function isValidDataHavenId(id) {
    if (!id || id === 'none' || id === 'N/A' || id === '') return false;
    return id.length > 10;
}

function formatDataHavenDisplay(id) {
    if (isValidDataHavenId(id)) {
        const shortId = id.length > 12 ? id.slice(0, 8) + '…' + id.slice(-4) : id;
        return `<a href="http://localhost:3001/api/datahaven/retrieve/${encodeURIComponent(id)}" target="_blank" style="color:var(--accent-cyan);text-decoration:underline;">${shortId}</a>`;
    }
    return '<span style="color:var(--text-muted);">Not stored</span>';
}

async function checkDataHavenHealth() {
    try {
        const resp = await fetch('http://localhost:3001/api/datahaven/health', { signal: AbortSignal.timeout(5000) });
        if (resp.ok) {
            const data = await resp.json();
            dataHavenStatus = data.sdkReady ? 'online' : 'local-only';
            console.log('DataHaven status:', dataHavenStatus, data);
            return data;
        }
    } catch (e) {
        dataHavenStatus = 'offline';
        console.warn('DataHaven health check failed:', e.message);
    }
    return null;
}

async function storeInDataHaven(jsonData, retries = 2) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            const resp = await fetch('http://localhost:3001/api/datahaven/store', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: jsonData }),
                signal: AbortSignal.timeout(30000),
            });
            if (!resp.ok) {
                const errBody = await resp.json().catch(() => ({}));
                throw new Error(errBody.error || 'DataHaven store error: ' + resp.statusText);
            }
            const result = await resp.json();
            if (result.storage && result.storage !== 'local-fallback') {
                console.log(`📦 Stored via: ${result.storage}`);
            }
            return result.dataHavenId;
        } catch (err) {
            lastErr = err;
            console.warn(`DataHaven store attempt ${attempt + 1} failed:`, err.message);
            if (attempt < retries) {
                // Try re-auth before retry
                try { await fetch('http://localhost:3001/api/datahaven/reauth', { method: 'POST' }); } catch { }
                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
            }
        }
    }
    throw lastErr;
}

async function handleAutoStore(dataFieldId, idFieldId) {
    const dataStr = document.getElementById(dataFieldId).value.trim();
    if (!dataStr) { showToast('Enter data first', 'error'); return; }
    let parsed;
    try { parsed = JSON.parse(dataStr); } catch { showToast('Invalid JSON', 'error'); return; }
    showToast('Storing in DataHaven...', 'info');
    try {
        const id = await storeInDataHaven(parsed);
        if (id) {
            document.getElementById(idFieldId).value = id;
            showToast('Stored! ID: ' + (id.length > 20 ? id.slice(0, 12) + '…' : id), 'success');
        } else {
            showToast('Store returned no ID', 'error');
        }
    } catch (err) { showToast('Store failed: ' + err.message, 'error'); }
}

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

function resolveTypeName(typeHash) {
    for (const key of KNOWN_TYPES) {
        if (ethers.keccak256(ethers.toUtf8Bytes(key)) === typeHash) return key;
    }
    return typeHash.slice(0, 10) + '…';
}
function getTypeIcon(name) { return CREDENTIAL_ICONS[name] || '📄'; }
function formatTimestamp(ts) {
    const n = typeof ts === 'bigint' ? Number(ts) : Number(ts);
    return n === 0 ? 'N/A' : new Date(n * 1000).toLocaleString();
}
function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Smart JSON Formatter
 * Attempts to fix unquoted keys and format the data
 */
function tryFormatJson(textareaId) {
    const el = document.getElementById(textareaId);
    let val = el.value.trim();
    if (!val) return;

    try {
        // First try standard parse
        const obj = JSON.parse(val);
        el.value = JSON.stringify(obj, null, 2);
        showToast('JSON Formatted!', 'success');
    } catch (e) {
        try {
            // Try to fix unquoted keys using a relaxed evaluation (danger: use only for formatting)
            // Replace keys like { name: ... } with { "name": ... }
            const fixed = val
                .replace(/(['"])?([a-zA-Z0-9_]+)(['"])?:/g, '"$2":') // fix keys
                .replace(/'/g, '"'); // fix single quotes

            const obj = JSON.parse(fixed);
            el.value = JSON.stringify(obj, null, 2);
            showToast('Fixed quotes & formatted!', 'success');
        } catch (err) {
            showToast('Could not auto-fix. Please check quotes manually.', 'error');
        }
    }
}
