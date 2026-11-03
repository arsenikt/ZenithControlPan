import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, screen, session, shell } from 'electron';
import { isAddress } from 'ethers';
import { ContractService } from './contract-service.mjs';
import { DEFAULT_FRONTEND_MANIFEST, NETWORK } from './config.mjs';
import { NetworkService } from './network-service.mjs';
import { ControlStore } from './storage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
const appIcon = app.isPackaged ? path.join(process.resourcesPath, iconFile) : path.join(__dirname, '..', 'build', iconFile);
let mainWindow;
let store;
let networkService;
let contractService;

function publicError(error) {
  const message = error instanceof Error ? error.message : String(error ?? 'Неизвестная ошибка');
  return message.replace(/private key|mnemonic|seed phrase/gi, 'secret').slice(0, 8000);
}

function assertKey(value) {
  const key = String(value ?? '');
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(key)) throw new Error('Некорректный contract key');
  return key;
}

function assertMethod(value) {
  const method = String(value ?? '');
  if (!/^[a-zA-Z_$][a-zA-Z0-9_$]*(\([^)]*\))?$/.test(method)) throw new Error('Некорректный method');
  return method;
}

function assertArgs(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 100) throw new Error('Arguments должны быть JSON-массивом');
  if (JSON.stringify(value).length > 100_000) throw new Error('Arguments слишком большие');
  return value;
}

function register(channel, handler) {
  ipcMain.handle(channel, async (event, payload = {}) => {
    const senderUrl = event.senderFrame?.url ?? '';
    const expected = isDevelopment
      ? new URL(process.env.VITE_DEV_SERVER_URL)
      : new URL(pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).href);
    let sender;
    try { sender = new URL(senderUrl); }
    catch { throw new Error('Недоверенный IPC origin'); }
    const trusted = event.sender === mainWindow?.webContents && event.senderFrame === event.sender.mainFrame &&
      sender.protocol === expected.protocol && (isDevelopment ? sender.origin === expected.origin : decodeURIComponent(sender.pathname) === decodeURIComponent(expected.pathname));
    if (!trusted) throw new Error('Недоверенный IPC origin');
    try { return await handler(payload); }
    catch (error) { throw new Error(publicError(error)); }
  });
}

function registerIpc() {
  register('system:snapshot', () => store.snapshot());
  register('system:app-info', () => ({ version: app.getVersion(), network: NETWORK, encryption: process.platform === 'win32' ? 'Windows DPAPI' : 'OS secure storage' }));
  register('system:copy', ({ text }) => {
    const value = String(text ?? '');
    if (value.length > 100_000) throw new Error('Слишком много данных');
    clipboard.writeText(value);
    return true;
  });
  register('system:open-link', async ({ kind, value }) => {
    let url;
    if (kind === 'docs') url = NETWORK.docsUrl;
    else if (kind === 'explorer') url = NETWORK.explorerUrl;
    else if (kind === 'faucet') url = NETWORK.faucetUrl;
    else if (kind === 'doepic') url = 'https://doepic.cc';
    else if (kind === 'address' && isAddress(String(value ?? ''))) url = `${NETWORK.explorerUrl}/addresses/${value}`;
    else if (kind === 'tx' && /^0x[0-9a-f]{64}$/i.test(String(value ?? ''))) url = `${NETWORK.explorerUrl}/transactions/${value}`;
    else throw new Error('Ссылка не разрешена');
    await shell.openExternal(url);
    return true;
  });

  register('network:status', () => networkService.status());
  register('network:blocks', ({ count }) => networkService.recentBlocks(Math.max(1, Math.min(20, Number(count) || 8))));
  register('deployer:create', () => contractService.createDeployer());
  register('deployer:import', ({ secret }) => contractService.importDeployer(secret));
  register('deployer:clear', () => store.clearDeployer());

  register('contract:catalog', () => contractService.catalog());
  register('contract:deploy', ({ key, constructorArguments }) => contractService.deploy(assertKey(key), assertArgs(constructorArguments)));
  register('contract:deploy-suite', ({ skipExisting = true }) => contractService.deploySuite({ skipExisting: Boolean(skipExisting) }));
  register('contract:bootstrap', () => contractService.bootstrapSuite());
  register('contract:remove-local', ({ key }) => contractService.removeLocalDeployment(assertKey(key)));
  register('contract:read', ({ key, method, args }) => contractService.readContract({ key: assertKey(key), method: assertMethod(method), args: assertArgs(args) ?? [] }));
  register('contract:write', ({ key, method, args }) => contractService.writeContract({ key: assertKey(key), method: assertMethod(method), args: assertArgs(args) ?? [] }));
  register('contract:events', ({ blocks }) => contractService.recentEvents({ blocks: Math.max(1, Math.min(2000, Number(blocks) || 300)) }));
  register('contract:manifest-sync', () => contractService.exportManifest(store.settings().frontendManifest || DEFAULT_FRONTEND_MANIFEST));
  register('contract:manifest-export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Экспорт deployment manifest',
      defaultPath: store.settings().frontendManifest || DEFAULT_FRONTEND_MANIFEST,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    return { canceled: false, ...(await contractService.exportManifest(result.filePath)) };
  });
  register('contract:manifest-import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: 'Импорт deployment manifest', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    return { canceled: false, ...(await contractService.importManifest(result.filePaths[0])) };
  });

  register('studio:compile', ({ source, contractName }) => contractService.compileCustom({ source, contractName }));
  register('activity:list', () => store.activity());
  register('activity:clear', () => store.clearActivity());
  register('settings:save', ({ rpcUrl, frontendManifest }) => {
    const url = new URL(String(rpcUrl ?? ''));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('RPC URL должен использовать HTTP(S)');
    const manifest = path.resolve(String(frontendManifest ?? ''));
    if (path.extname(manifest).toLowerCase() !== '.json') throw new Error('Manifest path должен заканчиваться на .json');
    return store.saveSettings({ rpcUrl: url.toString(), frontendManifest: manifest });
  });
}

async function createWindow() {
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const window = new BrowserWindow({
    width: Math.min(1440, workArea.width),
    height: Math.min(920, workArea.height),
    minWidth: Math.min(1050, workArea.width),
    minHeight: Math.min(680, workArea.height),
    show: false,
    backgroundColor: '#090d12',
    title: 'Zenith Control Panel',
    icon: appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: isDevelopment,
    },
  });
  mainWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url !== window.webContents.getURL()) event.preventDefault(); });
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show(); });
  window.on('closed', () => { if (mainWindow === window) mainWindow = undefined; });
  if (isDevelopment) await window.loadURL(process.env.VITE_DEV_SERVER_URL);
  else await window.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
else {
  app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
  app.whenReady().then(async () => {
    try {
      app.setAppUserModelId('cc.doepic.zenith.controlpanel');
      if (process.platform === 'darwin') app.dock.setIcon(appIcon);
      Menu.setApplicationMenu(null);
      session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
      store = new ControlStore(app.getPath('userData'));
      await store.initialize();
      networkService = new NetworkService(store);
      contractService = new ContractService(store, networkService);
      registerIpc();
      await createWindow();
    } catch (error) {
      dialog.showErrorBox('Zenith Control Panel', publicError(error));
      app.quit();
    }
  });
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0 && store) void createWindow(); });
