// services/media.js — حفظ الوسائط محلياً في مجلد uploads/
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const EXT = {
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/aac': 'aac', 'audio/amr': 'amr',
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf',
};

function save(buffer, mimeType) {
  const ext = EXT[mimeType] || 'bin';
  const name = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buffer);
  return name;
}

function read(name) {
  const safe = path.basename(name);
  return fs.readFileSync(path.join(UPLOAD_DIR, safe));
}

function filePath(name) {
  return path.join(UPLOAD_DIR, path.basename(name));
}

module.exports = { save, read, filePath, UPLOAD_DIR };
