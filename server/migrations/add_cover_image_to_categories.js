import { db } from '../db.js'

export function migrateCategoryCoverImage() {
  try {
    const columns = db.prepare("PRAGMA table_info(categories)").all()
    const hasCoverImage = columns.some((col) => col.name === 'cover_image')

    if (!hasCoverImage) {
      console.log('[migration] Adding cover_image column to categories table...')
      db.prepare('ALTER TABLE categories ADD COLUMN cover_image TEXT').run()
      console.log('[migration] cover_image column added successfully')
    }
  } catch (error) {
    console.error('[migration] Failed to add cover_image column to categories table:', error)
    throw error
  }
}
