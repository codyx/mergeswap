import { ethers } from "hardhat";

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Wallet, BigNumber } from "ethers";
import { hexZeroPad, joinSignature, keccak256, parseEther } from "ethers/lib/utils";

import { proof, stateRoot } from "./mocks/proof";
import { encodeProof } from "./utils/encode-proof";
import { predictContractAddress } from "../scripts/utils/predict-address";
import { JsonRpcProvider } from "@ethersproject/providers";

describe("ReceiveWPoW", function () {
  const deployReceiveWPoWFixture = async () => {
    const [user] = await ethers.getSigners();
    const relayer = new Wallet(Wallet.createRandom().privateKey, user.provider);

    const WrappedPoWETH = await ethers.getContractFactory("WrappedPoWETH");
    const wrappedPowETH = await WrappedPoWETH.deploy(
      relayer.address,
      "0x6b175474e89094c44da98b954eedeac495271d0f",
      2
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
        rpcUrl: "http://localhost:8545",
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

    let config: Record<string, ChainConfig> = config$

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
    const depositPoW = await DepositPoW.deploy(relayer.address, nextPOSContractAddress, 6);
    await depositPoW.deployed();
    console.log(`DepositPoW: ${depositPoW.address}`)


    // Deploy WrappedPOW to POS chain.
    // 

    // 1. Deploy the WrappedPOWETH contract.
    const WrappedPoWETH = await ethers.getContractFactory("WrappedPoWETH", config.pos.signer);
    const wrappedPowETH = await WrappedPoWETH.deploy(
      relayer.address,
      depositPoW.address,
      2
    );
    await wrappedPowETH.deployed()
    console.log(`WrappedPoWETH: ${wrappedPowETH.address}`)

    // Deposit on POW chain.
    // 
    
    const depositAmount = parseEther('1.0')
    await depositPoW.deposit(depositAmount, signerAddress, { value: depositAmount })
    
    // Call eth_getProof for POW chain.
    
    // Args:
    // DATA, 20 bytes - address of the account or contract
    // ARRAY, 32 Bytes - array of storage - keys which should be proofed and included.See eth_getStorageAt
    // QUANTITY | TAG - integer block number, or the string "latest" or "earliest", see the default block parameter
    
    // Compute storage key.
    let storageKey
    {
      const paddedSlot = hexZeroPad("0x3", 32);
      const paddedKey = hexZeroPad("0x0", 32);
      const itemSlot = keccak256(paddedKey + paddedSlot.slice(2));
      storageKey = itemSlot
      // const storageAt = await user.provider?.getStorageAt(
      //   depositPoW.address,
      //   itemSlot
      // );
    }

    // console.log(storageKey)
    const proof = await config.pow.provider.send("eth_getProof", [depositPoW.address, [storageKey], 'latest'])
    console.log(proof)

    // Return the data for testing.
    // 
    const user = config.pos.signer
    return {
      user, relayer, wrappedPowETH, proof
    }
  }

  it("Should initialize the contract", async () => {
    const { user, relayer, wrappedPowETH } = await loadFixture(
      deployReceiveWPoWFixture
    );
  });

  describe("Relay", () => {
    it("Should relay state root", async () => {
      const { user, relayer, wrappedPowETH } = await loadFixture(
        deployReceiveWPoWFixture
      );
      const sigRaw = await relayer._signingKey().signDigest(stateRoot);
      const sig = joinSignature(sigRaw);

      const blockNumber = 10;
      await wrappedPowETH
        .connect(user)
        .relayStateRoot(blockNumber, stateRoot, sig);

      const setStateRoot = await wrappedPowETH.stateRoots(blockNumber);
      expect(setStateRoot).equal(stateRoot);
    });
  });

  describe("Update deposit contract storage root", () => {
    it("Should update deposit contract storage root", async () => {
      const { user, relayer, wrappedPowETH } = await loadFixture(
        deployReceiveWPoWFixture
      );
      const sigRaw = await relayer._signingKey().signDigest(stateRoot);
      const sig = joinSignature(sigRaw);

      const blockNumber = 10;
      await wrappedPowETH
        .connect(user)
        .relayStateRoot(blockNumber, stateRoot, sig);

      const accountProofEncoded = encodeProof(proof.accountProof);
      await wrappedPowETH.updateDepositContractStorageRoot(
        blockNumber,
        accountProofEncoded
      );

      const setStorageRoot = await wrappedPowETH.depositContractStorageRoots(
        blockNumber
      );
      expect(setStorageRoot).equal(proof.storageHash);
    });
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

  describe.only("Mint", () => {
    it("Should mint ETHPOW", async () => {
      const { user, relayer, wrappedPowETH, proof } = await setupTestnets()
      // const { user, relayer, wrappedPowETH } = await loadFixture(
      //   deployReceiveWPoWFixture
      // );
      const sigRaw = await relayer._signingKey().signDigest(stateRoot);
      const sig = joinSignature(sigRaw);

      const blockNumber = 10;
      await wrappedPowETH
        .connect(user)
        .relayStateRoot(blockNumber, stateRoot, sig);

      const accountProofEncoded = encodeProof(proof.accountProof);
      await wrappedPowETH.updateDepositContractStorageRoot(
        blockNumber,
        accountProofEncoded
      );

      const storageProofEncoded = encodeProof(proof.storageProof[0].proof);
      await wrappedPowETH.mint(
        "0xf37Fd9185Bb5657D7E57DDEA268Fe56C2458F675",
        relayer.address,
        "0", // we don't need to provide amount, it's provided on the other chain during deposit.
        blockNumber,
        storageProofEncoded
      );

      const minterAccount = "0xf37Fd9185Bb5657D7E57DDEA268Fe56C2458F675"
      const feeRecipientAccount = await wrappedPowETH.feeRecipient()
      const mintFeeRate = await wrappedPowETH.mintFeeRate()
      const amount = BigNumber.from(proof.storageProof[0].value)
      const amountStr = proof.storageProof[0].value
      const feeAmount = amount.mul(mintFeeRate)

      const minterTokenBalance = await wrappedPowETH.balanceOf(minterAccount);
      const feeRecipientTokenBalance = await wrappedPowETH.balanceOf(feeRecipientAccount);

      expect(minterTokenBalance).equal(amount.sub(feeAmount));
      expect(feeRecipientTokenBalance).equal(feeAmount);

      const tokensMinted = await wrappedPowETH.balanceOf(relayer.address);
      expect(tokensMinted).equal(amount);
    });

    it("Should revert in case a deposit is attempted to be minted twice", async () => {
      const { user, relayer, wrappedPowETH } = await loadFixture(
        deployReceiveWPoWFixture
      );
      const sigRaw = await relayer._signingKey().signDigest(stateRoot);
      const sig = joinSignature(sigRaw);

      const blockNumber = 10;
      await wrappedPowETH
        .connect(user)
        .relayStateRoot(blockNumber, stateRoot, sig);

      const accountProofEncoded = encodeProof(proof.accountProof);
      await wrappedPowETH.updateDepositContractStorageRoot(
        blockNumber,
        accountProofEncoded
      );

      const storageProofEncoded = encodeProof(proof.storageProof[0].proof);
      await wrappedPowETH.mint(
        "0xf37Fd9185Bb5657D7E57DDEA268Fe56C2458F675",
        relayer.address,
        "0",
        blockNumber,
        storageProofEncoded
      );

      expect(
        wrappedPowETH.mint(
          "0xf37Fd9185Bb5657D7E57DDEA268Fe56C2458F675",
          relayer.address,
          "0",
          blockNumber,
          storageProofEncoded
        )
      ).throws;

      const tokensMinted = await wrappedPowETH.balanceOf(relayer.address);
      expect(tokensMinted).equal(proof.storageProof[0].value);
    });
  });
});
