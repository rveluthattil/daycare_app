import 'dotenv/config'
import cookieParser from 'cookie-parser'
import express from 'express'
import Database from 'better-sqlite3'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')
const app = express()
app.use(cookieParser())
const database = new Database(path.join(__dirname, 'tenant-platform.sqlite3'))
const port = Number(process.env.PORT || 3001)
const jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-before-deploying'
const cookieName = 'tenant_session'

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production.')
}

app.use(express.json({ limit: '1mb' }))

database.pragma('journal_mode = WAL')
database.pragma('foreign_keys = ON')
database.exec(`
  CREATE TABLE IF NOT EXISTS organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    folder_name TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused')),
    tagline TEXT NOT NULL DEFAULT '',
    primary_color TEXT NOT NULL DEFAULT '#153f3a',
    accent_color TEXT NOT NULL DEFAULT '#d48862',
    logo_url TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('platform_admin', 'org_admin', 'org_user')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ((role = 'platform_admin' AND organization_id IS NULL) OR (role != 'platform_admin' AND organization_id IS NOT NULL))
  );
  CREATE TABLE IF NOT EXISTS menu_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    menu_key TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    icon TEXT NOT NULL DEFAULT 'grid',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS organization_menu_settings (
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    menu_item_id INTEGER NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    enabled INTEGER NOT NULL DEFAULT 1,
    show_org_admin INTEGER NOT NULL DEFAULT 1,
    show_org_user INTEGER NOT NULL DEFAULT 1,
    custom_label TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (organization_id, menu_item_id)
  );
`)

const insertOrganization = database.prepare(`
  INSERT OR IGNORE INTO organizations (name, folder_name, tagline, primary_color, accent_color)
  VALUES (?, ?, ?, ?, ?)
`)
const insertUser = database.prepare(`
  INSERT OR IGNORE INTO users (organization_id, name, email, password_hash, role)
  VALUES (?, ?, ?, ?, ?)
`)
const insertMenu = database.prepare(`
  INSERT OR IGNORE INTO menu_items (title, menu_key, description, icon, sort_order)
  VALUES (?, ?, ?, ?, ?)
`)
const seed = database.transaction(() => {
  insertOrganization.run('Cedar & Stone', 'cedar-stone', 'A considered space for better work.', '#244b42', '#d58c64')
  insertOrganization.run('Harbor House', 'harbor-house', 'Good work, in good company.', '#234a58', '#d6a25e')
  insertUser.run(null, 'Platform Administrator', 'admin@atlas.test', bcrypt.hashSync('Platform123!', 10), 'platform_admin')
  const cedar = database.prepare('SELECT id FROM organizations WHERE folder_name = ?').get('cedar-stone')
  const harbor = database.prepare('SELECT id FROM organizations WHERE folder_name = ?').get('harbor-house')
  insertUser.run(cedar.id, 'Jordan Lee', 'admin@cedar.test', bcrypt.hashSync('Organization123!', 10), 'org_admin')
  insertUser.run(cedar.id, 'Sam Rivera', 'member@cedar.test', bcrypt.hashSync('Member123!', 10), 'org_user')
  insertUser.run(harbor.id, 'Alex Morgan', 'admin@harbor.test', bcrypt.hashSync('Organization123!', 10), 'org_admin')
  insertUser.run(harbor.id, 'Taylor Quinn', 'member@harbor.test', bcrypt.hashSync('Member123!', 10), 'org_user')
  ;[
    ['Overview', 'overview', 'Your organization at a glance.', 'grid', 0],
    ['Projects', 'projects', 'Shared work and active initiatives.', 'folder', 1],
    ['Documents', 'documents', 'Reference files and organization resources.', 'file', 2],
    ['Reports', 'reports', 'Progress, activity, and outcomes.', 'chart', 3],
    ['People', 'people', 'The people in your organization.', 'users', 4],
  ].forEach((item) => insertMenu.run(...item))
  const menuRows = database.prepare('SELECT id, menu_key FROM menu_items').all()
  const configure = database.prepare(`
    INSERT OR IGNORE INTO organization_menu_settings
      (organization_id, menu_item_id, enabled, show_org_admin, show_org_user, custom_label)
    VALUES (?, ?, ?, 1, ?, '')
  `)
  for (const organization of [cedar, harbor]) {
    for (const menu of menuRows) {
      const memberVisible = ['overview', 'projects', 'documents'].includes(menu.menu_key) ? 1 : 0
      configure.run(organization.id, menu.id, 1, memberVisible)
    }
  }
})
seed()
for (const organization of database.prepare('SELECT folder_name FROM organizations').all()) {
  fs.mkdirSync(path.join(projectRoot, 'app', organization.folder_name), { recursive: true })
}

