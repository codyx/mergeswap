
import * as ethers from 'ethers'
const abi = ethers.utils.defaultAbiCoder;

// Deployment environments.
type WorkerEnvironment = 'staging' | 'production'

// Environment variables of worker.
export interface Env {
	PRIVATE_KEY: string
	WORKER_ENV: WorkerEnvironment
}

// 
// Types.
// 

const CHAIN_ID = {
	ETHEREUM_PROOF_OF_STAKE_MAINNET: 1,
	// TODO: Change later.
	ETHEREUM_PROOF_OF_WORK_MAINNET: 1,
}

interface ChainConfig {
	provider: ethers.providers.JsonRpcProvider
	chainId: number
}

function getConfig(env: WorkerEnvironment) {
	// NOTE: StaticJsonRpcProvider syntax is needed specifically for the Cloudflare Worker environment.
	//       See https://github.com/ethers-io/ethers.js/issues/1886#issuecomment-1063531514 for more.
	const configProduction: Record<string, ChainConfig> = {
		// Proof-of-stake.
		'eth-pos-mainnet': {
			chainId: CHAIN_ID.ETHEREUM_PROOF_OF_STAKE_MAINNET,
			provider: new ethers.providers.StaticJsonRpcProvider({
				url: "https://mainnet.infura.io/v3/fab0acebc2c44109b2e486353c230998",
				skipFetchSetup: true
			})
		},

		// Proof-of-work.
		'eth-pow-mainnet': {
			chainId: CHAIN_ID.ETHEREUM_PROOF_OF_WORK_MAINNET,
			provider: new ethers.providers.StaticJsonRpcProvider({
				url: "https://rpc.mergeswap.xyz/",
				skipFetchSetup: true
			})
		}
	}

	const configStaging: Record<string, ChainConfig> = {
		// Proof-of-stake - Polygon Mumbai.
		'eth-pos-mainnet': {
			chainId: 0x13881,
			provider: new ethers.providers.StaticJsonRpcProvider({
				url: "https://polygon-mumbai.g.alchemy.com/v2/8cEmFkR9yPUssIYH5dMf9LvPCseGdRUz",
				skipFetchSetup: true
			})
		},

		// Proof-of-work - Goerli.
		'eth-pow-mainnet': {
			chainId: 0x5,
			provider: new ethers.providers.StaticJsonRpcProvider({
				url: "https://eth-goerli.g.alchemy.com/v2/9kKXw55I8QNAK7AtQT14gXAQus13eZsg/",
				skipFetchSetup: true
			})
		}
	}

	const configs = {
		staging: configStaging,
		production: configProduction
	}

	if (!(env in configs)) {
		throw new Error(`No chain config for environment: ${env}`)
	}
	
	return configs[env]
}

interface OracleRequest {
	chainHandle: string
}

interface OracleResponse {
	envelope: {
		signature: string
		message: string
	},
	chainId: string,
	signerAccount: string
}


export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		console.log(env)
		const config = getConfig(env.WORKER_ENV)

		const url = new URL(request.url)
		
		// Get the chain we are providing a state root for.
		const chainHandle = url.searchParams.get('chainHandle')

		if (!chainHandle) {
			throw new Error("'chainHandle' parameter must be defined")
		}

		// Lookup the provider for the chain.
		const chainConfig = config[chainHandle]
		if(chainConfig == null) {
			throw new Error(`no config defined for chainHandle '${chainHandle}'`)
		}
		const { chainId } = await chainConfig.provider.getNetwork()

		// Fetch latest state root.
		// We need to use eth_getBlockByNumber to get the rawBlock.stateRoot.
		// See: https://github.com/ethers-io/ethers.js/issues/667
		const block = await chainConfig.provider.getBlock('latest')
		const rawBlock = await chainConfig.provider.send(
			'eth_getBlockByNumber',
			[ethers.utils.hexValue(block.number), true]
		);

		// Sign it.
		const signer = new ethers.Wallet(env.PRIVATE_KEY)
		const signerAccount = signer.address
		const message = abi.encode(
			['uint256', 'uint256', 'bytes32'],
			[chainId, block.number, rawBlock.stateRoot]
		)
		const signature = await signer.signMessage(message)

		// Construct response.
		const res: OracleResponse = {
			envelope: {
				signature,
				message,
			},
			chainId: `${chainId}`,
			signerAccount
		}
		const json = JSON.stringify(res)

		const response = new Response(json, {
			headers: {
				'content-type': 'application/json;charset=UTF-8',
			},
		})

		response.headers.set('Access-Control-Allow-Origin', "*");

		return response
	},
};
