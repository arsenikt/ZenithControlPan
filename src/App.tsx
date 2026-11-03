import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Sidebar } from './components/Sidebar'
import { ToastStack } from './components/ToastStack'
import { Topbar } from './components/Topbar'
import { WalletModal } from './components/WalletModal'
import { ContractsPage } from './pages/ContractsPage'
import { DeploymentsPage } from './pages/DeploymentsPage'
import { MonitorPage } from './pages/MonitorPage'
import { OverviewPage } from './pages/OverviewPage'
import { SettingsPage } from './pages/SettingsPage'
import { StudioPage } from './pages/StudioPage'
import type { ActivityRecord, ContractDefinition, ControlSnapshot, NetworkStatus, Page, ToastRecord } from './types'

export default function App() {
  const [page, setPage] = useState<Page>('overview')
  const [snapshot, setSnapshot] = useState<ControlSnapshot | null>(null)
  const [network, setNetwork] = useState<NetworkStatus | null>(null)
  const [catalog, setCatalog] = useState<ContractDefinition[]>([])
  const [activity, setActivity] = useState<ActivityRecord[]>([])
  const [appInfo, setAppInfo] = useState<{ version: string; encryption: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [walletOpen, setWalletOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastRecord[]>([])

  const notify = useCallback((type: ToastRecord['type'], title: string, detail?: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000)
    setToasts((items) => [...items.slice(-4), { id, type, title, detail }])
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 5500)
  }, [])

  const refreshCore = useCallback(async () => {
    const [nextSnapshot, nextCatalog, nextActivity] = await Promise.all([
      window.zenithControl.system.snapshot(),
      window.zenithControl.contracts.catalog(),
      window.zenithControl.activity.list(),
    ])
    setSnapshot(nextSnapshot)
    setCatalog(nextCatalog)
    setActivity(nextActivity)
  }, [])

  const refreshNetwork = useCallback(async () => {
    try { setNetwork(await window.zenithControl.network.status()) }
    catch { setNetwork(null) }
  }, [])

  const refreshAll = useCallback(async () => { await Promise.all([refreshCore(), refreshNetwork()]) }, [refreshCore, refreshNetwork])

  useEffect(() => {
    let active = true
    void Promise.all([refreshAll(), window.zenithControl.system.appInfo()]).then(([, info]) => {
      if (active) setAppInfo({ version: info.version, encryption: info.encryption })
    }).catch((error) => notify('error', 'Не удалось загрузить Control Panel', String(error))).finally(() => { if (active) setLoading(false) })
    const timer = window.setInterval(() => void refreshNetwork(), 12_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [notify, refreshAll, refreshNetwork])

  if (loading) return <div className="app-loading"><span><b>Z</b><i /></span><LoaderCircle className="spin" /><strong>Zenith Control Panel</strong><small>Loading secure workspace…</small></div>

  return <div className="app-shell">
    <Sidebar page={page} onPage={setPage} network={network} />
    <div className="main-shell"><Topbar page={page} snapshot={snapshot} network={network} onWallet={() => setWalletOpen(true)} /><main>
      {page === 'overview' && <OverviewPage snapshot={snapshot} network={network} catalog={catalog} activity={activity} onPage={setPage} onWallet={() => setWalletOpen(true)} onRefresh={refreshAll} />}
      {page === 'deployments' && <DeploymentsPage snapshot={snapshot} network={network} catalog={catalog} onRefresh={refreshAll} onWallet={() => setWalletOpen(true)} notify={notify} />}
      {page === 'contracts' && <ContractsPage catalog={catalog} onRefresh={refreshAll} notify={notify} />}
      {page === 'monitor' && <MonitorPage network={network} activity={activity} onActivityRefresh={refreshCore} notify={notify} />}
      {page === 'studio' && <StudioPage snapshot={snapshot} onRefresh={refreshAll} notify={notify} />}
      {page === 'settings' && <SettingsPage snapshot={snapshot} network={network} appInfo={appInfo} onRefresh={refreshAll} onWallet={() => setWalletOpen(true)} notify={notify} />}
    </main></div>
    <WalletModal open={walletOpen} snapshot={snapshot} onClose={() => setWalletOpen(false)} onChanged={refreshAll} notify={notify} />
    <ToastStack items={toasts} onDismiss={(id) => setToasts((items) => items.filter((item) => item.id !== id))} />
  </div>
}
