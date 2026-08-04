const express = require('express');
const bcrypt = require('bcryptjs');
const { models } = require('../db');
const { signToken, requireAuth, requireAdmin } = require('../middleware/auth');

const auth = express.Router();
const users = express.Router();

const VALID_ROLES = ['admin', 'staff', 'partner'];

const userOut = u => ({
  id: String(u.id), username: u.username, role: u.role, isActive: u.isActive,
  partnerId: u.partnerId ? String(u.partnerId) : null,
  partnerName: u.partner ? u.partner.name : null,
});

const withPartner = () => ({ include: [{ model: models.Partner, as: 'partner' }] });

/* ---------- /api/auth ---------- */
auth.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = await models.User.findOne({ where: { username: username || '' }, ...withPartner() });
  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(401).json({ detail: 'Wrong username or password' });
  }
  if (!user.isActive) return res.status(403).json({ detail: 'Account is disabled' });
  res.json({ access_token: signToken(user), user: userOut(user) });
});

auth.get('/me', requireAuth, async (req, res) => {
  const user = await models.User.findByPk(req.user.id, withPartner());
  res.json(userOut(user));
});

/* ---------- /api/users (admin) ---------- */
users.use(requireAuth, requireAdmin);

users.get('/', async (req, res) => {
  const list = await models.User.findAll({ order: [['createdAt', 'ASC']], ...withPartner() });
  res.json(list.map(userOut));
});

/* A 'partner' user logs in as a specific Partner record — required and
 * validated only for that role; irrelevant for admin/staff. */
async function resolvePartnerId(role, partner_id) {
  if (role !== 'partner') return { partnerId: null };
  const partner = partner_id ? await models.Partner.findByPk(partner_id) : null;
  if (!partner) return { error: 'Pick which partner this login belongs to' };
  return { partnerId: partner.id };
}

users.post('/', async (req, res) => {
  const { username, password, role = 'staff', partner_id } = req.body || {};
  if (!username || !password) return res.status(422).json({ detail: 'Username and password are required' });
  if (!VALID_ROLES.includes(role)) return res.status(422).json({ detail: `Role must be one of: ${VALID_ROLES.join(', ')}` });
  if (await models.User.findOne({ where: { username } })) {
    return res.status(409).json({ detail: 'Username already exists' });
  }
  const { partnerId, error } = await resolvePartnerId(role, partner_id);
  if (error) return res.status(422).json({ detail: error });
  const user = await models.User.create({ username, passwordHash: await bcrypt.hash(password, 10), role, partnerId });
  res.status(201).json(userOut(await models.User.findByPk(user.id, withPartner())));
});

users.patch('/:id', async (req, res) => {
  const user = await models.User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ detail: 'User not found' });
  const { password, role, isActive, partner_id } = req.body || {};
  if (password) user.passwordHash = await bcrypt.hash(password, 10);
  if (role) {
    if (!VALID_ROLES.includes(role)) return res.status(422).json({ detail: `Role must be one of: ${VALID_ROLES.join(', ')}` });
    const { partnerId, error } = await resolvePartnerId(role, partner_id ?? user.partnerId);
    if (error) return res.status(422).json({ detail: error });
    user.role = role;
    user.partnerId = partnerId;
  }
  if (isActive !== undefined) {
    if (user.id === req.user.id && isActive === false) {
      return res.status(422).json({ detail: "You can't disable your own account" });
    }
    user.isActive = isActive;
  }
  await user.save();
  res.json(userOut(await models.User.findByPk(user.id, withPartner())));
});

users.delete('/:id', async (req, res) => {
  if (String(req.params.id) === String(req.user.id)) {
    return res.status(422).json({ detail: "You can't delete your own account" });
  }
  const user = await models.User.findByPk(req.params.id);
  if (!user) return res.status(404).json({ detail: 'User not found' });
  await user.destroy();
  res.status(204).end();
});

module.exports = { auth, users };
