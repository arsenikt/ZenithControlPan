import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  Contract,
  ContractFactory,
  Interface,
  Wallet,
  encodeBytes32String,
  getAddress,
  id,
  isAddress,
  parseUnits,
} from 'ethers';
import solc from 'solc';
import { CONTRACT_ARTIFACTS, CONTRACT_CATALOG, SOLC_VERSION } from './contract-artifacts.mjs';
import { MAX_SOURCE_BYTES, NETWORK } from './config.mjs';

function serialize(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/^\d+$/.test(key)).map(([key, item]) => [key, serialize(item)]));
  }
  return value;
}

function publicArtifact(key, artifact, deployment) {
  const constructor = artifact.abi.find((item) => item.type === 'constructor');
  const functions = artifact.abi.filter((item) => item.type === 'function').map((item) => ({
    name: item.name,
    signature: `${item.name}(${(item.inputs ?? []).map((input) => input.type).join(',')})`,
    inputs: item.inputs ?? [],
    outputs: item.outputs ?? [],
    mutability: item.stateMutability,
    readOnly: item.stateMutability === 'view' || item.stateMutability === 'pure',
  }));
  const events = artifact.abi.filter((item) => item.type === 'event').map((item) => ({
    name: item.name,
    inputs: item.inputs ?? [],
  }));
  return {
    key,
    title: artifact.title ?? artifact.contractName,
    category: artifact.category ?? 'custom',
    contractName: artifact.contractName,
    sourceName: artifact.sourceName ?? 'Custom.sol',
    compiler: artifact.compiler ?? SOLC_VERSION,
    bytecodeBytes: Math.max(0, (artifact.bytecode.length - 2) / 2),
    constructorInputs: constructor?.inputs ?? [],
    defaultConstructor: artifact.constructor ?? [],
    functions,
    events,
    deployment: deployment ?? null,
    custom: key.startsWith('custom-'),
  };
}

export class ContractService {
  #store;
  #network;
  #busy = false;

  constructor(store, networkService) {
    this.#store = store;
    this.#network = networkService;
  }

  catalog() {
    const deployments = this.#store.deployments();
    const suite = Object.entries(CONTRACT_ARTIFACTS).map(([key, artifact]) => publicArtifact(key, artifact, deployments[key]));
    const custom = Object.entries(this.#store.customArtifacts()).map(([key, artifact]) => publicArtifact(key, artifact, deployments[key]));
    return [...suite, ...custom];
  }

  async createDeployer() {
    const wallet = Wallet.createRandom();
    await this.#store.saveDeployer(wallet.address, wallet.privateKey);
    await this.#store.addActivity({ type: 'wallet', status: 'success', title: 'Deployer wallet создан', detail: wallet.address });
    return { address: wallet.address, mnemonic: wallet.mnemonic?.phrase ?? null };
  }

  async importDeployer(secret) {
    const clean = String(secret ?? '').trim();
    if (!clean || clean.length > 500) throw new Error('Некорректный private key или seed phrase');
    const wallet = clean.split(/\s+/).length >= 12 ? Wallet.fromPhrase(clean) : new Wallet(clean);
    await this.#store.saveDeployer(wallet.address, wallet.privateKey);
    await this.#store.addActivity({ type: 'wallet', status: 'success', title: 'Deployer wallet импортирован', detail: wallet.address });
    return { address: wallet.address };
  }

  #artifact(key) {
    const artifact = CONTRACT_ARTIFACTS[key] ?? this.#store.customArtifacts()[key];
    if (!artifact) throw new Error(`Артефакт ${key} не найден`);
    return artifact;
  }

  #wallet() {
    return new Wallet(this.#store.privateKey(), this.#network.provider());
  }

