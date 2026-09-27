import type { SuperPiBridge } from './index'

declare global {
  interface Window {
    superPi: SuperPiBridge
  }
}

export {}
