
import * as ethers from 'ethers'
const abi = ethers.utils.defaultAbiCoder;

// Environment variables of worker.
export interface Env {
	PRIVATE_KEY: string
}

// 
// Types.
// 

const CHAIN_ID = {
	ETHEREUM_POS_MAINNET: 1,
	
	// TODO: Change later.
	ETHEREUM_POW_MAINNET: 1,
}

interface ChainConfig {
	provider: ethers.providers.Provider
}

function getConfig() {
	// NOTE: StaticJsonRpcProvider syntax is needed specifically for the Cloudflare Worker environment.
	//       See https://github.com/ethers-io/ethers.js/issues/1886#issuecomment-1063531514 for more.
	const config: Record<string, ChainConfig> = {
		[CHAIN_ID.ETHEREUM_POS_MAINNET]: {
			provider: new ethers.providers.StaticJsonRpcProvider({
				url: "https://mainnet.infura.io/v3/fab0acebc2c44109b2e486353c230998",
				skipFetchSetup: true
			})
		}

		// TODO: add config for POW chain.
		// [CHAIN_ID.ETHEREUM_POW_MAINNET]: {}
	}
	return config
}

interface OracleRequest {
	chainId: number
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
		const config = getConfig()

		const url = new URL(request.url)
		
		// Get the chain we are providing a state root for.
		const chainId = url.searchParams.get('chainId')

		if (!chainId) {
			throw new Error("'chainId' parameter must be defined")
		}

		// Lookup the provider for the chain.
		let chainConfig = config[chainId]
		if(chainConfig == null) {
			throw new Error(`no config defined for chainId '${chainId}'`)
		}

		// Fetch latest state root.
		const block = await chainConfig.provider.getBlock('latest')

		// Sign it.
		const signer = new ethers.Wallet(env.PRIVATE_KEY)
		const signerAccount = signer.address
		// TODO: are we extracting world state root, or is block hash enough?
		const message = abi.encode(
			['uint256', 'bytes32'],
			[chainId, block.hash]
		)
		const signature = await signer.signMessage(message)

		// Construct response.
		const res: OracleResponse = {
			envelope: {
				signature,
				message,
			},
			chainId,
			signerAccount
		}
		const json = JSON.stringify(res)

		return new Response(json, {
			headers: {
				'content-type': 'application/json;charset=UTF-8',
			},
		})
	},
};
