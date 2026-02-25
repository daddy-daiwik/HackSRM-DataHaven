const quais = require('quais')

const RPC = 'https://orchard.rpc.quai.network'
const PRIVATE_KEY = '0x13d199f22241e23a74aee59b718ac5942151b3b0d00697204f564fd757b030a8'
const CONTRACT = '0x006A536bcc5F927AF5a58c7bBef05eab36d4C87F'

const abi = [
    // V1 legacy issue (kept for reference)
    {
        inputs: [
            { internalType: "address", name: "user", type: "address" },
            { internalType: "bytes32", name: "credentialType", type: "bytes32" },
            { internalType: "bytes32", name: "credentialHash", type: "bytes32" },
            { internalType: "uint8", name: "v", type: "uint8" },
            { internalType: "bytes32", name: "r", type: "bytes32" },
            { internalType: "bytes32", name: "s", type: "bytes32" }
        ],
        name: "issueCredential",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    // V2 issue with IPFS
    {
        inputs: [
            { internalType: "address", name: "user", type: "address" },
            { internalType: "bytes32", name: "credentialType", type: "bytes32" },
            { internalType: "bytes32", name: "credentialHash", type: "bytes32" },
            { internalType: "string",  name: "ipfsCid", type: "string" },
            { internalType: "uint8",   name: "v", type: "uint8" },
            { internalType: "bytes32", name: "r", type: "bytes32" },
            { internalType: "bytes32", name: "s", type: "bytes32" }
        ],
        name: "issueCredentialV2",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [
            { internalType: "address", name: "user", type: "address" },
            { internalType: "bytes32", name: "credentialType", type: "bytes32" }
        ],
        name: "getCredentialHash",
        outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [
            { internalType: "address", name: "", type: "address" },
            { internalType: "bytes32", name: "", type: "bytes32" }
        ],
        name: "credentials",
        outputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [
            { internalType: "address", name: "user", type: "address" },
            { internalType: "bytes32", name: "credentialType", type: "bytes32" }
        ],
        name: "getCredential",
        outputs: [
            { internalType: "bytes32", name: "credentialHash", type: "bytes32" },
            { internalType: "string",  name: "ipfsCid", type: "string" },
            { internalType: "address", name: "authority", type: "address" },
            { internalType: "uint256", name: "timestamp", type: "uint256" },
            { internalType: "bool",    name: "revoked", type: "bool" },
            { internalType: "uint256", name: "version", type: "uint256" }
        ],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [{ internalType: "address", name: "user", type: "address" }],
        name: "getUserCredentialTypes",
        outputs: [{ internalType: "bytes32[]", name: "", type: "bytes32[]" }],
        stateMutability: "view",
        type: "function"
    }
]

async function issueCredential() {
    console.log('Issuing credential V2 on SuperAuth contract...\n')

    const provider = new quais.JsonRpcProvider(RPC, undefined, { usePathing: true })
    const wallet = new quais.Wallet(PRIVATE_KEY, provider)
    console.log('Issuer address:', await wallet.getAddress())

    const contract = new quais.Contract(CONTRACT, abi, wallet)

    // ---- INPUT ----
    const user = '0x0076FeE06D650B33988addDee6A4a2f9A474112e'
    const credentialTypeHash = quais.keccak256(quais.toUtf8Bytes('PERSONAL'))

    const data = {
        name: "Anmol Sarkar",
        dob: "2000-01-01",
        birthplace: "pune",
        father: "Joydeep Sarkar",
        mother: "Sampa Sarkar",
        gender: "male",
        citizenship: "indian",
        main_address: "pune",
        married: "false",
        spouse: ""
    }

    const dataStr = JSON.stringify(data)
    const credentialHash = quais.keccak256(quais.toUtf8Bytes(dataStr))

    // IPFS CID — for now use a placeholder; replace with real CID after pinning
    const ipfsCid = 'QmPlaceholder_TestCredential_AnmolSarkar_PERSONAL'

    console.log('User:', user)
    console.log('Credential type:', credentialTypeHash)
    console.log('Credential hash:', credentialHash)
    console.log('IPFS CID:', ipfsCid)

    // Create replay-protected message hash (matches Solidity abi.encodePacked)
    const messageHash = quais.solidityPackedKeccak256(
        ['address', 'bytes32', 'bytes32', 'address'],
        [user, credentialTypeHash, credentialHash, CONTRACT]
    )

    // Sign with Ethereum prefix (\x19Ethereum Signed Message:\n32)
    const signature = wallet.signingKey.sign(quais.hashMessage(quais.getBytes(messageHash)))

    console.log('Signature v:', signature.v)

    console.log('\nSending issueCredentialV2 transaction...')
    const tx = await contract.issueCredentialV2(
        user,
        credentialTypeHash,
        credentialHash,
        ipfsCid,
        signature.v,
        signature.r,
        signature.s
    )
    console.log('Transaction hash:', tx.hash)

    console.log('Waiting for confirmation...')
    const receipt = await tx.wait()
    console.log('\nCredential issued successfully!')
    console.log('Block:', receipt.blockNumber)

    // Verify — read it back
    console.log('\n--- Verification ---')
    try {
        const result = await contract.getCredential(user, credentialTypeHash)
        console.log('Stored hash:', result[0])
        console.log('Stored CID:', result[1])
        console.log('Authority:', result[2])
        console.log('Timestamp:', result[3].toString())
        console.log('Revoked:', result[4])
        console.log('Version:', result[5].toString())
    } catch (e) {
        console.log('Read-back failed (may need different RPC):', e.message)
    }
}

issueCredential()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\nFailed:', error.message || error)
        process.exit(1)
    })
