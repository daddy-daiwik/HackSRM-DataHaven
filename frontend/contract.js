/**
 * SuperAuth V2 — Contract Configuration
 * 
 * Update CONTRACT_ADDRESS after each deployment.
 * The ABI below covers both legacy (V1) and new (V2) functions.
 */

const CONTRACT_ADDRESS = '0x006A536bcc5F927AF5a58c7bBef05eab36d4C87F'; // ← Deployed 2026-02-24
const GOVERNMENT_ADDRESS = '0x006377377C9B03a79B9DbA43ffEa362db255c243'; // ← Government wallet

const CONTRACT_ABI = [
  // ── Constructor ──
  { inputs: [{ internalType: "address", name: "_government", type: "address" }], stateMutability: "nonpayable", type: "constructor" },

  // ── Events ──
  {
    anonymous: false, inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: true, internalType: "bytes32", name: "credentialType", type: "bytes32" },
      { indexed: false, internalType: "bytes32", name: "credentialHash", type: "bytes32" },
      { indexed: false, internalType: "string", name: "ipfsCid", type: "string" },
      { indexed: false, internalType: "address", name: "authority", type: "address" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" }
    ], name: "CredentialIssued", type: "event"
  },

  {
    anonymous: false, inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: true, internalType: "bytes32", name: "credentialType", type: "bytes32" },
      { indexed: false, internalType: "bytes32", name: "newHash", type: "bytes32" },
      { indexed: false, internalType: "string", name: "newCid", type: "string" },
      { indexed: false, internalType: "bytes32", name: "previousHash", type: "bytes32" },
      { indexed: false, internalType: "uint256", name: "version", type: "uint256" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" }
    ], name: "CredentialUpdated", type: "event"
  },

  {
    anonymous: false, inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: true, internalType: "bytes32", name: "credentialType", type: "bytes32" },
      { indexed: false, internalType: "string", name: "reason", type: "string" },
      { indexed: false, internalType: "address", name: "authority", type: "address" },
      { indexed: false, internalType: "uint256", name: "timestamp", type: "uint256" }
    ], name: "CredentialRevoked", type: "event"
  },

  // ── Legacy V1 Functions ──
  { inputs: [], name: "get", outputs: [{ internalType: "uint256", name: "", type: "uint256" }], stateMutability: "view", type: "function" },

  {
    inputs: [{ internalType: "bytes32", name: "credentialType", type: "bytes32" }, { internalType: "address", name: "authority", type: "address" }],
    name: "setAuthority", outputs: [], stateMutability: "nonpayable", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }, { internalType: "bytes32", name: "credentialHash", type: "bytes32" }, { internalType: "uint8", name: "v", type: "uint8" }, { internalType: "bytes32", name: "r", type: "bytes32" }, { internalType: "bytes32", name: "s", type: "bytes32" }],
    name: "issueCredential", outputs: [], stateMutability: "nonpayable", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }],
    name: "getCredentialHash", outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }], stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "", type: "address" }, { internalType: "bytes32", name: "", type: "bytes32" }],
    name: "credentials", outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }], stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
    name: "authorities", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function"
  },

  // ── V2 Functions ──
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "bytes32", name: "credentialType", type: "bytes32" },
      { internalType: "bytes32", name: "credentialHash", type: "bytes32" },
      { internalType: "string", name: "ipfsCid", type: "string" },
      { internalType: "uint8", name: "v", type: "uint8" },
      { internalType: "bytes32", name: "r", type: "bytes32" },
      { internalType: "bytes32", name: "s", type: "bytes32" }
    ],
    name: "issueCredentialV2", outputs: [], stateMutability: "nonpayable", type: "function"
  },

  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "bytes32", name: "credentialType", type: "bytes32" },
      { internalType: "bytes32", name: "newCredentialHash", type: "bytes32" },
      { internalType: "string", name: "newIpfsCid", type: "string" },
      { internalType: "uint8", name: "v", type: "uint8" },
      { internalType: "bytes32", name: "r", type: "bytes32" },
      { internalType: "bytes32", name: "s", type: "bytes32" }
    ],
    name: "updateCredential", outputs: [], stateMutability: "nonpayable", type: "function"
  },

  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "bytes32", name: "credentialType", type: "bytes32" },
      { internalType: "string", name: "reason", type: "string" }
    ],
    name: "revokeCredential", outputs: [], stateMutability: "nonpayable", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }],
    name: "getCredential",
    outputs: [
      { internalType: "bytes32", name: "credentialHash", type: "bytes32" },
      { internalType: "string", name: "ipfsCid", type: "string" },
      { internalType: "address", name: "authority", type: "address" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
      { internalType: "bool", name: "revoked", type: "bool" },
      { internalType: "uint256", name: "version", type: "uint256" }
    ],
    stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }],
    name: "getLatestCredential",
    outputs: [
      { internalType: "bytes32", name: "credentialHash", type: "bytes32" },
      { internalType: "string", name: "ipfsCid", type: "string" },
      { internalType: "address", name: "authority", type: "address" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
      { internalType: "bool", name: "revoked", type: "bool" },
      { internalType: "uint256", name: "version", type: "uint256" }
    ],
    stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }, { internalType: "uint256", name: "versionIndex", type: "uint256" }],
    name: "getCredentialVersion",
    outputs: [
      { internalType: "bytes32", name: "credentialHash", type: "bytes32" },
      { internalType: "string", name: "ipfsCid", type: "string" },
      { internalType: "address", name: "authority", type: "address" },
      { internalType: "uint256", name: "timestamp", type: "uint256" }
    ],
    stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }],
    name: "getCredentialHistory",
    outputs: [
      { internalType: "bytes32[]", name: "hashes", type: "bytes32[]" },
      { internalType: "string[]", name: "cids", type: "string[]" },
      { internalType: "uint256[]", name: "timestamps", type: "uint256[]" },
      { internalType: "address[]", name: "auths", type: "address[]" }
    ],
    stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }],
    name: "isCredentialValid",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }],
    name: "getCredentialVersionCount",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }],
    name: "getRevocationInfo",
    outputs: [
      { internalType: "bool", name: "revoked", type: "bool" },
      { internalType: "string", name: "reason", type: "string" },
      { internalType: "uint256", name: "timestamp", type: "uint256" },
      { internalType: "address", name: "authority", type: "address" }
    ],
    stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "getUserCredentialTypes",
    outputs: [{ internalType: "bytes32[]", name: "", type: "bytes32[]" }],
    stateMutability: "view", type: "function"
  },

  {
    inputs: [{ internalType: "address", name: "user", type: "address" }, { internalType: "bytes32", name: "credentialType", type: "bytes32" }, { internalType: "bytes32", name: "hashToVerify", type: "bytes32" }],
    name: "verifyCredentialHash",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view", type: "function"
  }
];

// Known credential type labels for display
const CREDENTIAL_TYPES = {
  PERSONAL: 'Personal Identity',
  EDUCATION: 'Education',
  EMPLOYMENT: 'Employment',
  MEDICAL: 'Medical Records',
  FINANCIAL: 'Financial',
};

// Credential type icons
const CREDENTIAL_ICONS = {
  PERSONAL: '🪪',
  EDUCATION: '🎓',
  EMPLOYMENT: '💼',
  MEDICAL: '🏥',
  FINANCIAL: '🏦',
};

// IPFS gateway for viewing raw data
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
