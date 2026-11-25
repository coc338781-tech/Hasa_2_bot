import test from 'node:test'
import assert from 'node:assert/strict'
import { LIDMappingStore } from '../node_modules/@whiskeysockets/baileys/lib/Signal/lid-mapping.js'

const makeStore = () => {
  const db = {}
  let writes = 0
  const keys = {
    async get(_type, ids) {
      return Object.fromEntries(ids.filter(id => id in db).map(id => [id, db[id]]))
    },
    async set(data) {
      writes++
      Object.assign(db, data['lid-mapping'] ?? {})
    },
    async transaction(work) {
      return work()
    }
  }
  const logger = { trace() {}, debug() {}, warn() {} }
  return { store: new LIDMappingStore(keys, logger), db, get writes() { return writes } }
}

test('new PN/LID mapping is stored and reported once', async () => {
  const context = makeStore()
  const { store, db } = context
  const pair = { lid: '111@lid', pn: '222@s.whatsapp.net' }

  const first = await store.storeLIDPNMappings([pair])
  const second = await store.storeLIDPNMappings([pair])

  assert.deepEqual(first, [{ pnUser: '222', lidUser: '111' }])
  assert.deepEqual(second, [])
  assert.deepEqual(db, { '222': '111', '111_reverse': '222' })
  assert.equal(context.writes, 1)
})

test('concurrent mapping writes report a new mapping to only one caller', async () => {
  const { store, db } = makeStore()
  const pair = { lid: '333@lid', pn: '444@s.whatsapp.net' }

  const [first, second] = await Promise.all([
    store.storeLIDPNMappings([pair]),
    store.storeLIDPNMappings([pair])
  ])

  assert.deepEqual([...first, ...second], [{ pnUser: '444', lidUser: '333' }])
  assert.deepEqual(db, { '444': '333', '333_reverse': '444' })
})