function createToken(userId) {
  return jwt.sign({ sub: userId }, jwtSecret, { expiresIn: '8h' })
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    organizationId: user.organization_id,
    organization: user.organization_id ? {
      id: user.organization_id,
      name: user.organization_name,
      folderName: user.folder_name,
      tagline: user.tagline,
      primaryColor: user.primary_color,
      accentColor: user.accent_color,
      logoUrl: user.logo_url,
    } : null,
  }
}

function requireAuth(request, response, next) {
  try {
    const token = request.cookies?.[cookieName]
    if (!token) return response.status(401).json({ error: 'Please sign in to continue.' })
    const payload = jwt.verify(token, jwtSecret)
    const user = database.prepare(`
      SELECT users.*, organizations.name AS organization_name, organizations.folder_name,
        organizations.tagline, organizations.primary_color, organizations.accent_color,
        organizations.logo_url, organizations.status AS organization_status
      FROM users LEFT JOIN organizations ON organizations.id = users.organization_id
      WHERE users.id = ? AND users.status = 'active'
    `).get(payload.sub)
    if (!user || (user.organization_id && user.organization_status !== 'active')) {
      return response.status(401).json({ error: 'This account is not available.' })
    }
    request.user = user
    return next()
  } catch {
    return response.status(401).json({ error: 'Your session has expired. Please sign in again.' })
  }
}

function requirePlatformAdmin(request, response, next) {
  if (request.user.role !== 'platform_admin') return response.status(403).json({ error: 'Platform administrator access is required.' })
  return next()
}

function organizationAccess(request, response, next) {
  const requestedId = Number(request.params.id)
  if (request.user.role !== 'platform_admin' && request.user.organization_id !== requestedId) {
    return response.status(403).json({ error: 'You cannot access another organization.' })
  }
  if (request.user.role === 'org_user' && request.method !== 'GET') {
    return response.status(403).json({ error: 'Organization administrator access is required.' })
  }
  request.organizationId = requestedId
  return next()
}

function getOrganization(organizationId) {
  return database.prepare(`
    SELECT organizations.*,
      (SELECT COUNT(*) FROM users WHERE users.organization_id = organizations.id AND users.status = 'active') AS user_count
    FROM organizations WHERE organizations.id = ?
  `).get(organizationId)
}

function menuForOrganization(organizationId, role) {
  const roleColumn = role === 'org_admin' ? 'show_org_admin' : 'show_org_user'
  return database.prepare(`
    SELECT menu_items.id, menu_items.title, menu_items.menu_key AS key,
      menu_items.description, menu_items.icon, menu_items.sort_order,
      COALESCE(NULLIF(organization_menu_settings.custom_label, ''), menu_items.title) AS label
    FROM menu_items
    JOIN organization_menu_settings ON organization_menu_settings.menu_item_id = menu_items.id
    WHERE organization_menu_settings.organization_id = ?
      AND organization_menu_settings.enabled = 1
      AND organization_menu_settings.${roleColumn} = 1
      AND menu_items.active = 1
    ORDER BY menu_items.sort_order, menu_items.id
  `).all(organizationId)
}

app.post('/api/auth/login', (request, response) => {
  const email = String(request.body?.email || '').trim().toLowerCase()
  const password = String(request.body?.password || '')
  const user = database.prepare(`
    SELECT users.*, organizations.name AS organization_name, organizations.folder_name,
      organizations.tagline, organizations.primary_color, organizations.accent_color,
      organizations.logo_url, organizations.status AS organization_status
    FROM users LEFT JOIN organizations ON organizations.id = users.organization_id
    WHERE users.email = ? AND users.status = 'active'
  `).get(email)
  if (!user || !bcrypt.compareSync(password, user.password_hash) || user.organization_status === 'paused') {
    return response.status(401).json({ error: 'Email or password is incorrect.' })
  }
  response.cookie(cookieName, createToken(user.id), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 8 * 60 * 60 * 1000,
    path: '/',
  })
  return response.json({ user: publicUser(user) })
})

app.post('/api/auth/logout', (_request, response) => {
  response.clearCookie(cookieName, { httpOnly: true, sameSite: 'lax', path: '/' })
  return response.status(204).end()
})

app.get('/api/session', requireAuth, (request, response) => {
  const user = publicUser(request.user)
  const menus = request.user.organization_id
    ? menuForOrganization(request.user.organization_id, request.user.role)
    : []
  return response.json({ user, menus })
})

