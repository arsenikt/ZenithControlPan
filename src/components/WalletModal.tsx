import { Check, Copy, KeyRound, LoaderCircle, ShieldCheck, Sparkles, WalletCards } from 'lucide-react'
import { useState } from 'react'
import type { ControlSnapshot } from '../types'
import { errorMessage, shortAddress } from '../utils'
import { Modal } from './Modal'

export function WalletModal({ open, snapshot, onClose, onChanged, notify }: { open: boolean; snapshot: ControlSnapshot | null; onClose: () => void; onChanged: () => Promise<void>; notify: (type: 'success' | 'error' | 'info', title: string, detail?: string) => void }) {
  const [mode, setMode] = useState<'create' | 'import'>('create')
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [created, setCreated] = useState<{ address: string; mnemonic: string | null } | null>(null)

  const create = async () => {
    setBusy(true)
    try {
      const result = await window.zenithControl.deployer.create()
      setCreated(result)
      await onChanged()
      notify('success', 'Deployer создан', result.address)
    } catch (error) { notify('error', 'Не удалось создать deployer', errorMessage(error)) }
    finally { setBusy(false) }
  }

  const importWallet = async () => {
    setBusy(true)
    try {
      const result = await window.zenithControl.deployer.import(secret)
      setSecret('')
      await onChanged()
      notify('success', 'Deployer импортирован', result.address)
      onClose()
    } catch (error) { notify('error', 'Импорт не выполнен', errorMessage(error)) }
    finally { setBusy(false) }
  }

  const copy = async (value: string) => {
    await window.zenithControl.system.copy(value)
    notify('success', 'Скопировано в буфер обмена')
  }

  return <Modal open={open} title={snapshot?.deployer ? 'Deployer wallet' : 'Настроить deployer'} description="Ключ используется только в Electron main process и хранится через системное шифрование." onClose={onClose} closeDisabled={busy}>
    {created ? <div className="wallet-created"><span><Check /></span><h3>Сохраните seed phrase сейчас</h3><p>После закрытия окна Control Panel больше не покажет эту фразу.</p><div className="seed-box"><code>{created.mnemonic}</code><button type="button" onClick={() => void copy(created.mnemonic ?? '')}><Copy /></button></div><div className="address-preview"><span>ADDRESS</span><strong>{created.address}</strong></div><button className="button primary full" type="button" onClick={() => { setCreated(null); onClose() }}>Я сохранил seed phrase</button></div> : snapshot?.deployer ? <div className="wallet-existing"><span><WalletCards /></span><small>ACTIVE DEPLOYER</small><h3>{shortAddress(snapshot.deployer.address, 12, 10)}</h3><div className="secure-callout"><ShieldCheck /><div><strong>Private key зашифрован</strong><p>Renderer не имеет API для чтения или экспорта ключа.</p></div></div><div className="modal-actions"><button className="button secondary" type="button" onClick={() => void copy(snapshot.deployer!.address)}><Copy /> Копировать адрес</button><button className="button primary" type="button" onClick={() => void window.zenithControl.system.openLink('faucet')}><Sparkles /> Получить ZTH</button></div></div> : <>
      <div className="modal-tabs"><button className={mode === 'create' ? 'is-active' : ''} type="button" onClick={() => setMode('create')}>Создать новый</button><button className={mode === 'import' ? 'is-active' : ''} type="button" onClick={() => setMode('import')}>Импортировать</button></div>
      {mode === 'create' ? <div className="wallet-option"><span><Sparkles /></span><h3>Новый локальный deployer</h3><p>Сгенерирует BIP-39 seed phrase. Private key сразу шифруется через Windows DPAPI / OS keychain.</p><button className="button primary full" type="button" onClick={() => void create()} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />} Создать deployer</button></div> : <form className="wallet-import" onSubmit={(event) => { event.preventDefault(); void importWallet() }}><label><span>Private key или seed phrase</span><textarea value={secret} onChange={(event) => setSecret(event.target.value)} rows={4} placeholder="0x... или 12/24 слова" autoComplete="off" spellCheck={false} /></label><div className="secure-callout"><ShieldCheck /><div><strong>Секрет не попадает в React state после импорта</strong><p>IPC передаёт его напрямую в защищённое хранилище main process.</p></div></div><button className="button primary full" type="submit" disabled={busy || !secret.trim()}>{busy ? <LoaderCircle className="spin" /> : <KeyRound />} Импортировать</button></form>}
    </>}
  </Modal>
}