  #resolveArguments(values) {
    const deployments = this.#store.deployments();
    return (values ?? []).map((value) => {
      if (typeof value === 'string' && deployments[value]?.address) return deployments[value].address;
      return value;
    });
  }

  async #exclusive(operation) {
    if (this.#busy) throw new Error('Другая onchain-операция уже выполняется');
    this.#busy = true;
    try { return await operation(); }
    finally { this.#busy = false; }
  }

  async deploy(key, constructorArguments) {
    return this.#exclusive(() => this.#deploy(key, constructorArguments));
  }

  async #deploy(key, constructorArguments) {
    await this.#network.status();
    const existing = this.#store.deployments()[key];
    if (existing && (await this.#network.provider().getCode(existing.address)) !== '0x') {
      throw new Error(`${key} уже задеплоен по адресу ${existing.address}`);
    }
    const artifact = this.#artifact(key);
    const values = constructorArguments === undefined ? artifact.constructor ?? [] : constructorArguments;
    const args = this.#resolveArguments(values);
    const wallet = this.#wallet();
    const factory = new ContractFactory(artifact.abi, artifact.bytecode, wallet);
    const contract = await factory.deploy(...args);
    const transaction = contract.deploymentTransaction();
    if (!transaction) throw new Error('Deployment transaction не создана');
    const receipt = await transaction.wait();
    if (!receipt) throw new Error('Deployment receipt не получен');
    const address = await contract.getAddress();
    const record = {
      address,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      deployedAt: new Date().toISOString(),
      contractName: artifact.contractName,
      constructorArguments: serialize(args),
    };
    await this.#store.saveDeployment(key, record);
    await this.#store.addActivity({ type: 'deploy', status: 'success', title: `${artifact.contractName} задеплоен`, detail: address, txHash: receipt.hash, contractKey: key });
    return record;
  }

  async deploySuite({ skipExisting = true } = {}) {
    return this.#exclusive(async () => {
      const deployed = [];
      const skipped = [];
      for (const definition of CONTRACT_CATALOG) {
        const existing = this.#store.deployments()[definition.key];
        if (skipExisting && existing && (await this.#network.provider().getCode(existing.address).catch(() => '0x')) !== '0x') {
          skipped.push(definition.key);
          continue;
        }
        deployed.push({ key: definition.key, record: await this.#deploy(definition.key) });
      }
      return { deployed, skipped };
    });
  }

  async removeLocalDeployment(key) {
    await this.#store.removeDeployment(String(key));
    return true;
  }

  async readContract({ key, method, args = [] }) {
    const deployment = this.#store.deployments()[key];
    if (!deployment) throw new Error(`${key} не задеплоен`);
    const artifact = this.#artifact(key);
    const fragment = new Interface(artifact.abi).getFunction(method);
    if (!fragment) throw new Error(`Метод ${method} не найден`);
    if (!['view', 'pure'].includes(fragment.stateMutability)) throw new Error('Это write-метод; используйте Execute');
    const contract = new Contract(deployment.address, artifact.abi, this.#network.provider());
    return serialize(await contract.getFunction(method)(...args));
  }

  async writeContract({ key, method, args = [] }) {
    return this.#exclusive(async () => {
      await this.#network.status();
      const deployment = this.#store.deployments()[key];
      if (!deployment) throw new Error(`${key} не задеплоен`);
      const artifact = this.#artifact(key);
      const fragment = new Interface(artifact.abi).getFunction(method);
      if (!fragment) throw new Error(`Метод ${method} не найден`);
      if (['view', 'pure'].includes(fragment.stateMutability)) throw new Error('Это read-метод');
      const contract = new Contract(deployment.address, artifact.abi, this.#wallet());
      const transaction = await contract.getFunction(method)(...args);
      const receipt = await transaction.wait();
      if (!receipt) throw new Error('Transaction receipt не получен');
      await this.#store.addActivity({ type: 'write', status: 'success', title: `${artifact.contractName}.${fragment.name}`, detail: deployment.address, txHash: receipt.hash, contractKey: key });
      return { hash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), status: Number(receipt.status) };
    });
  }

  async bootstrapSuite() {
    return this.#exclusive(async () => {
      await this.#network.status();
      if (this.#store.isBootstrapped()) return { alreadyBootstrapped: true, transactions: [] };
      const deployments = this.#store.deployments();
      const required = CONTRACT_CATALOG.map((item) => item.key);
      const missing = required.filter((key) => !deployments[key]);
      if (missing.length) throw new Error(`Сначала задеплойте suite: ${missing.join(', ')}`);
      const wallet = this.#wallet();
      const token = new Contract(deployments.demoToken.address, CONTRACT_ARTIFACTS.demoToken.abi, wallet);
      const transactions = [];
      const send = async (contract, method, args) => {
        const transaction = await contract.getFunction(method)(...args);
        const receipt = await transaction.wait();
        if (!receipt) throw new Error(`${method}: receipt не получен`);
        transactions.push(receipt.hash);
        return receipt;
      };

      const safeDeal = new Contract(deployments.safedeal.address, CONTRACT_ARTIFACTS.safedeal.abi, wallet);
      if (!(await token.minters(deployments.microretail.address))) {
        await send(token, 'setMinter', [deployments.microretail.address, true]);
      }
      const targetReserve = parseUnits('50000', 6);
      const currentReserve = await safeDeal.botReserve(deployments.demoToken.address);
      if (currentReserve < targetReserve) {
        const topUp = targetReserve - currentReserve;
        await send(token, 'mint', [wallet.address, topUp]);
        await send(token, 'approve', [deployments.safedeal.address, topUp]);
        await send(safeDeal, 'fundBotReserve', [deployments.demoToken.address, topUp]);
      }

      const fairTix = new Contract(deployments.fairtix.address, CONTRACT_ARTIFACTS.fairtix.abi, wallet);
      const eventStart = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      if ((await fairTix.eventCount()) === 0n) {
        await send(fairTix, 'createEvent', ['Zenith Night / Berlin', 'Kraftwerk Berlin', 'ipfs://zenith-night', deployments.demoToken.address, parseUnits('18', 6), eventStart, 120]);
        await send(fairTix, 'createEvent', ['Onchain Product Meetup', 'Lisbon Web3 Hub', 'ipfs://product-meetup', deployments.demoToken.address, parseUnits('8', 6), eventStart + 7 * 86400, 80]);
        await send(fairTix, 'createEvent', ['Protocol Artifacts', 'Digital Garage', 'ipfs://protocol-artifacts', deployments.demoToken.address, parseUnits('12', 6), eventStart + 14 * 86400, 150]);
      }

      const shop = new Contract(deployments.gumroad.address, CONTRACT_ARTIFACTS.gumroad.abi, wallet);
      if ((await shop.productCount()) === 0n) {
        await send(shop, 'publish', ['The Quiet Prompt Pack', 'ipfs://prompt-pack-preview', deployments.demoToken.address, parseUnits('12', 6), id('quiet-prompt-pack-v1')]);
        await send(shop, 'publish', ['Protocol Forms / 4K', 'ipfs://protocol-forms-preview', deployments.demoToken.address, parseUnits('8', 6), id('protocol-forms-v1')]);
        await send(shop, 'publish', ['Builder Circle Access', 'https://doepic.cc', deployments.demoToken.address, parseUnits('20', 6), id('builder-circle-v1')]);
      }

      const registry = new Contract(deployments.registry.address, CONTRACT_ARTIFACTS.registry.abi, wallet);
      for (const definition of CONTRACT_CATALOG.filter((item) => item.key !== 'registry')) {
        const registryKey = encodeBytes32String(definition.key);
        if ((await registry.application(registryKey)).toLowerCase() !== deployments[definition.key].address.toLowerCase()) {
          await send(registry, 'setApplication', [registryKey, deployments[definition.key].address]);
        }
      }
      await this.#store.setBootstrapped(true);
      await this.#store.addActivity({ type: 'bootstrap', status: 'success', title: 'Zenith suite инициализирован', detail: `${transactions.length} transactions` });
      return { alreadyBootstrapped: false, transactions };
    });
  }

  async compileCustom({ source, contractName }) {
    const code = String(source ?? '');
    if (!code.trim() || Buffer.byteLength(code) > MAX_SOURCE_BYTES) throw new Error('Solidity source пуст или превышает 512 КБ');
    if (/\bimport\s+["']/.test(code)) throw new Error('Custom Studio компилирует один self-contained Solidity файл без imports');
    const fileName = 'Custom.sol';
    const output = JSON.parse(solc.compile(JSON.stringify({
      language: 'Solidity',
      sources: { [fileName]: { content: code } },
      settings: {
        optimizer: { enabled: true, runs: 200 },
        evmVersion: 'cancun',
        outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } },
      },
    })));
    const errors = (output.errors ?? []).filter((item) => item.severity === 'error');
    if (errors.length) throw new Error(errors.map((item) => item.formattedMessage).join('\n').slice(0, 8000));
    const available = Object.keys(output.contracts?.[fileName] ?? {});
    const selected = contractName && available.includes(contractName) ? contractName : available.at(-1);
    if (!selected) throw new Error('В source не найден deployable contract');
    const compiled = output.contracts[fileName][selected];
    if (!compiled.evm.bytecode.object) throw new Error(`${selected} не содержит deployable bytecode`);
    const sourceHash = id(code);
    const key = `custom-${sourceHash.slice(2, 12)}`;
    const artifact = {
      key,
      title: selected,
      category: 'custom',
      contractName: selected,
      sourceName: fileName,
      compiler: solc.version(),
      sourceHash,
      source: code,
      createdAt: new Date().toISOString(),
      constructor: [],
      abi: compiled.abi,
      bytecode: `0x${compiled.evm.bytecode.object}`,
      deployedBytecode: `0x${compiled.evm.deployedBytecode.object}`,
      warnings: (output.errors ?? []).filter((item) => item.severity !== 'error').map((item) => item.formattedMessage),
    };
    await this.#store.saveCustomArtifact(key, artifact);
    await this.#store.addActivity({ type: 'compile', status: 'success', title: `${selected} скомпилирован`, detail: sourceHash });
    return publicArtifact(key, artifact, this.#store.deployments()[key]);
  }

  async exportManifest(targetPath) {
    const outputPath = path.resolve(targetPath || this.#store.settings().frontendManifest);
    if (path.extname(outputPath).toLowerCase() !== '.json') throw new Error('Deployment manifest должен быть JSON-файлом');
    const suiteKeys = new Set(CONTRACT_CATALOG.map((item) => item.key));
    const contracts = Object.fromEntries(Object.entries(this.#store.deployments()).filter(([key]) => suiteKeys.has(key)));
    const manifest = {
      schemaVersion: 1,
      chainId: NETWORK.chainId,
      network: NETWORK.name,
      updatedAt: new Date().toISOString(),
      deployer: this.#store.snapshot().deployer?.address ?? null,
      contracts,
    };
    await mkdir(path.dirname(outputPath), { recursive: true });
    const temporary = `${outputPath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(temporary, outputPath);
    await this.#store.saveSettings({ frontendManifest: outputPath });
    await this.#store.addActivity({ type: 'export', status: 'success', title: 'Deployment manifest экспортирован', detail: outputPath });
    return { path: outputPath, count: Object.keys(contracts).length, manifest };
  }

  async importManifest(filePath) {
    const manifest = JSON.parse(await readFile(filePath, 'utf8'));
    if (Number(manifest.chainId) !== NETWORK.chainId || !manifest.contracts || typeof manifest.contracts !== 'object') {
      throw new Error('Manifest несовместим с Zenith EVM Testnet');
    }
    for (const [key, value] of Object.entries(manifest.contracts)) {
      const record = typeof value === 'string' ? { address: value } : value;
      if (!isAddress(record?.address)) throw new Error(`${key}: некорректный address`);
      await this.#store.saveDeployment(key, { ...record, address: getAddress(record.address), importedAt: new Date().toISOString() });
    }
    await this.#store.addActivity({ type: 'import', status: 'success', title: 'Deployment manifest импортирован', detail: filePath });
    return { count: Object.keys(manifest.contracts).length };
  }

  async recentEvents({ blocks = 300 } = {}) {
    const provider = this.#network.provider();
    const latest = await provider.getBlockNumber();
    const deployments = this.#store.deployments();
    const decoders = new Map();
    for (const [key, record] of Object.entries(deployments)) {
      try { decoders.set(record.address.toLowerCase(), { key, iface: new Interface(this.#artifact(key).abi) }); }
      catch { /* A stale custom artifact should not break monitoring. */ }
    }
    if (!decoders.size) return [];
    const logs = await provider.getLogs({
      address: [...decoders.keys()],
      fromBlock: Math.max(0, latest - Math.min(2000, Number(blocks) || 300)),
      toBlock: latest,
    });
    return logs.slice(-250).reverse().map((log) => {
      const decoder = decoders.get(log.address.toLowerCase());
      let eventName = 'UnknownEvent';
      let args = {};
      try {
        const parsed = decoder?.iface.parseLog(log);
        if (parsed) {
          eventName = parsed.name;
          args = Object.fromEntries(parsed.fragment.inputs.map((input, index) => [input.name || String(index), serialize(parsed.args[index])]));
        }
      } catch { /* Keep raw event. */ }
      return { contractKey: decoder?.key ?? 'unknown', eventName, args, address: log.address, blockNumber: log.blockNumber, txHash: log.transactionHash, index: log.index };
    });
  }
}
