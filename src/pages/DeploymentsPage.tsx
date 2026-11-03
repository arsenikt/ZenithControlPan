import { Box, CheckCircle2, CircleAlert, CloudUpload, Code2, Copy, Database, ExternalLink, FileJson, LoaderCircle, PackageCheck, Play, RefreshCw, Rocket, ServerCog, Sparkles, WalletCards } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ContractDefinition, ControlSnapshot, NetworkStatus } from '../types'
import { errorMessage, shortAddress } from '../utils'
import { Modal } from '../components/Modal'

type Notify = (type: 'success' | 'error' | 'info', title: string, detail?: string) => void

const categoryNames: Record<string, string> = { infrastructure: 'Infrastructure', payments: 'Payments & social', streaming: 'Streaming finance', assets: 'Digital assets', custom: 'Custom contracts' }

export function DeploymentsPage({ snapshot, network, catalog, onRefresh, onWallet, notify }: { snapshot: ControlSnapshot | null; network: NetworkStatus | null; catalog: ContractDefinition[]; onRefresh: () => Promise<void>; onWallet: () => void; notify: Notify }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<ContractDefinition | null>(null)
  const [constructorJson, setConstructorJson] = useState('[]')
  const suite = catalog.filter((item) => !item.custom)
  const deployed = suite.filter((item) => item.deployment)
  const missing = suite.length - deployed.length
  const visible = useMemo(() => filter === 'all' ? catalog : catalog.filter((item) => item.category === filter), [catalog, filter])
  const canDeploy = Boolean(snapshot?.deployer && network && Number(network.deployerBalance ?? 0) > 0)

  const run = async (id: string, task: () => Promise<unknown>, success: string) => {
    setBusy(id)
    try { await task(); notify('success', success); await onRefresh() }
    catch (error) { notify('error', 'Операция не выполнена', errorMessage(error)) }
    finally { setBusy(null) }
  }

  const deployOne = async (contract: ContractDefinition, args?: unknown[]) => {
    await run(`deploy:${contract.key}`, () => window.zenithControl.contracts.deploy(contract.key, args), `${contract.title} задеплоен`)
    setSelected(null)
  }

  const openDeploy = (contract: ContractDefinition) => {
    if (!snapshot?.deployer) return onWallet()
    if (contract.constructorInputs.length === 0 || (!contract.custom && contract.defaultConstructor.length > 0)) {
      void deployOne(contract)
      return
    }
    setSelected(contract)
    setConstructorJson(JSON.stringify(contract.defaultConstructor ?? [], null, 2))
  }

  const deploySuite = () => run('suite', () => window.zenithControl.contracts.deploySuite({ skipExisting: true }), 'Suite deployment завершён')
  const bootstrap = () => run('bootstrap', () => window.zenithControl.contracts.bootstrap(), 'Demo-данные и registry инициализированы')
  const sync = () => run('sync', () => window.zenithControl.contracts.syncManifest(), 'Frontend manifest синхронизирован')
  const exportManifest = () => run('export', () => window.zenithControl.contracts.exportManifest(), 'Deployment manifest экспортирован')

  return <div className="page-content deployments-page">
    {!canDeploy && <div className="attention-banner"><span><CircleAlert /></span><div><strong>{!snapshot?.deployer ? 'Deployer wallet не настроен' : 'Deployer нужен testnet ZTH'}</strong><p>{!snapshot?.deployer ? 'Создайте или импортируйте локальный кошелёк перед deployment.' : 'Откройте faucet и пополните адрес для gas.'}</p></div><button className="button primary" type="button" onClick={!snapshot?.deployer ? onWallet : () => void window.zenithControl.system.openLink('faucet')}>{!snapshot?.deployer ? <WalletCards /> : <Sparkles />}{!snapshot?.deployer ? 'Настроить deployer' : 'Открыть faucet'}</button></div>}

    <section className="deployment-command card">
      <div className="deployment-command-copy"><span className="section-kicker">SUITE DEPLOYMENT / DEPENDENCY-AWARE</span><h2>{missing ? `${missing} контрактов ожидают деплоя` : 'Все suite-контракты развернуты'}</h2><p>Control Panel использует оптимизированные artifacts, подставляет адреса зависимостей и сохраняет receipt после каждого шага — процесс можно безопасно продолжить после ошибки.</p><div className="command-actions"><button className="button primary" type="button" disabled={!canDeploy || busy !== null || missing === 0} onClick={deploySuite}>{busy === 'suite' ? <LoaderCircle className="spin" /> : <Rocket />}{deployed.length ? 'Продолжить suite deploy' : 'Deploy full suite'}</button><button className="button secondary" type="button" disabled={missing > 0 || busy !== null || snapshot?.suiteBootstrapped} onClick={bootstrap}>{busy === 'bootstrap' ? <LoaderCircle className="spin" /> : <PackageCheck />} Bootstrap demo data</button></div></div>
      <div className="deployment-progress"><div className="progress-dial" style={{ '--value': `${suite.length ? deployed.length / suite.length * 360 : 0}deg` } as React.CSSProperties}><span><strong>{deployed.length}</strong><small>/ {suite.length}</small></span></div><div><span><i className={missing ? '' : 'done'} /> CONTRACTS</span><span><i className={snapshot?.suiteBootstrapped ? 'done' : ''} /> BOOTSTRAP</span><span><i className={snapshot?.settings.frontendManifest ? 'done' : ''} /> MANIFEST PATH</span></div></div>
    </section>

    <section className="manifest-strip card"><div><span><FileJson /></span><div><strong>Frontend deployment manifest</strong><p>{snapshot?.settings.frontendManifest ?? 'Path not configured'}</p></div></div><div><button className="button secondary small" type="button" onClick={exportManifest} disabled={busy !== null || !deployed.length}><CloudUpload /> Export as…</button><button className="button primary small" type="button" onClick={sync} disabled={busy !== null || !deployed.length}>{busy === 'sync' ? <LoaderCircle className="spin" /> : <RefreshCw />} Sync ZenithDapps</button></div></section>

    <section className="contracts-section"><header className="section-header"><div><span className="section-kicker">COMPILED ARTIFACTS</span><h2>Deployment catalog</h2><p>Artifacts собраны solc 0.8.30 с optimizer runs 300.</p></div><div className="filter-tabs">{['all', 'infrastructure', 'payments', 'streaming', 'assets', 'custom'].map((item) => <button className={filter === item ? 'is-active' : ''} type="button" onClick={() => setFilter(item)} key={item}>{item === 'all' ? 'Все' : categoryNames[item]}</button>)}</div></header>
      <div className="deployment-grid">{visible.map((contract, index) => <article className={`deployment-card card ${contract.deployment ? 'is-deployed' : ''}`} key={contract.key}><header><span>{contract.custom ? <Code2 /> : contract.category === 'infrastructure' ? <ServerCog /> : contract.category === 'assets' ? <Database /> : <Box />}</span><div><small>{contract.category.toUpperCase()} / {String(index + 1).padStart(2, '0')}</small><h3>{contract.title}</h3></div><i className={contract.deployment ? 'live' : ''}>{contract.deployment ? 'LIVE' : 'READY'}</i></header><dl><div><dt>CONTRACT</dt><dd>{contract.contractName}</dd></div><div><dt>BYTECODE</dt><dd>{(contract.bytecodeBytes / 1024).toFixed(1)} KB</dd></div><div><dt>METHODS</dt><dd>{contract.functions.length}</dd></div></dl>{contract.deployment ? <div className="deployment-address"><span><CheckCircle2 /></span><div><small>DEPLOYED ADDRESS</small><strong>{shortAddress(contract.deployment.address, 12, 9)}</strong></div><button type="button" onClick={() => void window.zenithControl.system.copy(contract.deployment!.address)}><Copy /></button><button type="button" onClick={() => void window.zenithControl.system.openLink('address', contract.deployment!.address)}><ExternalLink /></button></div> : <button className="deploy-card-button" type="button" onClick={() => openDeploy(contract)} disabled={!canDeploy || busy !== null}>{busy === `deploy:${contract.key}` ? <LoaderCircle className="spin" /> : <Play />} Deploy contract</button>}</article>)}</div>
    </section>

    <Modal open={Boolean(selected)} title={`Deploy ${selected?.title ?? ''}`} description="Передайте constructor arguments как JSON-массив в порядке ABI." onClose={() => setSelected(null)} closeDisabled={busy !== null}><form className="constructor-form" onSubmit={(event) => { event.preventDefault(); if (!selected) return; try { const args = JSON.parse(constructorJson) as unknown; if (!Array.isArray(args)) throw new Error('Нужен массив'); void deployOne(selected, args) } catch (error) { notify('error', 'Некорректный JSON', errorMessage(error)) } }}><div className="constructor-schema">{selected?.constructorInputs.map((input, index) => <span key={`${input.name}-${index}`}><b>{input.name || `arg${index}`}</b><code>{input.type}</code></span>)}</div><label><span>CONSTRUCTOR ARGUMENTS</span><textarea value={constructorJson} onChange={(event) => setConstructorJson(event.target.value)} rows={7} spellCheck={false} /></label><div className="modal-actions"><button className="button secondary" type="button" onClick={() => setSelected(null)}>Отмена</button><button className="button primary" type="submit" disabled={busy !== null}>{busy ? <LoaderCircle className="spin" /> : <Rocket />} Deploy</button></div></form></Modal>
  </div>
}
