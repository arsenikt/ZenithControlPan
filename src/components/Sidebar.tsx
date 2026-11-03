import { Activity, Blocks, Code2, ExternalLink, Gauge, Rocket, Settings, ShieldCheck } from 'lucide-react'
import type { NetworkStatus, Page } from '../types'

const nav: Array<{ id: Page; label: string; icon: typeof Gauge }> = [
  { id: 'overview', label: 'Обзор', icon: Gauge },
  { id: 'deployments', label: 'Деплой', icon: Rocket },
  { id: 'contracts', label: 'Управление', icon: Blocks },
  { id: 'monitor', label: 'Мониторинг', icon: Activity },
  { id: 'studio', label: 'Contract Studio', icon: Code2 },
  { id: 'settings', label: 'Настройки', icon: Settings },
]

export function Sidebar({ page, onPage, network }: { page: Page; onPage: (page: Page) => void; network: NetworkStatus | null }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand"><span><b>Z</b><i /></span><div><strong>ZENITH</strong><small>CONTROL PANEL</small></div></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav>{nav.map((item) => { const Icon = item.icon; return <button className={page === item.id ? 'is-active' : ''} type="button" onClick={() => onPage(item.id)} key={item.id}><Icon /><span>{item.label}</span>{item.id === 'deployments' && <i />}</button> })}</nav>
      <div className="sidebar-network">
        <div><span className={network ? 'online' : ''}><i /></span><div><strong>Zenith EVM Testnet</strong><small>{network ? `Block ${network.blockNumber.toLocaleString('en-US')}` : 'RPC connecting'}</small></div></div>
        <dl><div><dt>CHAIN</dt><dd>936485</dd></div><div><dt>LATENCY</dt><dd>{network ? `${network.latency} ms` : '—'}</dd></div></dl>
        <button type="button" onClick={() => void window.zenithControl.system.openLink('explorer')}>Explorer <ExternalLink /></button>
      </div>
      <footer><ShieldCheck /><span>Local keys<br/><b>OS encrypted</b></span></footer>
    </aside>
  )
}
