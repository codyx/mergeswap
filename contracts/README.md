# MergeSwap Contracts

## Getting Started

Create a `.env` file with actual values (see `.env.example` as an example format).

Install the packages:
```shell
yarn
```

Install [Foundry](https://book.getfoundry.sh/getting-started/installation). Run two local blockchain networks:

```sh
anvil --port 8545
anvil --port 8546
```

## Compile
```shell
npx hardhat compile
```

## Test
```shell
GAS_REPORT=true npx hardhat test
```

### Deploy & Verify bytecode
```shell
npm run deploy:pow

npm run deploy:pos
```