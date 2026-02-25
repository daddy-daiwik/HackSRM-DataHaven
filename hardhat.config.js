/**
 * @type import('hardhat/config').HardhatUserConfig
 */

require('@nomicfoundation/hardhat-toolbox')
require('@quai/hardhat-deploy-metadata')
const dotenv = require('dotenv')
dotenv.config()

const PRIVATE_KEY = process.env.QUAI_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000000'

module.exports = {
  defaultNetwork: 'cyprus1',
  networks: {
    cyprus1: {
      url: 'https://orchard.rpc.quai.network/cyprus1',
      accounts: [PRIVATE_KEY],
      chainId: 15000,
    },
  },

  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: {
        enabled: true,
        runs: 1000,
      },
      evmVersion: 'london',
    },
  },

  paths: {
    sources: './contracts',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: {
    timeout: 20000,
  },
}
