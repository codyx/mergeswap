
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
	// chainId: number
	// Number of confirmations to wait before signing a block.
	confirmations: number
}

function getConfig(env: WorkerEnvironment) {
	// NOTE: StaticJsonRpcProvider syntax is needed specifically for the Cloudflare Worker environment.
	//       See https://github.com/ethers-io/ethers.js/issues/1886#issuecomment-1063531514 for more.
	const configProduction: Record<string, ChainConfig> = {
		// Proof-of-stake.
		'eth-pos-mainnet': {
			// chainId: CHAIN_ID.ETHEREUM_PROOF_OF_STAKE_MAINNET,
			provider: new ethers.providers.StaticJsonRpcProvider({
				url: "https://mainnet.infura.io/v3/fab0acebc2c44109b2e486353c230998",
				skipFetchSetup: true
			}),
			confirmations: 1
		},

		// Proof-of-work.
		'eth-pow-mainnet': {
			// chainId: CHAIN_ID.ETHEREUM_PROOF_OF_WORK_MAINNET,
			provider: new ethers.providers.StaticJsonRpcProvider({
				url: "https://rpc.mergeswap.xyz/",
				skipFetchSetup: true
			}),
			confirmations: 10
		}
	}

	const configStaging: Record<string, ChainConfig> = {
		// Proof-of-stake - Polygon Mumbai.
		'eth-pos-mainnet': {
			// chainId: 0x13881,
			provider: new ethers.providers.StaticJsonRpcProvider({
				url: "https://polygon-mumbai.g.alchemy.com/v2/8cEmFkR9yPUssIYH5dMf9LvPCseGdRUz",
				skipFetchSetup: true
			}),
			confirmations: 1
		},

		// Proof-of-work - Goerli.
		'eth-pow-mainnet': {
			// chainId: 0x5,
			provider: new ethers.providers.StaticJsonRpcProvider({
				url: "https://eth-goerli.g.alchemy.com/v2/9kKXw55I8QNAK7AtQT14gXAQus13eZsg/",
				skipFetchSetup: true
			}),
			confirmations: 3
		}
	}

	const configs = {
		'development': configStaging,
		// 'development': configProduction,
		'staging': configStaging,
		'production': configProduction
	}

	if (!(env in configs)) {
		throw new Error(`No chain config for environment: ${env}`)
	}

	console.debug(env, configs[env])
	
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
	blockNumber: string,
	confirmations: number,
	signerAccount: string
}

async function work(
	request: Request,
	env: Env,
	ctx: ExecutionContext
) {
	const config = getConfig(env.WORKER_ENV)

	const url = new URL(request.url)

	// Get the chain we are providing a state root for.
	const chainHandle = url.searchParams.get('chainHandle')
	let blockNumberStr = url.searchParams.get('blockNumber')
	if (!blockNumberStr) {
		throw new Error("'blockNumber' parameter must be defined")
	}

	const blockNumber = parseInt(blockNumberStr)
	const params = {
		chainHandle,
		blockNumber
	}

	if (!params.chainHandle) {
		throw new Error("'chainHandle' parameter must be defined")
	}

	// Lookup the provider for the chain.
	const chainConfig = config[params.chainHandle]
	if (chainConfig == null) {
		throw new Error(`no config defined for chainHandle '${params.chainHandle}'`)
	}
	const { chainId } = await chainConfig.provider.getNetwork()

	// Fetch latest state root.
	// We need to use eth_getBlockByNumber to get the rawBlock.stateRoot.
	// See: https://github.com/ethers-io/ethers.js/issues/667
	// const rawBlock = await getLatestBlockWithNConfirmations(chainConfig.provider, chainConfig.confirmations)
	const { provider, confirmations } = chainConfig
	const latestBlock = await provider.getBlock('latest')
	// The tip of the blockchain when we consider our min confirmations.
	const confirmedTipBlockNumber = Math.max(latestBlock.number - confirmations, 0)
	console.debug('latestBlock', latestBlock.number, 'confirmedTipBlockNumber', confirmedTipBlockNumber)
	if (confirmedTipBlockNumber < blockNumber) {
		throw new Error(`Block cannot be signed, it does not have the required number of confirmations.\nblockNumber = ${blockNumber}\nrequired confirmations = ${confirmations}\nlatest block        = ${latestBlock.number}\nlatest secure block = ${confirmedTipBlockNumber}`)
	}
	const rawBlock = await provider.send(
		'eth_getBlockByNumber',
		[ethers.utils.hexValue(blockNumber), true]
	);

	// Sign it.
	const signer = new ethers.Wallet(env.PRIVATE_KEY)
	const signerAccount = signer.address
	const message = abi.encode(
		['uint256', 'uint256', 'bytes32'],
		[chainId, rawBlock.number, rawBlock.stateRoot]
	)
	const signature = await signer.signMessage(message)

	// Construct response.
	const res: OracleResponse = {
		envelope: {
			signature,
			message,
		},
		chainId: `${chainId}`,
		blockNumber: ethers.BigNumber.from(rawBlock.number).toString(),
		confirmations: chainConfig.confirmations,
		signerAccount
	}
	return res
}

async function jsonResponse(obj: any): Promise<Response> {
	const response = new Response(JSON.stringify((obj)), {
		headers: {
			'content-type': 'application/json;charset=UTF-8',
		},
	})

	response.headers.set('Access-Control-Allow-Origin', "*");
	response.headers.set('Access-Control-Allow-Methods', "GET,HEAD,POST,OPTIONS");
	return response
}

async function jsonError(err: any): Promise<Response> {
	const res = {
		error: err.stack
	}

	const response = new Response(JSON.stringify((res)), {
		headers: {
			'content-type': 'application/json;charset=UTF-8',
		},
		status: 500
	})

	response.headers.set('Access-Control-Allow-Origin', "*");
	response.headers.set('Access-Control-Allow-Methods', "GET,HEAD,POST,OPTIONS");
	return response
}

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext
	): Promise<Response> {
		try {
			const res = await work(request, env, ctx)
			return await jsonResponse(res)
		} catch (err: any) {
			console.debug(err.stack)			
			return await jsonError(err)
		}
	},
};