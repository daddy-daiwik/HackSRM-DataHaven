from eth_account import Account

acct = Account.create()
print("Private key:", acct.key.hex())
print("Public address:", acct.address)