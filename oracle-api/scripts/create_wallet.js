const ethers = require('ethers')
const wallet = ethers.Wallet.createRandom()

console.log(
    wallet,
    wallet._signingKey()
)