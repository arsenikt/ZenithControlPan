const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('zenithControl', Object.freeze({
  system: Object.freeze({
    snapshot: () => invoke('system:snapshot'),
    appInfo: () => invoke('system:app-info'),
    copy: (text) => invoke('system:copy', { text }),
    openLink: (kind, value) => invoke('system:open-link', { kind, value }),
  }),
  network: Object.freeze({
    status: () => invoke('network:status'),
    recentBlocks: (count) => invoke('network:blocks', { count }),
  }),
  deployer: Object.freeze({
    create: () => invoke('deployer:create'),
    import: (secret) => invoke('deployer:import', { secret }),
    clear: () => invoke('deployer:clear'),
  }),
  contracts: Object.freeze({
    catalog: () => invoke('contract:catalog'),
    deploy: (key, constructorArguments) => invoke('contract:deploy', { key, constructorArguments }),
    deploySuite: (options) => invoke('contract:deploy-suite', options),
    bootstrap: () => invoke('contract:bootstrap'),
    removeLocal: (key) => invoke('contract:remove-local', { key }),
    read: (payload) => invoke('contract:read', payload),
    write: (payload) => invoke('contract:write', payload),
    recentEvents: (blocks) => invoke('contract:events', { blocks }),
    exportManifest: () => invoke('contract:manifest-export'),
    syncManifest: () => invoke('contract:manifest-sync'),
    importManifest: () => invoke('contract:manifest-import'),
  }),
  studio: Object.freeze({
    compile: (source, contractName) => invoke('studio:compile', { source, contractName }),
  }),
  activity: Object.freeze({
    list: () => invoke('activity:list'),
    clear: () => invoke('activity:clear'),
  }),
  settings: Object.freeze({
    save: (settings) => invoke('settings:save', settings),
  }),
}));
