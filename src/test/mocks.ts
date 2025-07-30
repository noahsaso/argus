import { WebSocket } from 'mock-socket'
import { vi } from 'vitest'

import * as aggregatorRegistry from '@/aggregators/registry'
import * as formulaUtils from '@/formulas/utils'

export const getTypedFormula = vi.spyOn(formulaUtils, 'getTypedFormula')
export const getAggregator = vi.spyOn(aggregatorRegistry, 'getAggregator')

// Creates mocks with default implementations.
export const restoreOriginalMocks = () => {
  getTypedFormula.mockReset()
  getAggregator.mockReset()
}

restoreOriginalMocks()

vi.mock('ws', () => ({
  WebSocket: WebSocket,
  default: WebSocket,
}))
