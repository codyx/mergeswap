set -ex

curl -s http://localhost:8787/\?chainHandle\=eth-pow-mainnet | jq

# curl -s https://oracle-staging.magicaccess.workers.dev/\?chainHandle\=eth-pow-mainnet | jq