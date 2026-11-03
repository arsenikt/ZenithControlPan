# Zenith Control Panel

Secure Electron operator console for the Zenith Apps smart-contract suite on **Zenith EVM Testnet**.

## Capabilities

- create or import one encrypted deployer wallet;
- compile all 13 suite contracts with deterministic settings;
- dependency-aware full-suite or individual deployment;
- resumable deployment records after every confirmed receipt;
- bootstrap demo token liquidity, SafeDeal bot reserve, FairTix events, DigitalShop products and suite registry;
- inspect every deployed ABI and execute typed read/write methods;
- compile and deploy self-contained custom Solidity contracts in Contract Studio;
- monitor recent blocks, decoded suite events and the local audit trail;
- export/import deployment manifests and sync `ZenithDapps` directly;
- package a Windows NSIS installer.

## Run

Requires Node.js 22+.

```bash
npm install
npm start
```

Validation and packaging:

```bash
npm test
npm run test:electron
npm run build
npm run dist:win
```

The installer is written to `release/`.

## Recommended deployment sequence

1. Configure the deployer and back up its seed phrase.
2. Get testnet ZTH from the official Zenith faucet.
3. Deploy the full suite from **Deployments**.
4. Run **Bootstrap demo data** once all contracts are live.
5. Sync the manifest to `C:\Dev\Crypto\ZenithDapps\public\deployments\zenith-testnet.json`.
6. Build and publish the parent website.

Individual contracts and custom artifacts can also be deployed independently. Constructor arguments are entered as a JSON array.

## Security model

- `contextIsolation: true`, `sandbox: true`, no Node.js in renderer;
- every IPC call validates the sender frame and payload shape;
- permissions, arbitrary navigation and new windows are denied;
- private key is encrypted with Electron `safeStorage` (Windows DPAPI / OS keychain);
- renderer has no API to reveal or export the private key;
- RPC receives signed transactions only;
- external links are allowlisted;
- custom Solidity compilation is local, size-limited and rejects imports.

Do not import a mainnet treasury key. This application and all bundled assets are intended for testnet use only.
