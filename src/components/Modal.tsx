import { X } from 'lucide-react'
import type { ReactNode } from 'react'

export function Modal({ open, title, description, children, onClose, wide = false, closeDisabled = false }: { open: boolean; title: string; description?: string; children: ReactNode; onClose: () => void; wide?: boolean; closeDisabled?: boolean }) {
  if (!open) return null
  return <div className="modal-backdrop"><div className={`modal ${wide ? 'modal--wide' : ''}`}><header><div><span>ZENITH CONTROL</span><h2>{title}</h2>{description && <p>{description}</p>}</div><button type="button" onClick={onClose} disabled={closeDisabled}><X /></button></header><div className="modal-body">{children}</div></div></div>
}
