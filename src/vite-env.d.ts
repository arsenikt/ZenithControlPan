/// <reference types="vite/client" />
import type { ZenithControlApi } from './types'

declare global {
  interface Window { zenithControl: ZenithControlApi }
}

export {}
