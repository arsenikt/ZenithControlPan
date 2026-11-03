import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRACT_ARTIFACTS, CONTRACT_CATALOG } from '../electron/contract-artifacts.mjs';

test('suite catalog contains all deployable dependencies in order', () => {
  assert.equal(CONTRACT_CATALOG.length, 13);
  assert.deepEqual(CONTRACT_CATALOG.slice(0, 2).map((item) => item.key), ['registry', 'demoToken']);
  assert.ok(CONTRACT_CATALOG.findIndex((item) => item.key === 'priceOracle') < CONTRACT_CATALOG.findIndex((item) => item.key === 'flashpredict'));
  assert.ok(CONTRACT_CATALOG.findIndex((item) => item.key === 'demoToken') < CONTRACT_CATALOG.findIndex((item) => item.key === 'microretail'));
});

test('every suite artifact has deployable bytecode and ABI', () => {
  for (const definition of CONTRACT_CATALOG) {
    const artifact = CONTRACT_ARTIFACTS[definition.key];
    assert.ok(artifact, definition.key);
    assert.match(artifact.bytecode, /^0x[0-9a-f]+$/i);
    assert.ok(artifact.bytecode.length > 20);
    assert.ok(Array.isArray(artifact.abi));
  }
});
