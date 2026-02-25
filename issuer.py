from web3 import Web3
from eth_account import Account
from eth_account.messages import encode_defunct
from eth_utils import keccak
import json

RPC = "https://orchard.rpc.quai.network/cyprus1"
PRIVATE_KEY = "0x13d199f22241e23a74aee59b718ac5942151b3b0d00697204f564fd757b030a8"
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
]   # paste ABI
contract = w3.eth.contract(address=CONTRACT, abi=abi)

# ---- INPUT ----
user = "0x0076FeE06D650B33988addDee6A4a2f9A474112e"
credential_type_hash = keccak(text="PERSONAL")

data = {
    "name": "Anmol Sarkar",
    "dob": "2000-01-01",
    "birthplace":"pune",
    "father":"Joydeep Sarkar",
    "mother":"Sampa Sarkar",
    "gender":"male",
    "citizenship":"indian",
    "main_address":"pune",
    "married":"false",
    "spouse":""
}

credential_hash = keccak(json.dumps(data).encode())

# create replay-protected message
message_hash = Web3.solidity_keccak(
    ["address", "bytes32", "bytes32", "address"],
    [user, credential_type_hash, credential_hash, CONTRACT]
)

message = encode_defunct(message_hash)
signed = acct.sign_message(message)

tx = contract.functions.issueCredential(
    user,
    credential_type_hash,
    credential_hash,
    signed.v,
    Web3.to_bytes(signed.r).rjust(32, b'\0'),
    Web3.to_bytes(signed.s).rjust(32, b'\0')
).build_transaction({
    "from": acct.address,
    "nonce": w3.eth.get_transaction_count(acct.address),
    "gas": 300000,
    "gasPrice": w3.to_wei("20", "gwei")
})

signed_tx = w3.eth.account.sign_transaction(tx, PRIVATE_KEY)
tx_hash = w3.eth.send_raw_transaction(signed_tx.raw_transaction)

print("Credential issued:", tx_hash.hex())