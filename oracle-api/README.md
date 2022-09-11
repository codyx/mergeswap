oracle-api
==========

This is a serverless oracle API developed using Cloudflare Worker framework.

The service accepts HTTP GET queries on `/?chainId=XYZ`, and returns a signed response of the type `OracleResponse` (see code).

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
