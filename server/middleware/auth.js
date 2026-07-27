const jwt = require('jsonwebtoken');
const { models } = require('../db');

const SECRET = () => process.env.JWT_SECRET || 'change-me-in-production';

function signToken(user) {
  return jwt.sign(
    { sub: String(user.id), username: user.username, role: user.role },
    SECRET(),
    { expiresIn: '72h' }
  );
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ detail: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, SECRET());
    const user = await models.User.findByPk(payload.sub);
    if (!user || !user.isActive) {
      return res.status(401).json({ detail: 'User not found or disabled' });
    }
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ detail: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ detail: 'Admin access required' });
  }
  next();
}

module.exports = { signToken, requireAuth, requireAdmin };
