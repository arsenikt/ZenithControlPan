import { BookOpen, Check, Copy, ExternalLink, FileDown, FileJson, FileUp, FolderSync, Globe2, HardDrive, KeyRound, LockKeyhole, Save, ShieldCheck, Trash2, WalletCards } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { ControlSnapshot, NetworkStatus } from '../types'
import { errorMessage, formatDate } from '../utils'

export function SettingsPage({ snapshot, network, appInfo, onRefresh, onWallet, notify }: { snapshot: ControlSnapshot | null; network: NetworkStatus | null; appInfo: { version: string; encryption: string } | null; onRefresh: () => Promise<void>; onWallet: () => void; notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void }) {
  const [rpcUrl, setRpcUrl] = useState(snapshot?.settings.rpcUrl ?? '')
  const [manifest, setManifest] = useState(snapshot?.settings.frontendManifest ?? '')
  const [busy, setBusy] = useState(false)

  useEffect(() => { if (snapshot) { setRpcUrl(snapshot.settings.rpcUrl); setManifest(snapshot.settings.frontendManifest) } }, [snapshot])

  const save = async () => {
    setBusy(true)
    try { await window.zenithControl.settings.save({ rpcUrl, frontendManifest: manifest }); notify('success', 'Настройки сохранены'); await onRefresh() }
    catch (error) { notify('error', 'Настройки не сохранены', errorMessage(error)) }
    finally { setBusy(false) }
  }

  const sync = async () => {
    setBusy(true)
    try { const result = await window.zenithControl.contracts.syncManifest(); notify('success', 'Manifest синхронизирован', `${result.count} contracts · ${result.path}`); await onRefresh() }
    catch (error) { notify('error', 'Синхронизация не выполнена', errorMessage(error)) }
    finally { setBusy(false) }
  }

  const importManifest = async () => {
    try { const result = await window.zenithControl.contracts.importManifest(); if (!result.canceled) { notify('success', 'Manifest импортирован', `${result.count} записей`); await onRefresh() } }
    catch (error) { notify('error', 'Импорт не выполнен', errorMessage(error)) }
  }

  const exportManifest = async () => {
    try { const result = await window.zenithControl.contracts.exportManifest(); if (!result.canceled) notify('success', 'Manifest экспортирован', result.path) }
    catch (error) { notify('error', 'Экспорт не выполнен', errorMessage(error)) }
  }

  const removeWallet = async () => {
    if (!confirm('Удалить локальный deployer key? Контракты и deployment records останутся, но для управления потребуется снова импортировать owner key.')) return
    await window.zenithControl.deployer.clear(); notify('info', 'Deployer key удалён'); await onRefresh()
  }

  const copy = async (value: string) => { await window.zenithControl.system.copy(value); notify('success', 'Скопировано') }

  return <div className="page-content settings-page">
    <section className="settings-grid">
      <div className="settings-main">
        <section className="card settings-card"><header><span className="settings-icon blue"><Globe2 /></span><div><span className="section-kicker">NETWORK CONNECTION</span><h2>Zenith EVM RPC</h2><p>Проверяется Chain ID 936485 перед каждой onchain-операцией.</p></div><span className={`verified-chip ${network ? 'is-ok' : ''}`}>{network ? <Check /> : null}{network ? 'VERIFIED' : 'OFFLINE'}</span></header><div className="settings-form"><label><span>RPC URL</span><div><input value={rpcUrl} onChange={(event) => setRpcUrl(event.target.value)} spellCheck={false} /><button type="button" onClick={() => void copy(rpcUrl)}><Copy /></button></div></label><div className="setting-values"><span><small>NETWORK</small><strong>Zenith EVM Testnet</strong></span><span><small>CHAIN ID</small><strong>936485</strong></span><span><small>LATENCY</small><strong>{network ? `${network.latency} ms` : '—'}</strong></span></div></div></section>

        <section className="card settings-card"><header><span className="settings-icon lime"><FolderSync /></span><div><span className="section-kicker">FRONTEND INTEGRATION</span><h2>Deployment manifest</h2><p>Адреса suite включают onchain-режим в ZenithDapps.</p></div></header><div className="settings-form"><label><span>ZENITHDAPPS MANIFEST PATH</span><div><input value={manifest} onChange={(event) => setManifest(event.target.value)} spellCheck={false} /><button type="button" onClick={() => void copy(manifest)}><Copy /></button></div></label><div className="manifest-actions"><button className="button primary" type="button" onClick={() => void sync()} disabled={busy}><FolderSync /> Sync now</button><button className="button secondary" type="button" onClick={() => void exportManifest()}><FileUp /> Export as…</button><button className="button secondary" type="button" onClick={() => void importManifest()}><FileDown /> Import</button></div></div></section>

        <section className="card settings-card"><header><span className="settings-icon violet"><WalletCards /></span><div><span className="section-kicker">SIGNING IDENTITY</span><h2>Deployer wallet</h2><p>Owner всех suite-контрактов и signer управляющих транзакций.</p></div></header>{snapshot?.deployer ? <div className="deployer-settings"><div className="deployer-avatar"><KeyRound /></div><div><small>ADDRESS</small><strong>{snapshot.deployer.address}</strong><p>Добавлен {formatDate(snapshot.deployer.createdAt)} · {network?.deployerBalance ? `${Number(network.deployerBalance).toFixed(5)} ZTH` : 'balance unavailable'}</p></div><button type="button" onClick={() => void copy(snapshot.deployer!.address)}><Copy /></button><button className="danger" type="button" onClick={() => void removeWallet()}><Trash2 /></button></div> : <div className="no-deployer"><KeyRound /><div><strong>Deployer не настроен</strong><p>Создайте новый или импортируйте owner wallet.</p></div><button className="button primary" type="button" onClick={onWallet}>Настроить</button></div>}</section>
        <button className="button primary save-settings" type="button" onClick={() => void save()} disabled={busy}><Save /> Сохранить configuration</button>
      </div>

      <aside className="settings-aside">
        <section className="card security-card"><span className="security-hero"><ShieldCheck /></span><span className="section-kicker">SECURITY MODEL</span><h2>Local-first signing</h2><p>Renderer не получает Node.js, filesystem или private-key API. В RPC отправляются только подписанные транзакции.</p><ul><li><Check /> contextIsolation + sandbox</li><li><Check /> IPC origin validation</li><li><Check /> {appInfo?.encryption ?? 'OS secure storage'}</li><li><Check /> Allowlisted external links</li></ul></section>
        <section className="card system-card"><header><HardDrive /><div><span className="section-kicker">APPLICATION</span><h3>System info</h3></div></header><dl><div><dt>VERSION</dt><dd>{appInfo?.version ?? '1.0.0'}</dd></div><div><dt>RUNTIME</dt><dd>Electron desktop</dd></div><div><dt>STORAGE</dt><dd>Local JSON + encryption</dd></div><div><dt>NETWORK</dt><dd>Testnet only</dd></div></dl><button type="button" onClick={() => void window.zenithControl.system.openLink('docs')}><BookOpen /> Zenith docs <ExternalLink /></button><button type="button" onClick={() => void window.zenithControl.system.openLink('doepic')}><FileJson /> doepic.cc <ExternalLink /></button></section>
        <div className="testnet-warning"><LockKeyhole /><div><strong>Testnet assets only</strong><p>ZTH и zUSDC не имеют реальной стоимости. Не импортируйте mainnet treasury key.</p></div></div>
      </aside>
    </section>
  </div>
}
