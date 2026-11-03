import { Activity, Box, CheckCircle2, CircleAlert, Clock3, ExternalLink, FileClock, Gauge, LoaderCircle, Radio, RefreshCw, Waves } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import type { ActivityRecord, BlockRecord, EventRecord, NetworkStatus } from '../types'
import { errorMessage, formatDate, formatJson, shortAddress } from '../utils'

type Tab = 'events' | 'blocks' | 'activity'

export function MonitorPage({ network, activity, onActivityRefresh, notify }: { network: NetworkStatus | null; activity: ActivityRecord[]; onActivityRefresh: () => Promise<void>; notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void }) {
  const [tab, setTab] = useState<Tab>('events')
  const [events, setEvents] = useState<EventRecord[]>([])
  const [blocks, setBlocks] = useState<BlockRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(true)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const [nextEvents, nextBlocks] = await Promise.all([
        window.zenithControl.contracts.recentEvents(500),
        window.zenithControl.network.recentBlocks(10),
      ])
      setEvents(nextEvents)
      setBlocks(nextBlocks)
      await onActivityRefresh()
    } catch (error) {
      if (!quiet) notify('error', 'Мониторинг не обновлён', errorMessage(error))
    } finally { if (!quiet) setLoading(false) }
  }, [notify, onActivityRefresh])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!auto) return
    const timer = window.setInterval(() => void load(true), 12_000)
    return () => window.clearInterval(timer)
  }, [auto, load])

  const gasUsage = blocks[0] ? Number(BigInt(blocks[0].gasUsed) * 10000n / BigInt(blocks[0].gasLimit)) / 100 : 0
  return <div className="page-content monitor-page">
    <section className="monitor-status-grid"><article className="card"><span className="green"><Radio /></span><div><small>RPC STATUS</small><strong>{network ? 'ONLINE' : 'OFFLINE'}</strong><p>{network?.rpcUrl ?? 'No response'}</p></div></article><article className="card"><span className="lime"><Box /></span><div><small>LATEST BLOCK</small><strong>{network?.blockNumber.toLocaleString('en-US') ?? '—'}</strong><p>Zenith EVM Testnet</p></div></article><article className="card"><span className="blue"><Gauge /></span><div><small>BLOCK GAS</small><strong>{gasUsage.toFixed(2)}%</strong><p>Latest utilization</p></div></article><article className="card"><span className="violet"><Waves /></span><div><small>EVENTS WINDOW</small><strong>{events.length}</strong><p>Last 500 blocks</p></div></article></section>
    <section className="telemetry-chart card"><header className="card-header"><div><span className="section-kicker">LIVE BLOCK TELEMETRY</span><h3>Transaction pulse</h3></div><div className="telemetry-controls"><label><span>AUTO REFRESH</span><input type="checkbox" checked={auto} onChange={(event) => setAuto(event.target.checked)} /></label><button className="icon-button" type="button" onClick={() => void load()} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <RefreshCw />}</button></div></header><div className="block-bars">{[...blocks].reverse().map((block) => { const max = Math.max(...blocks.map((item) => item.transactions), 1); return <div key={block.number}><span><i style={{ height: `${Math.max(8, block.transactions / max * 100)}%` }} /></span><b>{block.transactions}</b><small>{String(block.number).slice(-4)}</small></div> })}</div><footer><span><i /> TRANSACTIONS / BLOCK</span><span>UPDATES EVERY 12S</span></footer></section>
    <section className="monitor-log card"><header><div className="log-tabs"><button className={tab === 'events' ? 'is-active' : ''} type="button" onClick={() => setTab('events')}><Activity /> Contract events <i>{events.length}</i></button><button className={tab === 'blocks' ? 'is-active' : ''} type="button" onClick={() => setTab('blocks')}><Box /> Recent blocks</button><button className={tab === 'activity' ? 'is-active' : ''} type="button" onClick={() => setTab('activity')}><FileClock /> Local activity <i>{activity.length}</i></button></div></header>
      {tab === 'events' && <div className="data-table event-table"><div className="data-row data-head"><span>EVENT</span><span>CONTRACT</span><span>BLOCK</span><span>ARGUMENTS</span><span>TX</span></div>{events.length ? events.map((event) => <div className="data-row" key={`${event.txHash}-${event.index}`}><span><i className="event-dot" /> <b>{event.eventName}</b></span><span><code>{event.contractKey}</code><small>{shortAddress(event.address)}</small></span><span>#{event.blockNumber.toLocaleString('en-US')}</span><span title={formatJson(event.args)}><code>{shortAddress(formatJson(event.args).replace(/\s+/g, ' '), 28, 12)}</code></span><span><button type="button" onClick={() => void window.zenithControl.system.openLink('tx', event.txHash)}><ExternalLink /></button></span></div>) : <div className="table-empty"><Activity /><strong>События ещё не найдены</strong><p>После deployment и первых действий dApp события появятся здесь.</p></div>}</div>}
      {tab === 'blocks' && <div className="data-table block-table"><div className="data-row data-head"><span>BLOCK</span><span>AGE</span><span>TRANSACTIONS</span><span>GAS USED</span><span>HASH</span></div>{blocks.map((block) => <div className="data-row" key={block.number}><span><b>#{block.number.toLocaleString('en-US')}</b></span><span><Clock3 /> {new Date(block.timestamp * 1000).toLocaleTimeString('ru-RU')}</span><span>{block.transactions}</span><span>{(Number(BigInt(block.gasUsed) * 10000n / BigInt(block.gasLimit)) / 100).toFixed(2)}%</span><span><code>{shortAddress(block.hash, 12, 8)}</code></span></div>)}</div>}
      {tab === 'activity' && <div className="data-table activity-table"><div className="data-row data-head"><span>STATUS</span><span>OPERATION</span><span>TYPE</span><span>TIME</span><span>TX</span></div>{activity.length ? activity.map((item) => <div className="data-row" key={item.id}><span className={item.status === 'success' ? 'success' : 'warning'}>{item.status === 'success' ? <CheckCircle2 /> : <CircleAlert />}</span><span><b>{item.title}</b><small>{item.detail ? shortAddress(item.detail, 18, 12) : '—'}</small></span><span><code>{item.type}</code></span><span>{formatDate(item.at)}</span><span>{item.txHash && <button type="button" onClick={() => void window.zenithControl.system.openLink('tx', item.txHash)}><ExternalLink /></button>}</span></div>) : <div className="table-empty"><FileClock /><strong>Локальный журнал пуст</strong></div>}</div>}
    </section>
  </div>
}
