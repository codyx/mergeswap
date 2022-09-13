import { ethers } from "hardhat";

import { loadFixture } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Wallet, BigNumber } from "ethers";
import { defaultAbiCoder, hexZeroPad, joinSignature, keccak256, parseEther } from "ethers/lib/utils";

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
      // Encode the call that does deposits/withdrawals(index).
      // 
      const ABI = [
        "function deposits(uint256) public returns (bytes32)"
      ];
      const iface = new ethers.utils.Interface(ABI);
      const calldata = iface.encodeFunctionData("deposits", [0])
      // console.log(`calldata`, calldata)

      // Call eth_createAccessList to get the relevant storage root from the RPC node.
      // 
      const tx = {
        // from: signerAddress,
        to: depositPoW.address,
        data: calldata
      }

      const accessList = await config.pow.provider.send(
        'eth_createAccessList',
        [tx, "latest"]
      );

      console.log(`accessList`, accessList)
      console.log(`accessList.accessList[0].storageKeys`, accessList.accessList[0].storageKeys)

      storageKey = accessList.accessList[0].storageKeys[0]

      // const deposit = await depositPoW.functions.deposits('0')
      // console.log('deposit', deposit)

      // const paddedSlot = hexZeroPad("0x3", 32);
      // const paddedKey = hexZeroPad("0x0", 32);
      // const itemSlot = keccak256(paddedKey + paddedSlot.slice(2));
      // storageKey = itemSlot

      const storageAt = await config.pow.provider.getStorageAt(
        depositPoW.address,
        storageKey
      );
      const depositInfo = keccak256(
        defaultAbiCoder.encode(
          ["uint256", "address"],
          [depositAmount, signerAddress]
        )
      );
      console.log(`depositInfo`, depositInfo)
      console.log(`storageAt  `, storageAt)
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
    console.log(`stateRoot`, stateRoot)
    console.log(`proof`, proof)

    // Return the data for testing.
    // 
    const user = config.pos.signer
    return {
      user, relayer, wrappedPowETH, proof, stateRoot
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
    it.only('decodes proof', () => {
      let accountProof = [
        // '0xfefffb8093cc196784da800c8776e7eb5290583960b3cbb4b3f5569caeff4ca7f23dba12807b511c8799e32a00808434087c343511dcd07849cbb5f45a4f275baab66133be80688bb6316e187ea201816f5c7f0242ecacf68128d41326fff57c4cbf6a9d4940800ed14e0075e9a2de54a751a472d458459ed8f0396cd0e1923b31877efc89a67b803327e09465d5d22c7ba306b7d7e0c158c884ab6093c054469c4c624ff7de87538009e5979c9e269d8f089c04c0b614c256d33ddafb1ea77bff9470bffa4a4763ba80fe7c84703a63d094d41c58e8327363082bd014b357eb331915965c39e526e815804b328395ae1d4eb603815784657b60214b8f47a5401366c9e659a2fc4a0b32a98058215d25da39760b4a5287bd0365cd0dcb7b9c6dc90be0014a8333d1ae208dc880de07bb013e262d89bc7c8a0941c3754044d5ccd27d06147a2c48b66f2b27641f80e633ac29fdd55d3eaec196bef62432d18241f321231e66c1f9d625ce445f5e5b80b5a9fe21052c52d994846407df68e518a8e966591de76d092ad782630e3324958028e90c83e36c286bd2b46f0080d9488868b6f4642e935d0e2aed7db8084d3987803c3462bdac43916b6fec048675ec0ad3283f2414beb12473c1fa72b46f8d618980fca6c2b7b2b728561d25ab14abffc5f2a14c55752a2c52157dfca69e6be28275',
        // '0xfe420880713cee8e8e8355ddcd0e16e77e8f1269e3c41ae085477260ae0b21a84ddc0b5280f722c817b9d9160896a1705742797ac1b2352973086a50503036fbf7de2ebc5f802b3fd4013d1d7aeeb3864b45183528292093bb67b1db7b1edd452b23441f655f',
        '0x3f30247092931d8c66bf63db8788c6b72a7a8fcc5f0c53a0424bd8390131805e3901f84c01880de0b6b3a7640000a04b1f342f677692ad675a5f26211726e72938819571f6385d20681ae6fc98e560a0bfc84ae83377270ba8eecc7b0a942c8d7062dc9c8565bd98e42c1e475e6daa68'
      ]

      console.log(
        accountProof.map((part: string) => ethers.utils.RLP.decode(part))
      )
    })
    
    it("Should mint ETHPOW", async () => {
      const { user, relayer, wrappedPowETH, proof, stateRoot } = await setupTestnets()
      // const { user, relayer, wrappedPowETH } = await loadFixture(
      //   deployReceiveWPoWFixture
      // );

      const sigRaw = await relayer._signingKey().signDigest(stateRoot);
      const sig = joinSignature(sigRaw);

      const blockNumber = 10;
      await wrappedPowETH
        .connect(user)
        .relayStateRoot(blockNumber, stateRoot, sig);

      proof.accountProof.map((part: string) => ethers.utils.RLP.decode(part))

      // const accountProofEncoded = proof.accountProof
      const accountProofEncoded = encodeProof(proof.accountProof); // FAILS HERE
      //      Error: invalid rlp: total length is larger than the data
      // Fails on the first item in the proof?

      return

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
