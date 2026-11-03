import { CheckCircle2, CircleAlert, Info, X } from 'lucide-react'
import type { ToastRecord } from '../types'

export function ToastStack({ items, onDismiss }: { items: ToastRecord[]; onDismiss: (id: number) => void }) {
  return <div className="toast-stack">{items.map((item) => <div className={`toast toast--${item.type}`} key={item.id}><span>{item.type === 'success' ? <CheckCircle2 /> : item.type === 'error' ? <CircleAlert /> : <Info />}</span><div><strong>{item.title}</strong>{item.detail && <p>{item.detail}</p>}</div><button type="button" onClick={() => onDismiss(item.id)}><X /></button></div>)}</div>
}
