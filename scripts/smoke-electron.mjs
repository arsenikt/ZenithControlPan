import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { ControlStore } from '../electron/storage.mjs';
import { ContractService } from '../electron/contract-service.mjs';

async function run() {
  let directory;
  let exitCode = 0;
  try {
    directory = await mkdtemp(path.join(app.getPath('temp'), 'zenith-control-smoke-'));
    const store = new ControlStore(directory);
    await store.initialize();
    const service = new ContractService(store, {});
    const wallet = await service.createDeployer();
    assert.match(wallet.address, /^0x[0-9a-f]{40}$/i);
    assert.equal(wallet.mnemonic?.split(' ').length, 12);
    assert.equal(store.snapshot().deployer.address, wallet.address);
    assert.match(store.privateKey(), /^0x[0-9a-f]{64}$/i);
    console.log('Zenith Control Panel safeStorage smoke test passed');
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    if (directory) await rm(directory, { recursive: true, force: true });
    app.exit(exitCode);
  }
}

app.whenReady().then(run, (error) => { console.error(error); app.exit(1); });