app.get('/api/organizations', requireAuth, requirePlatformAdmin, (_request, response) => {
  const organizations = database.prepare(`
    SELECT organizations.id, organizations.name, organizations.folder_name AS folderName,
      organizations.status, organizations.tagline, organizations.primary_color AS primaryColor,
      organizations.accent_color AS accentColor, organizations.logo_url AS logoUrl,
      organizations.created_at AS createdAt,
      (SELECT COUNT(*) FROM users WHERE users.organization_id = organizations.id AND users.status = 'active') AS userCount
    FROM organizations ORDER BY organizations.name COLLATE NOCASE
  `).all()
  return response.json({ organizations })
})

app.get('/api/organizations/:id', requireAuth, organizationAccess, (request, response) => {
  const organization = getOrganization(request.organizationId)
  if (!organization) return response.status(404).json({ error: 'Organization not found.' })
  const members = database.prepare(`
    SELECT id, name, email, role, status FROM users
    WHERE organization_id = ? ORDER BY role, name COLLATE NOCASE
  `).all(request.organizationId)
  const menuSettings = database.prepare(`
    SELECT menu_items.id, menu_items.title, menu_items.menu_key AS key,
      menu_items.description, menu_items.icon, menu_items.sort_order,
      organization_menu_settings.enabled, organization_menu_settings.show_org_admin AS showOrgAdmin,
      organization_menu_settings.show_org_user AS showOrgUser,
      organization_menu_settings.custom_label AS customLabel
    FROM menu_items
    LEFT JOIN organization_menu_settings ON organization_menu_settings.menu_item_id = menu_items.id
      AND organization_menu_settings.organization_id = ?
    ORDER BY menu_items.sort_order, menu_items.id
  `).all(request.organizationId)
  const canManage = request.user.role !== 'org_user'
  return response.json({
    organization: {
      id: organization.id,
      name: organization.name,
      folderName: organization.folder_name,
      status: organization.status,
      tagline: organization.tagline,
      primaryColor: organization.primary_color,
      accentColor: organization.accent_color,
      logoUrl: organization.logo_url,
      userCount: organization.user_count,
    },
    members: canManage ? members : [],
    menuSettings: canManage ? menuSettings : [],
    menus: request.user.role === 'platform_admin' ? [] : menuForOrganization(request.organizationId, request.user.role),
  })
})

app.post('/api/organizations', requireAuth, requirePlatformAdmin, (request, response) => {
  const name = String(request.body?.name || '').trim()
  const folderName = String(request.body?.folderName || '').trim().toLowerCase()
  const adminName = String(request.body?.adminName || '').trim()
  const adminEmail = String(request.body?.adminEmail || '').trim().toLowerCase()
  const adminPassword = String(request.body?.adminPassword || '')
  if (!name || name.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(folderName)) {
    return response.status(400).json({ error: 'Enter an organization name and a folder name using lowercase letters, numbers, and hyphens.' })
  }
  if (!adminName || adminName.length > 80 || !/^\S+@\S+\.\S+$/.test(adminEmail) || adminEmail.length > 254 || adminPassword.length < 12 || adminPassword.length > 200) {
    return response.status(400).json({ error: 'Provide an administrator name, valid email, and password of at least 12 characters.' })
  }
  try {
    fs.mkdirSync(path.join(projectRoot, 'app', folderName), { recursive: true })
    const createOrganization = database.transaction(() => {
      const result = database.prepare(`
        INSERT INTO organizations (name, folder_name, tagline)
        VALUES (?, ?, ?)
      `).run(name, folderName, String(request.body?.tagline || '').trim().slice(0, 140))
      const organizationId = Number(result.lastInsertRowid)
      database.prepare(`
        INSERT INTO users (organization_id, name, email, password_hash, role)
        VALUES (?, ?, ?, ?, 'org_admin')
      `).run(organizationId, adminName, adminEmail, bcrypt.hashSync(adminPassword, 10))
      const menus = database.prepare('SELECT id FROM menu_items').all()
      const setting = database.prepare(`
        INSERT INTO organization_menu_settings (organization_id, menu_item_id, enabled, show_org_admin, show_org_user)
        VALUES (?, ?, 1, 1, 0)
      `)
      for (const menu of menus) setting.run(organizationId, menu.id)
      return organizationId
    })
    const organizationId = createOrganization()
    return response.status(201).json({ organization: getOrganization(organizationId), admin: { name: adminName, email: adminEmail } })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'That folder name or administrator email is already in use.' })
    throw error
  }
})

