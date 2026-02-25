from web3 import Web3
from eth_account import Account
from eth_utils import keccak

RPC = "https://orchard.rpc.quai.network/cyprus1"
PRIVATE_KEY = "0x703d745d77f622cabd37865187f5849ca97d4233e886db419708697643cce036"
CONTRACT = "0x006A536bcc5F927AF5a58c7bBef05eab36d4C87F"

w3 = Web3(Web3.HTTPProvider(RPC))
acct = Account.from_key(PRIVATE_KEY)

abi = [
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "user",
				"type": "address"
			},
			{
				"internalType": "bytes32",
				"name": "credentialType",
				"type": "bytes32"
			},
			{
				"internalType": "bytes32",
				"name": "credentialHash",
				"type": "bytes32"
			},
			{
				"internalType": "uint8",
				"name": "v",
				"type": "uint8"
			},
			{
				"internalType": "bytes32",
				"name": "r",
				"type": "bytes32"
			},
			{
				"internalType": "bytes32",
				"name": "s",
				"type": "bytes32"
			}
		],
		"name": "issueCredential",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "bytes32",
				"name": "credentialType",
				"type": "bytes32"
			},
			{
				"internalType": "address",
				"name": "authority",
				"type": "address"
			}
		],
		"name": "setAuthority",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "_government",
				"type": "address"
			}
		],
		"stateMutability": "nonpayable",
		"type": "constructor"
	},
	{
		"inputs": [
			{
				"internalType": "bytes32",
				"name": "",
				"type": "bytes32"
			}
		],
		"name": "authorities",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			},
			{
				"internalType": "bytes32",
				"name": "",
				"type": "bytes32"
			}
		],
		"name": "credentials",
		"outputs": [
			{
				"internalType": "bytes32",
				"name": "",
				"type": "bytes32"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "get",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "user",
				"type": "address"
			},
			{
				"internalType": "bytes32",
				"name": "credentialType",
				"type": "bytes32"
			}
		],
		"name": "getCredentialHash",
		"outputs": [
			{
				"internalType": "bytes32",
				"name": "",
				"type": "bytes32"
			}
		],
		"stateMutability": "view",
		"type": "function"
	}
]  # paste ABI
contract = w3.eth.contract(address=CONTRACT, abi=abi)

credential_type = keccak(text="PERSONAL")
authority = "0x0067CFc221eD96c6CaC29963413cd7B6449C8fa0"

tx = contract.functions.setAuthority(
    credential_type,
    authority
).build_transaction({
    "from": acct.address,
    "nonce": w3.eth.get_transaction_count(acct.address),
    "gas": 200000,
    "gasPrice": w3.to_wei("20", "gwei")
})

signed = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
tx_hash = w3.eth.send_raw_transaction(signed.raw_transaction)

print("Authority set:", tx_hash.hex())