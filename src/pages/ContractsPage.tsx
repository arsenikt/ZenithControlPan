import { Braces, CheckCircle2, ChevronRight, CircleAlert, Copy, ExternalLink, Eye, FileCode2, LoaderCircle, Play, Radio, Search, Send, ShieldCheck, Terminal, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ContractDefinition } from '../types'
import { errorMessage, formatJson, parseArguments, shortAddress } from '../utils'

type Notify = (type: 'success' | 'error' | 'info', title: string, detail?: string) => void

export function ContractsPage({ catalog, onRefresh, notify }: { catalog: ContractDefinition[]; onRefresh: () => Promise<void>; notify: Notify }) {
  const deployed = useMemo(() => catalog.filter((item) => item.deployment), [catalog])
  const [selectedKey, setSelectedKey] = useState('')
  const [search, setSearch] = useState('')
  const [method, setMethod] = useState('')
  const [args, setArgs] = useState('[]')
  const [result, setResult] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = deployed.find((item) => item.key === selectedKey) ?? deployed[0]
  const selectedMethod = selected?.functions.find((item) => item.signature === method || item.name === method)

  useEffect(() => {
    if (!selectedKey && deployed[0]) setSelectedKey(deployed[0].key)
    if (selectedKey && !deployed.some((item) => item.key === selectedKey)) setSelectedKey(deployed[0]?.key ?? '')
  }, [deployed, selectedKey])

  useEffect(() => {
    setMethod('')
    setArgs('[]')
    setResult('')
  }, [selectedKey])

  const invoke = async () => {
    if (!selected || !selectedMethod) return
    setBusy(true)
    setResult('')
    try {
      const payload = { key: selected.key, method: selectedMethod.signature, args: parseArguments(args) }
      if (selectedMethod.readOnly) {
        const value = await window.zenithControl.contracts.read(payload)
        setResult(formatJson(value))
        notify('success', 'Read call выполнен', selectedMethod.signature)
      } else {
        const receipt = await window.zenithControl.contracts.write(payload)
        setResult(formatJson(receipt))
        notify('success', 'Транзакция подтверждена', receipt.hash)
      }
      await onRefresh()
    } catch (error) {
      const message = errorMessage(error)
      setResult(`ERROR\n${message}`)
      notify('error', 'Contract call завершился ошибкой', message)
    } finally { setBusy(false) }
  }

  const removeLocal = async () => {
    if (!selected || !confirm(`Удалить локальную запись ${selected.title}? Onchain-контракт останется без изменений.`)) return
    await window.zenithControl.contracts.removeLocal(selected.key)
    notify('info', 'Локальная запись удалена', 'Onchain bytecode не изменён.')
    await onRefresh()
  }

  const filtered = deployed.filter((item) => `${item.title} ${item.contractName} ${item.key}`.toLowerCase().includes(search.toLowerCase()))
  if (!deployed.length) return <div className="page-content"><div className="empty-page card"><BlocksIcon /><h2>Нет развернутых контрактов</h2><p>Перейдите в раздел «Деплой» и разверните suite или импортируйте manifest.</p></div></div>

  return <div className="page-content contracts-page">
    <div className="contract-manager">
      <aside className="contract-list card"><header><span className="section-kicker">DEPLOYED / {deployed.length}</span><div className="search-box"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Найти контракт…" /></div></header><div>{filtered.map((contract) => <button className={selected?.key === contract.key ? 'is-active' : ''} type="button" onClick={() => setSelectedKey(contract.key)} key={contract.key}><span><FileCode2 /></span><div><strong>{contract.title}</strong><small>{shortAddress(contract.deployment!.address)}</small></div><i /><ChevronRight /></button>)}</div></aside>
      {selected && <div className="contract-detail">
        <section className="contract-identity card"><div className="contract-identity-icon"><Braces /></div><div><span className="section-kicker">{selected.category.toUpperCase()} / {selected.key}</span><h2>{selected.title}</h2><p>{selected.contractName} · {selected.sourceName}</p></div><span className="live-badge"><i /> ONCHAIN</span><div className="identity-actions"><button type="button" onClick={() => void window.zenithControl.system.copy(selected.deployment!.address)}><Copy /></button><button type="button" onClick={() => void window.zenithControl.system.openLink('address', selected.deployment!.address)}><ExternalLink /></button><button className="danger" type="button" onClick={() => void removeLocal()}><Trash2 /></button></div><div className="contract-address"><span>ADDRESS</span><code>{selected.deployment!.address}</code></div></section>
        <section className="contract-stats"><article className="card"><span><Terminal /></span><div><small>FUNCTIONS</small><strong>{selected.functions.length}</strong></div></article><article className="card"><span><Radio /></span><div><small>EVENTS</small><strong>{selected.events.length}</strong></div></article><article className="card"><span><Braces /></span><div><small>BYTECODE</small><strong>{(selected.bytecodeBytes / 1024).toFixed(1)} KB</strong></div></article><article className="card"><span><ShieldCheck /></span><div><small>DEPLOY BLOCK</small><strong>{selected.deployment?.blockNumber?.toLocaleString('en-US') ?? '—'}</strong></div></article></section>
        <section className="abi-console card"><header className="card-header"><div><span className="section-kicker">ABI INTERACTION</span><h3>Method console</h3></div><span className={`method-kind ${selectedMethod?.readOnly ? 'read' : selectedMethod ? 'write' : ''}`}>{selectedMethod ? (selectedMethod.readOnly ? 'READ / FREE' : 'WRITE / TRANSACTION') : 'SELECT METHOD'}</span></header><div className="console-grid"><div className="method-browser"><div className="method-group"><span>READ METHODS</span>{selected.functions.filter((item) => item.readOnly).map((item) => <button className={method === item.signature ? 'is-active' : ''} type="button" onClick={() => { setMethod(item.signature); setArgs('[]'); setResult('') }} key={item.signature}><Eye /><code>{item.signature}</code><ChevronRight /></button>)}</div><div className="method-group"><span>WRITE METHODS</span>{selected.functions.filter((item) => !item.readOnly).map((item) => <button className={method === item.signature ? 'is-active write' : ''} type="button" onClick={() => { setMethod(item.signature); setArgs('[]'); setResult('') }} key={item.signature}><Send /><code>{item.signature}</code><ChevronRight /></button>)}</div></div><div className="method-runner">{selectedMethod ? <><div className="method-signature"><span>{selectedMethod.readOnly ? <Eye /> : <Send />}</span><div><small>{selectedMethod.mutability.toUpperCase()}</small><strong>{selectedMethod.name}</strong><code>{selectedMethod.signature}</code></div></div><div className="input-schema">{selectedMethod.inputs.length ? selectedMethod.inputs.map((input, index) => <span key={`${input.name}-${index}`}><b>{input.name || `arg${index}`}</b><code>{input.type}</code></span>) : <span className="no-input"><CheckCircle2 /> No arguments</span>}</div><label className="code-field"><span>ARGUMENTS · JSON ARRAY</span><textarea value={args} onChange={(event) => setArgs(event.target.value)} rows={4} spellCheck={false} /></label><button className={`button full ${selectedMethod.readOnly ? 'secondary' : 'primary'}`} type="button" onClick={() => void invoke()} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : selectedMethod.readOnly ? <Play /> : <Send />}{selectedMethod.readOnly ? 'Call method' : 'Sign & execute'}</button>{result && <div className={`call-result ${result.startsWith('ERROR') ? 'error' : ''}`}><span>{result.startsWith('ERROR') ? <CircleAlert /> : <CheckCircle2 />}{result.startsWith('ERROR') ? 'REVERT / ERROR' : 'RESULT / RECEIPT'}</span><pre>{result}</pre></div>}</> : <div className="select-method-empty"><Terminal /><strong>Выберите ABI-метод</strong><p>Read calls используют public RPC. Write calls подписываются локальным deployer.</p></div>}</div></div></section>
      </div>}
    </div>
  </div>
}

function BlocksIcon() { return <Braces /> }
