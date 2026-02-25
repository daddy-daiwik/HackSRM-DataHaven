const quais = require('quais')

const RPC = 'https://orchard.rpc.quai.network'
const PRIVATE_KEY = '0x703d745d77f622cabd37865187f5849ca97d4233e886db419708697643cce036'
const CONTRACT = '0x006A536bcc5F927AF5a58c7bBef05eab36d4C87F'

const abi = [
    {
        inputs: [{ internalType: "bytes32", name: "credentialType", type: "bytes32" }, { internalType: "address", name: "authority", type: "address" }],
        name: "setAuthority",
        outputs: [],
        stateMutability: "nonpayable",
        type: "function"
    },
    {
        inputs: [{ internalType: "bytes32", name: "", type: "bytes32" }],
        name: "authorities",
        outputs: [{ internalType: "address", name: "", type: "address" }],
        stateMutability: "view",
        type: "function"
    },
    {
        inputs: [],
        name: "get",
        outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
        stateMutability: "view",
        type: "function"
    }
]

async function setAuthority() {
    console.log('🏛️  Setting authority on SuperAuth contract...\n')

    const provider = new quais.JsonRpcProvider(RPC, undefined, { usePathing: true })
    const wallet = new quais.Wallet(PRIVATE_KEY, provider)
    console.log('📋 Sender (government):', await wallet.getAddress())

    const contract = new quais.Contract(CONTRACT, abi, wallet)

    // keccak256("PERSONAL")
    const credentialType = quais.keccak256(quais.toUtf8Bytes('PERSONAL'))
    const authority = '0x0067CFc221eD96c6CaC29963413cd7B6449C8fa0'

    console.log('📝 Credential type hash:', credentialType)
    console.log('👤 Authority address:', authority)

    console.log('\n📡 Sending setAuthority transaction...')
    const tx = await contract.setAuthority(credentialType, authority)
    console.log('📝 Transaction hash:', tx.hash)

    console.log('⏳ Waiting for confirmation...')
    const receipt = await tx.wait()
    console.log('\n✅ Authority set successfully!')
    console.log('📦 Block:', receipt.blockNumber)
}

setAuthority()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('\n❌ Failed:', error.message || error)
        process.exit(1)
    })
