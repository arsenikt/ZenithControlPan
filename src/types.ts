export type Page = 'overview' | 'deployments' | 'contracts' | 'monitor' | 'studio' | 'settings'

export interface DeploymentRecord {
  address: string
  txHash?: string
  blockNumber?: number
  deployedAt?: string
  contractName?: string
  constructorArguments?: unknown[]
}

export interface ControlSnapshot {
  settings: { rpcUrl: string; frontendManifest: string }
  deployer: { address: string; createdAt: string } | null
  deployments: Record<string, DeploymentRecord>
  customArtifacts: Record<string, { key: string; contractName: string; sourceHash: string; createdAt: string; abi: unknown[] }>
  suiteBootstrapped: boolean
}

export interface AbiInput { name: string; type: string; internalType?: string }
export interface ContractFunction {
  name: string
  signature: string
  inputs: AbiInput[]
  outputs: AbiInput[]
  mutability: string
  readOnly: boolean
}

export interface ContractDefinition {
  key: string
  title: string
  category: string
  contractName: string
  sourceName: string
  compiler: string
  bytecodeBytes: number
  constructorInputs: AbiInput[]
  defaultConstructor: unknown[]
  functions: ContractFunction[]
  events: Array<{ name: string; inputs: AbiInput[] }>
  deployment: DeploymentRecord | null
  custom: boolean
}

export interface NetworkStatus {
  name: string
  rpcUrl: string
  chainId: number
  symbol: string
  explorerUrl: string
  faucetUrl: string
  docsUrl: string
  blockNumber: number
  latency: number
  gasPriceGwei: string | null
  deployerBalance: string | null
  contractsLive: number
  contractsMissing: string[]
  checkedAt: string
}

export interface ActivityRecord {
  id: string
  at: string
  type: string
  status: string
  title: string
  detail?: string
  txHash?: string
  contractKey?: string
}

export interface BlockRecord {
  number: number
  hash: string
  timestamp: number
  transactions: number
  gasUsed: string
  gasLimit: string
  baseFeePerGas: string | null
}

export interface EventRecord {
  contractKey: string
  eventName: string
  args: Record<string, unknown>
  address: string
  blockNumber: number
  txHash: string
  index: number
}

export interface ToastRecord {
  id: number
  type: 'success' | 'error' | 'info'
  title: string
  detail?: string
}

export interface ZenithControlApi {
  system: {
    snapshot(): Promise<ControlSnapshot>
    appInfo(): Promise<{ version: string; network: NetworkStatus; encryption: string }>
    copy(text: string): Promise<boolean>
    openLink(kind: 'docs' | 'explorer' | 'faucet' | 'doepic' | 'address' | 'tx', value?: string): Promise<boolean>
  }
  network: { status(): Promise<NetworkStatus>; recentBlocks(count?: number): Promise<BlockRecord[]> }
  deployer: {
    create(): Promise<{ address: string; mnemonic: string | null }>
    import(secret: string): Promise<{ address: string }>
    clear(): Promise<void>
  }
  contracts: {
    catalog(): Promise<ContractDefinition[]>
    deploy(key: string, constructorArguments?: unknown[]): Promise<DeploymentRecord>
    deploySuite(options?: { skipExisting?: boolean }): Promise<{ deployed: Array<{ key: string; record: DeploymentRecord }>; skipped: string[] }>
    bootstrap(): Promise<{ alreadyBootstrapped: boolean; transactions: string[] }>
    removeLocal(key: string): Promise<boolean>
    read(payload: { key: string; method: string; args: unknown[] }): Promise<unknown>
    write(payload: { key: string; method: string; args: unknown[] }): Promise<{ hash: string; blockNumber: number; gasUsed: string; status: number }>
    recentEvents(blocks?: number): Promise<EventRecord[]>
    exportManifest(): Promise<{ canceled: boolean; path?: string; count?: number }>
    syncManifest(): Promise<{ path: string; count: number }>
    importManifest(): Promise<{ canceled: boolean; count?: number }>
  }
  studio: { compile(source: string, contractName?: string): Promise<ContractDefinition> }
  activity: { list(): Promise<ActivityRecord[]>; clear(): Promise<void> }
  settings: { save(settings: { rpcUrl: string; frontendManifest: string }): Promise<ControlSnapshot['settings']> }
}
