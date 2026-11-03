import assert from 'node:assert/strict';
import test from 'node:test';
import { ContractService } from '../electron/contract-service.mjs';

function fakeStore() {
  const custom = {};
  return {
    deployments: () => ({}),
    customArtifacts: () => structuredClone(custom),
    async saveCustomArtifact(key, artifact) { custom[key] = structuredClone(artifact); },
    async addActivity() {},
  };
}

test('custom studio compiles a self-contained contract', async () => {
  const service = new ContractService(fakeStore(), {});
  const artifact = await service.compileCustom({
    source: 'pragma solidity ^0.8.24; contract Ping { function ping() external pure returns (uint256) { return 1; } }',
    contractName: 'Ping',
  });
  assert.equal(artifact.contractName, 'Ping');
  assert.ok(artifact.bytecodeBytes > 0);
  assert.equal(artifact.functions[0].name, 'ping');
});

test('custom studio rejects imports', async () => {
  const service = new ContractService(fakeStore(), {});
  await assert.rejects(
    service.compileCustom({ source: 'pragma solidity ^0.8.24; import "./Unsafe.sol";', contractName: 'Unsafe' }),
    /без imports/i,
  );
});
