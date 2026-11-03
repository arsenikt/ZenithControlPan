import { ChevronDown, CircleAlert, Radio, WalletCards } from 'lucide-react'
import type { ControlSnapshot, NetworkStatus, Page } from '../types'
import { shortAddress } from '../utils'

const titles: Record<Page, { eyebrow: string; title: string; description: string }> = {
  overview: { eyebrow: 'ZENITH OPERATIONS', title: 'Control center', description: 'Состояние suite, сети и deployer-кошелька' },
  deployments: { eyebrow: 'SMART CONTRACT DELIVERY', title: 'Deployments', description: 'Компиляция, деплой и frontend manifest' },
  contracts: { eyebrow: 'ABI CONSOLE', title: 'Contract management', description: 'Read/write вызовы развернутых контрактов' },
  monitor: { eyebrow: 'LIVE TELEMETRY', title: 'Network monitor', description: 'Блоки, события и журнал операций' },
  studio: { eyebrow: 'SOLIDITY WORKBENCH', title: 'Contract Studio', description: 'Создание и компиляция custom-контрактов' },
  settings: { eyebrow: 'LOCAL CONFIGURATION', title: 'Settings & security', description: 'RPC, deployer и синхронизация frontend' },
}

export function Topbar({ page, snapshot, network, onWallet }: { page: Page; snapshot: ControlSnapshot | null; network: NetworkStatus | null; onWallet: () => void }) {
  const meta = titles[page]
  return (
    <header className="topbar">
      <div><span>{meta.eyebrow}</span><h1>{meta.title}</h1><p>{meta.description}</p></div>
      <div className="topbar-actions">
        <span className={`rpc-chip ${network ? 'is-online' : ''}`}>{network ? <Radio /> : <CircleAlert />}<span><small>ZENITH RPC</small><strong>{network ? `${network.latency} ms` : 'OFFLINE'}</strong></span></span>
        <button className="deployer-chip" type="button" onClick={onWallet}><span><WalletCards /></span><div><small>DEPLOYER</small><strong>{snapshot?.deployer ? shortAddress(snapshot.deployer.address) : 'Not configured'}</strong></div><ChevronDown /></button>
      </div>
    </header>
  )
}
