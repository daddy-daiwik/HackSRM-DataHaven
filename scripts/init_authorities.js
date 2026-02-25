const quais = require('quais');
const fs = require('fs');
require('dotenv').config();

async function init() {
    const CONTRACT_ADDRESS = fs.readFileSync('deployed_address.txt', 'utf8').trim();
    const PRIVATE_KEY = process.env.QUAI_PRIVATE_KEY;
    const RPC = 'https://orchard.rpc.quai.network';

    const provider = new quais.JsonRpcProvider(RPC, undefined, { usePathing: true });
    const wallet = new quais.Wallet(PRIVATE_KEY, provider);
    const govAddr = await wallet.getAddress();

    console.log('Contract:', CONTRACT_ADDRESS);
    console.log('Government:', govAddr);

    const abi = [
        "function setAuthority(bytes32 credentialType, address authority) public"
    ];

    const contract = new quais.Contract(CONTRACT_ADDRESS, abi, wallet);
    const types = ['PERSONAL', 'EDUCATION', 'EMPLOYMENT', 'MEDICAL', 'FINANCIAL'];

    for (const type of types) {
        const typeHash = quais.keccak256(quais.toUtf8Bytes(type));
        console.log(`Setting authority for ${type} (${typeHash})...`);
        const tx = await contract.setAuthority(typeHash, govAddr);
        console.log(`Tx: ${tx.hash}`);
        await tx.wait();
        console.log(`Confirmed.`);
    }

    console.log('\n✅ All authorities set to Government wallet.');
}

init().catch(console.error);
