import bcrypt from 'bcryptjs'
import { db } from '../db.js'

export const DEFAULT_PROFIT_PASSWORD = 'costpassword'

export function ensureProfitPasswordSetting() {
  try {
    const existing = db.prepare('SELECT value FROM settings WHERE key = ?').get('profit_password_hash')
    if (!existing) {
      const hash = bcrypt.hashSync(DEFAULT_PROFIT_PASSWORD, 10)
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)').run('profit_password_hash', hash)
      console.log('[migration] Default profit password set')
    }
  } catch (error) {
    console.error('[migration] Failed to ensure profit password setting:', error)
    throw error
  }
}
