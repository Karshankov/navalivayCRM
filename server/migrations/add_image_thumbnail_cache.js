import { db } from '../db.js';

export function migrateImageThumbnailCache() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_thumbnail_cache (
      source_hash TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT,
      source_field TEXT,
      thumbnail_url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      bytes INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
}
