const ethers = require('ethers')
console.log(
    ethers.Wallet.createRandom()._signingKey()
)