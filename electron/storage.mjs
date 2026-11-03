import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { safeStorage } from 'electron';
import { DEFAULT_FRONTEND_MANIFEST, NETWORK } from './config.mjs';

const EMPTY = Object.freeze({
  schemaVersion: 1,
  settings: { rpcUrl: NETWORK.rpcUrl, frontendManifest: DEFAULT_FRONTEND_MANIFEST },
  deployer: null,
  encryptedPrivateKey: null,
  deployments: {},
  customArtifacts: {},
  activity: [],
  suiteBootstrapped: false,
});

function cloneEmpty() {
  return structuredClone(EMPTY);
}

export class ControlStore {
  #directory;
  #file;
  #data = cloneEmpty();
  #writeQueue = Promise.resolve();

  constructor(directory) {
    this.#directory = directory;
    this.#file = path.join(directory, 'control-panel.json');
  }

  async initialize() {
    await mkdir(this.#directory, { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.#file, 'utf8'));
      this.#data = {
        ...cloneEmpty(),
        ...parsed,
        settings: { ...cloneEmpty().settings, ...(parsed.settings ?? {}) },
        deployments: parsed.deployments ?? {},
        customArtifacts: parsed.customArtifacts ?? {},
        activity: Array.isArray(parsed.activity) ? parsed.activity.slice(0, 1000) : [],
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await this.#save();
    }
  }

  snapshot() {
    return {
      settings: structuredClone(this.#data.settings),
      deployer: this.#data.deployer ? structuredClone(this.#data.deployer) : null,
      deployments: structuredClone(this.#data.deployments),
      customArtifacts: Object.fromEntries(Object.entries(this.#data.customArtifacts).map(([key, value]) => [key, {
        key,
        contractName: value.contractName,
        sourceHash: value.sourceHash,
        createdAt: value.createdAt,
        abi: value.abi,
      }])),
      suiteBootstrapped: Boolean(this.#data.suiteBootstrapped),
    };
  }

  settings() { return structuredClone(this.#data.settings); }
  deployments() { return structuredClone(this.#data.deployments); }
  customArtifacts() { return structuredClone(this.#data.customArtifacts); }
  activity() { return structuredClone(this.#data.activity); }
  isBootstrapped() { return Boolean(this.#data.suiteBootstrapped); }

  async saveSettings(settings) {
    this.#data.settings = { ...this.#data.settings, ...settings };
    await this.#save();
    return this.settings();
  }

  async saveDeployer(address, privateKey) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Системное шифрование Electron недоступно');
    this.#data.encryptedPrivateKey = safeStorage.encryptString(privateKey).toString('base64');
    this.#data.deployer = { address, createdAt: new Date().toISOString() };
    await this.#save();
    return structuredClone(this.#data.deployer);
  }

  privateKey() {
    if (!this.#data.encryptedPrivateKey) throw new Error('Сначала создайте или импортируйте deployer wallet');
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Системное шифрование Electron недоступно');
    return safeStorage.decryptString(Buffer.from(this.#data.encryptedPrivateKey, 'base64'));
  }

  async clearDeployer() {
    this.#data.deployer = null;
    this.#data.encryptedPrivateKey = null;
    await this.#save();
  }

  async saveDeployment(key, record) {
    this.#data.deployments[key] = structuredClone(record);
    await this.#save();
    return structuredClone(record);
  }

  async removeDeployment(key) {
    delete this.#data.deployments[key];
    this.#data.suiteBootstrapped = false;
    await this.#save();
  }

  async saveCustomArtifact(key, artifact) {
    this.#data.customArtifacts[key] = structuredClone(artifact);
    await this.#save();
  }

  async setBootstrapped(value) {
    this.#data.suiteBootstrapped = Boolean(value);
    await this.#save();
  }

  async addActivity(entry) {
    this.#data.activity.unshift({ id: randomUUID(), at: new Date().toISOString(), ...entry });
    this.#data.activity = this.#data.activity.slice(0, 1000);
    await this.#save();
  }

  async clearActivity() {
    this.#data.activity = [];
    await this.#save();
  }

  async #save() {
    const text = `${JSON.stringify(this.#data, null, 2)}\n`;
    this.#writeQueue = this.#writeQueue.then(async () => {
      const temporary = `${this.#file}.tmp`;
      await writeFile(temporary, text, { encoding: 'utf8', mode: 0o600 });
      await rename(temporary, this.#file);
    });
    return this.#writeQueue;
  }
}
