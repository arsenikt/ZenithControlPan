import { FetchRequest, JsonRpcProvider, formatEther, formatUnits } from 'ethers';
import { NETWORK } from './config.mjs';

export function createProvider(rpcUrl) {
  const request = new FetchRequest(rpcUrl);
  request.timeout = 15_000;
  return new JsonRpcProvider(request, { name: 'zenith-testnet', chainId: NETWORK.chainId }, {
    staticNetwork: true,
    batchMaxCount: 1,
  });
}

export class NetworkService {
  #store;
  constructor(store) { this.#store = store; }

  provider() { return createProvider(this.#store.settings().rpcUrl); }

  async status() {
    const provider = this.provider();
    const started = performance.now();
    const [network, rpcChainId, blockNumber, feeData] = await Promise.all([
      provider.getNetwork(),
      provider.send('eth_chainId', []),
      provider.getBlockNumber(),
      provider.getFeeData().catch(() => null),
    ]);
    const actualChainId = Number.parseInt(String(rpcChainId), 16);
    if (Number(network.chainId) !== NETWORK.chainId || actualChainId !== NETWORK.chainId) {
      throw new Error(`RPC вернул Chain ID ${actualChainId}, ожидался ${NETWORK.chainId}`);
    }
    const deployer = this.#store.snapshot().deployer;
    const [balance, codeChecks] = await Promise.all([
      deployer ? provider.getBalance(deployer.address).catch(() => null) : null,
      Promise.all(Object.entries(this.#store.deployments()).map(async ([key, record]) => ({
        key,
        live: (await provider.getCode(record.address).catch(() => '0x')) !== '0x',
      }))),
    ]);
    return {
      ...NETWORK,
      rpcUrl: this.#store.settings().rpcUrl,
      blockNumber,
      latency: Math.round(performance.now() - started),
      gasPriceGwei: feeData?.gasPrice ? Number(formatUnits(feeData.gasPrice, 'gwei')).toFixed(4) : null,
      deployerBalance: balance === null ? null : formatEther(balance),
      contractsLive: codeChecks.filter((item) => item.live).length,
      contractsMissing: codeChecks.filter((item) => !item.live).map((item) => item.key),
      checkedAt: new Date().toISOString(),
    };
  }

  async recentBlocks(count = 8) {
    const provider = this.provider();
    const latest = await provider.getBlockNumber();
    const size = Math.max(1, Math.min(20, Number(count) || 8));
    const blocks = await Promise.all(Array.from({ length: size }, (_, index) => provider.getBlock(latest - index)));
    return blocks.filter(Boolean).map((block) => ({
      number: block.number,
      hash: block.hash,
      timestamp: block.timestamp,
      transactions: block.transactions.length,
      gasUsed: block.gasUsed.toString(),
      gasLimit: block.gasLimit.toString(),
      baseFeePerGas: block.baseFeePerGas?.toString() ?? null,
    }));
  }
}
