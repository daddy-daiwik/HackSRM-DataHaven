const quais = require('quais')
const SuperAuthJson = require('../artifacts/contracts/main.sol/SuperAuth.json')
const { deployMetadata } = require('hardhat')
const fs = require('fs')
require('dotenv').config()

async function deploySuperAuth() {
    const rpcUrl = hre.network.config.url.replace(/\/cyprus\d+$/, '') || 'https://orchard.rpc.quai.network'
    const provider = new quais.JsonRpcProvider(rpcUrl, undefined, { usePathing: true })
    const wallet = new quais.Wallet(hre.network.config.accounts[0], provider)
    const deployerAddress = await wallet.getAddress()

    console.log('Deployer: ' + deployerAddress)

    let ipfsHash
    try {
        ipfsHash = await deployMetadata.pushMetadataToIPFS('SuperAuth')
    } catch (e) {
        ipfsHash = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG'
    }

    const SuperAuth = new quais.ContractFactory(
        SuperAuthJson.abi,
        SuperAuthJson.bytecode,
        wallet,
        ipfsHash
    )

    const governmentAddress = deployerAddress
    console.log('Deploying...')
    const superAuth = await SuperAuth.deploy(governmentAddress)
    console.log('Tx: ' + superAuth.deploymentTransaction().hash)

    console.log('Waiting for confirmation...')
    await superAuth.waitForDeployment()

    const contractAddress = await superAuth.getAddress()
    console.log('CONTRACT_ADDRESS=' + contractAddress)

    // Save to file for easy reading
    fs.writeFileSync('deployed_address.txt', contractAddress, 'utf8')
    console.log('Address saved to deployed_address.txt')

    return contractAddress
}

deploySuperAuth()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error('FAILED: ' + (error.message || error))
        process.exit(1)
    })
