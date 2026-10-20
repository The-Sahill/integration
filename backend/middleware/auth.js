// middleware/auth.js — حماية لوحة التحكم بـ JWT
const jwt = require('jsonwebtoken');
const config = require('../config');

function sign(user) {
  return jwt.sign({ id: String(user._id), username: user.username, name: user.name, role: user.role }, config.auth.jwtSecret, { expiresIn: '7d' });
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ message: 'يرجى تسجيل الدخول' });
  try {
    req.user = jwt.verify(token, config.auth.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ message: 'انتهت الجلسة، سجّل الدخول مجدداً' });
  }
}

function requireManager(req, res, next) {
  if (!['manager', 'owner'].includes(req.user?.role)) return res.status(403).json({ message: 'هذه الصفحة للمدير أو المالك فقط' });
  next();
}

module.exports = { sign, requireAuth, requireManager };
