const express = require('express');
const bcrypt = require('bcryptjs');
const { User } = require('../models');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');

const auth = express.Router();
const users = express.Router();

const userOut = u => ({ id: u._id, username: u.username, role: u.role, isActive: u.isActive });

/* ---------- /api/auth ---------- */
auth.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(401).json({ detail: 'Wrong username or password' });
  }
  if (!user.isActive) return res.status(403).json({ detail: 'Account is disabled' });
  res.json({ access_token: signToken(user), user: userOut(user) });
});

auth.get('/me', requireAuth, (req, res) => res.json(userOut(req.user)));

/* ---------- /api/users (admin) ---------- */
users.use(requireAuth, requireAdmin);

users.get('/', async (req, res) => {
  const list = await User.find().sort({ createdAt: 1 });
  res.json(list.map(userOut));
});

users.post('/', async (req, res) => {
  const { username, password, role = 'staff' } = req.body || {};
  if (!username || !password) return res.status(422).json({ detail: 'Username and password are required' });
  if (!['admin', 'staff'].includes(role)) return res.status(422).json({ detail: "Role must be 'admin' or 'staff'" });
  if (await User.findOne({ username })) return res.status(409).json({ detail: 'Username already exists' });
  const user = await User.create({ username, passwordHash: await bcrypt.hash(password, 10), role });
  res.status(201).json(userOut(user));
});

users.patch('/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) return res.status(404).json({ detail: 'User not found' });
  const { password, role, isActive } = req.body || {};
  if (password) user.passwordHash = await bcrypt.hash(password, 10);
  if (role) {
    if (!['admin', 'staff'].includes(role)) return res.status(422).json({ detail: "Role must be 'admin' or 'staff'" });
    user.role = role;
  }
  if (isActive !== undefined) {
    if (user._id.equals(req.user._id) && isActive === false) {
      return res.status(422).json({ detail: "You can't disable your own account" });
    }
    user.isActive = isActive;
  }
  await user.save();
  res.json(userOut(user));
});

users.delete('/:id', async (req, res) => {
  if (req.params.id === req.user._id.toString()) {
    return res.status(422).json({ detail: "You can't delete your own account" });
  }
  const user = await User.findByIdAndDelete(req.params.id);
  if (!user) return res.status(404).json({ detail: 'User not found' });
  res.status(204).end();
});

module.exports = { auth, users };
