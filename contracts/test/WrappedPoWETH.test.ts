import { ethers } from "hardhat";

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Wallet, BigNumber } from "ethers";
import { joinSignature, parseEther } from "ethers/lib/utils";

import { proof, stateRoot } from "./mocks/proof";
import { encodeProof } from "./utils/encode-proof";

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