app.patch('/api/organizations/:id', requireAuth, organizationAccess, (request, response) => {
  const name = String(request.body?.name || '').trim()
  const tagline = String(request.body?.tagline || '').trim()
  const primaryColor = String(request.body?.primaryColor || '')
  const accentColor = String(request.body?.accentColor || '')
  const logoUrl = String(request.body?.logoUrl || '').trim()
  if (!/^#[0-9a-fA-F]{6}$/.test(primaryColor) || !/^#[0-9a-fA-F]{6}$/.test(accentColor)) {
    return response.status(400).json({ error: 'Brand colors must be six-digit hex values.' })
  }
  if (!name || name.length > 80 || tagline.length > 140 || logoUrl.length > 500) {
    return response.status(400).json({ error: 'Check the organization name, tagline, and logo URL.' })
  }
  database.prepare(`
    UPDATE organizations
    SET name = ?, tagline = ?, primary_color = ?, accent_color = ?, logo_url = ?
    WHERE id = ?
  `).run(name, tagline, primaryColor, accentColor, logoUrl, request.organizationId)
  return response.json({ organization: getOrganization(request.organizationId) })
})

app.patch('/api/organizations/:id/menu-settings', requireAuth, organizationAccess, (request, response) => {
  if (!Array.isArray(request.body?.settings)) return response.status(400).json({ error: 'Menu settings must be an array.' })
  const update = database.prepare(`
    INSERT INTO organization_menu_settings
      (organization_id, menu_item_id, enabled, show_org_admin, show_org_user, custom_label)
    VALUES (@organizationId, @menuId, @enabled, @showOrgAdmin, @showOrgUser, @customLabel)
    ON CONFLICT (organization_id, menu_item_id) DO UPDATE SET
      enabled = excluded.enabled,
      show_org_admin = excluded.show_org_admin,
      show_org_user = excluded.show_org_user,
      custom_label = excluded.custom_label
  `)
  const saveSettings = database.transaction((settings) => {
    for (const setting of settings) {
      if (!Number.isInteger(Number(setting.id))) throw new Error('Invalid menu item.')
      update.run({
        organizationId: request.organizationId,
        menuId: Number(setting.id),
        enabled: setting.enabled ? 1 : 0,
        showOrgAdmin: setting.showOrgAdmin ? 1 : 0,
        showOrgUser: setting.showOrgUser ? 1 : 0,
        customLabel: String(setting.customLabel || '').trim().slice(0, 60),
      })
    }
  })
  try {
    saveSettings(request.body.settings)
  } catch {
    return response.status(400).json({ error: 'One or more menu settings are invalid.' })
  }
  return response.json({ menus: menuForOrganization(request.organizationId, request.user.role) })
})

app.get('/api/menu-items', requireAuth, requirePlatformAdmin, (_request, response) => {
  const menuItems = database.prepare(`
    SELECT id, title, menu_key AS key, description, icon, sort_order AS sortOrder, active
    FROM menu_items ORDER BY sort_order, id
  `).all()
  return response.json({ menuItems })
})

app.post('/api/menu-items', requireAuth, requirePlatformAdmin, (request, response) => {
  const title = String(request.body?.title || '').trim()
  const description = String(request.body?.description || '').trim()
  const key = String(request.body?.key || '').trim().toLowerCase()
  if (!title || title.length > 40 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(key)) {
    return response.status(400).json({ error: 'Enter a title and a unique key using lowercase letters, numbers, and hyphens.' })
  }
  try {
    const result = database.prepare(`
      INSERT INTO menu_items (title, menu_key, description, icon, sort_order)
      VALUES (?, ?, ?, 'grid', (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM menu_items))
    `).run(title, key, description.slice(0, 140))
    const menuId = Number(result.lastInsertRowid)
    const organizations = database.prepare('SELECT id FROM organizations').all()
    const insertSetting = database.prepare(`
      INSERT INTO organization_menu_settings (organization_id, menu_item_id, enabled, show_org_admin, show_org_user)
      VALUES (?, ?, 1, 1, 0)
    `)
    for (const organization of organizations) insertSetting.run(organization.id, menuId)
    return response.status(201).json({ menuItem: { id: menuId, title, key, description, icon: 'grid', active: 1 } })
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return response.status(409).json({ error: 'That menu key already exists.' })
    throw error
  }
})

app.use((error, _request, response, _next) => {
  console.error(error)
  return response.status(500).json({ error: 'The request could not be completed.' })
})

app.listen(port, () => {
  console.log(`Tenant platform API listening on http://localhost:${port}`)
  console.log('Demo accounts: admin@atlas.test, admin@cedar.test, member@cedar.test')
})
