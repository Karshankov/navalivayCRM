import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { authMiddleware } from './auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Путь к загрузкам здесь задан жёстко, переменная окружения UPLOADS_DIR на него
// не влияет. Её читают только services/image-thumbnail-service.js и
// utils/customer-photo-disk.js. Поэтому задавать UPLOADS_DIR частично нельзя:
// multer будет писать сюда, express.static раздавать отсюда же, а миниатюры и
// фото клиентов уедут в другой каталог, и на витрине появятся битые картинки.
const baseUploads = path.resolve(__dirname, '../uploads');
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);

function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    let target = String(req.query.target || '').trim();
    // sanitize target: allow a-zA-Z0-9_\/- only
    target = target.replace(/[^a-zA-Z0-9_\/-]/g, '');
    if (target.includes('..')) target = target.replace(/\.\.+/g, '');
    const dest = path.resolve(baseUploads, target || '.');
    if (!dest.startsWith(baseUploads)) return cb(new Error('Invalid target'), '');
    ensureDir(dest);
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    cb(null, name);
  }
});

function fileFilter(req, file, cb) {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(file.mimetype) || !ALLOWED_EXTENSIONS.has(ext)) {
    const error = new Error('invalid_file_type');
    error.code = 'INVALID_FILE_TYPE';
    return cb(error);
  }
  return cb(null, true);
}

const uploadMW = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_UPLOAD_BYTES,
    files: 10,
  },
});

export const uploadRouter = express.Router();

// Upload up to 10 files: field name 'files'
uploadRouter.post('/api/admin/upload', authMiddleware, (req, res) => {
  uploadMW.array('files', 10)(req, res, (error) => {
    if (error) {
      const code = error.code === 'LIMIT_FILE_SIZE'
        ? 'file_too_large'
        : error.code === 'INVALID_FILE_TYPE'
          ? 'invalid_file_type'
          : 'upload_failed';
      return res.status(400).json({ error: code });
    }
    const files = req.files || [];
    const urls = files.map(f => {
      const rel = path.relative(baseUploads, f.path).replace(/\\/g, '/');
      return '/uploads/' + rel;
    });
    return res.json({ ok: true, urls });
  });
});
