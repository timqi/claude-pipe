import { describe, expect, it } from 'vitest'

import { isSenderAllowed } from '../src/channels/base.js'

describe('isSenderAllowed', () => {
  it('rejects everyone when allow list is empty', () => {
    expect(isSenderAllowed('user-1', [])).toBe(false)
  })

  it('allows listed sender and blocks unknown sender', () => {
    expect(isSenderAllowed('user-1', ['user-1', 'user-2'])).toBe(true)
    expect(isSenderAllowed('user-9', ['user-1', 'user-2'])).toBe(false)
  })
})
