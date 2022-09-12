oracle-api
==========

This is a serverless oracle API developed using Cloudflare Worker framework.

The service accepts HTTP GET queries on `/?chainHandle=[eth-pow-mainnet,eth-pos-mainnet]`, and returns a JSON response of the type `OracleResponse` (see code).

`OracleResponse` contains a field `envelope`, containing the oracle data under `message` and the `signature`. `message` is [ABI](https://docs.soliditylang.org/en/v0.8.16/abi-spec.html)-encoded as `(uint256 chainId, uint256 blockNumber, bytes32 blockHash)` for the latest block returned by the chain provider. The API also returns `chainId` and `signerAccount` for descriptive purposes.

## Setup.

This uses Cloudflare's `wrangler` CLI tool.

```sh
npm i -G wrangler
wrangler login
```

## Develop.

```sh
npm run start --local

# Fetches signed oracle response for chainID=1.
# open http://127.0.0.1:8787/?chainId=1
```

## Deploy.

Configure the `PRIVATE_KEY` variable in prod:

```sh
# Generate a private key.
node ./scripts/create_wallet.js

# Set.
echo "$PRIVATE_KEY_HERE" | wrangler secret put PRIVATE_KEY
```

Publish worker:

```sh
wrangler publish src/index.ts --name oracle-api
```
