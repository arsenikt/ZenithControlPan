export function shortAddress(value: string, head = 7, tail = 5): string {
  if (!value || value.length <= head + tail + 2) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

export function errorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const value = error as { message?: string }
    if (value.message) return value.message.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '').slice(0, 600)
  }
  return String(error ?? 'Неизвестная ошибка').slice(0, 600)
}

export function formatDate(value?: string): string {
  if (!value) return '—'
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

export function parseArguments(value: string): unknown[] {
  const clean = value.trim()
  if (!clean) return []
  const parsed = JSON.parse(clean) as unknown
  if (!Array.isArray(parsed)) throw new Error('Аргументы должны быть JSON-массивом: [value1, value2]')
  return parsed
}

export function formatJson(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2)
}
