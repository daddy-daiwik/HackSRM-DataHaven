from eth_utils import keccak

credential_type_hash = keccak(text="PERSONAL")
print(credential_type_hash.hex())