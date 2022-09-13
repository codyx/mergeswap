import { ethers } from "hardhat";

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { BigNumber, Wallet } from "ethers";
import { hexZeroPad, joinSignature, keccak256, parseEther } from "ethers/lib/utils";

import { powProof, powStateRoot } from "./mocks/proof";
import { encodeProof } from "./utils/encode-proof";
import { JsonRpcProvider } from "@ethersproject/providers";
import { predictContractAddress } from "../scripts/utils/predict-address";

describe("ReceiveWPoW", function () {
  const deployReceiveWPoWFixture = async () => {
    const [user] = await ethers.getSigners();
    const relayer = new Wallet(Wallet.createRandom().privateKey, user.provider);

    const WrappedPoWETH = await ethers.getContractFactory("WrappedPoWETH");
    const wrappedPowETH = await WrappedPoWETH.deploy(
      relayer.address,
      "0xE0f8a92b85aD593d31565Dd0666A45b875Bd9b8A",
      3
    );
    return { user, relayer, wrappedPowETH };
  };


  const setupTestnets = async () => {
    // Configure local POW and POS chains.
    interface ChainConfig {
      rpcUrl: string
      provider: JsonRpcProvider
      signer: Wallet
    }

    let config$: any = {
      pos: {
        rpcUrl: "http://localhost:8547",
        provider: null,
        signer: null
      },
      pow: {
        rpcUrl: "http://localhost:8546",
        provider: null,
        signer: null
      }
    }

    config$.pos.provider = new ethers.providers.JsonRpcProvider(config$.pos.rpcUrl)
    config$.pos.signer = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", config$.pos.provider)
    config$.pow.provider = new ethers.providers.JsonRpcProvider(config$.pow.rpcUrl)
    config$.pow.signer = new ethers.Wallet("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", config$.pow.provider)

    // Prefund accounts from geth dev account.
    let config: Record<string, ChainConfig> = config$

    // 0x70997970c51812dc3a010c7d01b50e0d17dc79c8
    const relayer = new Wallet('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d')
    const signerAddress = await config.pos.signer.getAddress()

    // Deploy DepositPOW to POW chain.
    // 

    // 1. Predict Withdrawal contract address on the POS chain.
    const deployerNoncePoS = await config.pos.provider.getTransactionCount(signerAddress);
    const nextPOSContractAddress = predictContractAddress(
      signerAddress,
      deployerNoncePoS
    );

    // 2. Deploy the Deposit contract on POW.
    const DepositPoW = await ethers.getContractFactory("DepositPoW", config.pow.signer);
    const depositPoW = await DepositPoW.deploy(
      relayer.address,
      nextPOSContractAddress,
      6
    );
    await depositPoW.deployed();
    console.log(`DepositPoW: ${depositPoW.address}`)


    // Deploy WrappedPOW to POS chain.
    // 

    // 1. Deploy the WrappedPOWETH contract.
    const WrappedPoWETH = await ethers.getContractFactory("WrappedPoWETH", config.pos.signer);
    const wrappedPowETH = await WrappedPoWETH.deploy(
      relayer.address,
      depositPoW.address,
      3
    );
    await wrappedPowETH.deployed()
    console.log(`WrappedPoWETH: ${wrappedPowETH.address}`)

    // Deposit on POW chain.
    // 

    const depositAmount = parseEther('1.0')
    await depositPoW.deposit(depositAmount, signerAddress, { value: depositAmount, gasLimit: 11000000 })

    // Call eth_getProof for POW chain.
    // 

    // Compute storage key.
    let storageKey
    {
      const paddedSlot = hexZeroPad("0x3", 32);
      const paddedKey = hexZeroPad("0x0", 32);
      const itemSlot = keccak256(paddedKey + paddedSlot.slice(2));
      storageKey = itemSlot

      // Encode the call that does deposits/withdrawals(index).
      // 
      // const ABI = [
      //   "function deposits(uint256) public returns (bytes32)"
      // ];
      // const iface = new ethers.utils.Interface(ABI);
      // const calldata = iface.encodeFunctionData("deposits", [0])
      // // console.log(`calldata`, calldata)

      // // Call eth_createAccessList to get the relevant storage root from the RPC node.
      // // 
      // const tx = {
      //   // from: signerAddress,
      //   to: depositPoW.address,
      //   data: calldata
      // }

      // const accessList = await config.pow.provider.send(
      //   'eth_createAccessList',
      //   [tx, "latest"]
      // );

      // // console.log(`accessList`, accessList)
      // // console.log(`accessList.accessList[0].storageKeys`, accessList.accessList[0].storageKeys)

      // storageKey = accessList.accessList[0].storageKeys[0]

      // // const deposit = await depositPoW.functions.deposits('0')
      // // console.log('deposit', deposit)

      // // const paddedSlot = hexZeroPad("0x3", 32);
      // // const paddedKey = hexZeroPad("0x0", 32);
      // // const itemSlot = keccak256(paddedKey + paddedSlot.slice(2));
      // // storageKey = itemSlot

      // const storageAt = await config.pow.provider.getStorageAt(
      //   depositPoW.address,
      //   storageKey
      // );
      // const depositInfo = keccak256(
      //   defaultAbiCoder.encode(
      //     ["uint256", "address"],
      //     [depositAmount, signerAddress]
      //   )
      // );

      // console.log(`depositInfo`, depositInfo)
      // console.log(`storageAt  `, storageAt)
    }


    // console.log(storageKey)
    const proof = await config.pow.provider.send(
      "eth_getProof",
      [depositPoW.address, [storageKey], 'latest']
    )
    const block = await config.pow.provider.getBlock('latest')
    const rawBlock = await config.pow.provider.send(
      'eth_getBlockByNumber',
      [ethers.utils.hexValue(block.number), true]
    );
    const stateRoot = rawBlock.stateRoot
    // console.log(`stateRoot`, stateRoot)
    // console.log(`proof`, proof)

    // Return the data for testing.
    // 
    const user = config.pos.signer
    console.log('Done setup')
    return {
      user, relayer, wrappedPowETH, proof, stateRoot
    }
  }

  it("Should initialize the contract", async () => {
    const { user, relayer, wrappedPowETH } = await loadFixture(
      deployReceiveWPoWFixture
    );
  });


  describe('mintFeeRate', () => {
    it('should be set to 1% initially', async () => {
      const { wrappedPowETH } = await loadFixture(
        deployReceiveWPoWFixture
      );

      const feeRate = await wrappedPowETH.mintFeeRate()
      expect(feeRate).to.equal(parseEther('0.01'))
    })
  })

  describe('feeRecipient', () => {
    it('should be set initially', async () => {
      const { wrappedPowETH } = await loadFixture(
        deployReceiveWPoWFixture
      );

      const feeRecipient = await wrappedPowETH.feeRecipient()
      expect(feeRecipient).to.equal('0x4200000000000000000000000000000000000000')
    })
  })

  describe("Relay", () => {
    it("Should relay state root", async () => {
      const { user, relayer, wrappedPowETH } = await loadFixture(
        deployReceiveWPoWFixture
      );
      const sigRaw = await relayer._signingKey().signDigest(powStateRoot);
      const sig = joinSignature(sigRaw);

      const blockNumber = 10;
      await wrappedPowETH
        .connect(user)
        .relayStateRoot(blockNumber, powStateRoot, sig);

      const setStateRoot = await wrappedPowETH.stateRoots(blockNumber);
      expect(setStateRoot).equal(powStateRoot);
    });
  });

  describe("Update deposit contract storage root", () => {
    it("Should update deposit contract storage root", async () => {
      const { user, relayer, wrappedPowETH } = await loadFixture(
        deployReceiveWPoWFixture
      );
      const sigRaw = await relayer._signingKey().signDigest(powStateRoot);
      const sig = joinSignature(sigRaw);

      const blockNumber = 10;
      await wrappedPowETH
        .connect(user)
        .relayStateRoot(blockNumber, powStateRoot, sig);

      const accountProofEncoded = encodeProof(powProof.accountProof);
      await wrappedPowETH.updateDepositContractStorageRoot(
        blockNumber,
        accountProofEncoded
      );

      const setStorageRoot = await wrappedPowETH.depositContractStorageRoots(
        blockNumber
      );
      expect(setStorageRoot).equal(powProof.storageHash);
    });
  });

  describe("Mint", () => {
    it.only("Should mint ETHPOW", async () => {
      // const { user, relayer, wrappedPowETH } = await loadFixture(
      //   deployReceiveWPoWFixture
      // );
      const { user, relayer, wrappedPowETH, proof: powProof, stateRoot: powStateRoot } = await setupTestnets()

      const sigRaw = await relayer._signingKey().signDigest(powStateRoot);
      const sig = joinSignature(sigRaw);

      // TODO: fix blockNumber.
      const blockNumber = 10;
      await wrappedPowETH
        .relayStateRoot(blockNumber, powStateRoot, sig, { gasLimit: 1100000 });

      const accountProofEncoded = encodeProof(powProof.accountProof);
      await wrappedPowETH.updateDepositContractStorageRoot(
        blockNumber,
        accountProofEncoded, 
        { gasLimit: 11000000 }
      );

      const storageProofEncoded = encodeProof(powProof.storageProof[0].proof);
      await wrappedPowETH.mint(
        "0",
        user.address,
        parseEther("1"),
        blockNumber,
        storageProofEncoded, 
        { gasLimit: 11000000 }
      );

      const tokensMinted = await wrappedPowETH.balanceOf(
        user.address
      );

      const minterAccount = user.address
      const feeRecipientAccount = await wrappedPowETH.feeRecipient()
      const mintFeeRate = await wrappedPowETH.mintFeeRate()
      const amount = parseEther("1")
      const UNIT = BigNumber.from(10).pow(BigNumber.from(18)) // 1e18
      const feeAmount = amount.mul(mintFeeRate).div(UNIT)

      const minterTokenBalance = await wrappedPowETH.balanceOf(minterAccount);
      const feeRecipientTokenBalance = await wrappedPowETH.balanceOf(feeRecipientAccount);

      expect(minterTokenBalance).equal(amount.sub(feeAmount));
      expect(feeRecipientTokenBalance).equal(feeAmount);
    });

    it("Should revert in case a deposit is attempted to be minted twice", async () => {
      const { user, relayer, wrappedPowETH } = await loadFixture(
        deployReceiveWPoWFixture
      );
      const sigRaw = await relayer._signingKey().signDigest(powStateRoot);
      const sig = joinSignature(sigRaw);

      const blockNumber = 10;
      await wrappedPowETH
        .connect(user)
        .relayStateRoot(blockNumber, powStateRoot, sig);

      const accountProofEncoded = encodeProof(powProof.accountProof);
      await wrappedPowETH.updateDepositContractStorageRoot(
        blockNumber,
        accountProofEncoded
      );

      const storageProofEncoded = encodeProof(powProof.storageProof[0].proof);
      await wrappedPowETH.mint(
        "0",
        "0xF6db677FB4c73A98CB991BCa6C01bD4EC98e9398",
        parseEther("1"),
        blockNumber,
        storageProofEncoded
      );

      expect(
        wrappedPowETH.mint(
          "0",
          "0xF6db677FB4c73A98CB991BCa6C01bD4EC98e9398",
          parseEther("1"),
          blockNumber,
          storageProofEncoded
        )
      ).throws;

      const tokensMinted = await wrappedPowETH.balanceOf(
        "0xF6db677FB4c73A98CB991BCa6C01bD4EC98e9398"
      );
      expect(tokensMinted).equal(parseEther("1"));
    });
  });
});
