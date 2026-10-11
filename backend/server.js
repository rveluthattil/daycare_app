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
  CREATE TABLE IF NOT EXISTS growth_passport_preference_options (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    label TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS student_id_sequences (
    id INTEGER PRIMARY KEY AUTOINCREMENT
  );
  CREATE TABLE IF NOT EXISTS growth_passport_sections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS growth_passport_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    section_id INTEGER NOT NULL REFERENCES growth_passport_sections(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    UNIQUE (section_id, label)
  );
  CREATE TABLE IF NOT EXISTS student_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    student_id TEXT NOT NULL,
    first_name TEXT NOT NULL,
    middle_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL,
    date_of_birth TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    sex TEXT NOT NULL DEFAULT '',
    parent_status TEXT NOT NULL DEFAULT '',
    father_name TEXT NOT NULL DEFAULT '',
    mother_name TEXT NOT NULL DEFAULT '',
    guardian_name TEXT NOT NULL DEFAULT '',
    sleep_morning_hours REAL,
    sleep_noon_hours REAL,
    sleep_night_hours REAL,
    preference_option_id INTEGER REFERENCES growth_passport_preference_options(id) ON DELETE SET NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (organization_id, student_id)
  );
  CREATE TABLE IF NOT EXISTS student_profile_preferences (
    student_profile_id INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    preference_option_id INTEGER NOT NULL REFERENCES growth_passport_preference_options(id) ON DELETE CASCADE,
    PRIMARY KEY (student_profile_id, preference_option_id)
  );
  CREATE TABLE IF NOT EXISTS growth_passport_daily_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_profile_id INTEGER NOT NULL REFERENCES student_profiles(id) ON DELETE CASCADE,
    log_date TEXT NOT NULL,
    created_by INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (student_profile_id, log_date)
  );
  CREATE TABLE IF NOT EXISTS growth_passport_daily_log_sections (
    daily_log_id INTEGER NOT NULL REFERENCES growth_passport_daily_logs(id) ON DELETE CASCADE,
    section_id INTEGER NOT NULL REFERENCES growth_passport_sections(id),
    note TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (daily_log_id, section_id)
  );
  CREATE TABLE IF NOT EXISTS growth_passport_daily_log_items (
    daily_log_id INTEGER NOT NULL,
    section_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL REFERENCES growth_passport_items(id),
    hours REAL,
    selected INTEGER,
    PRIMARY KEY (daily_log_id, section_id, item_id),
    FOREIGN KEY (daily_log_id, section_id)
      REFERENCES growth_passport_daily_log_sections(daily_log_id, section_id) ON DELETE CASCADE
  );
`)

const studentProfileColumns = database.pragma('table_info(student_profiles)')
if (!studentProfileColumns.some((column) => column.name === 'active')) {
  database.exec('ALTER TABLE student_profiles ADD COLUMN active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))')
}
for (const column of [
  'middle_name',
  'father_first_name',
  'father_last_name',
  'father_middle_name',
  'mother_first_name',
  'mother_last_name',
  'mother_middle_name',
  'guardian_first_name',
  'guardian_last_name',
  'guardian_middle_name',
  'sleep_morning_hours',
  'sleep_noon_hours',
  'sleep_night_hours',
]) {
  if (!studentProfileColumns.some((existing) => existing.name === column)) {
    const type = column.startsWith('sleep_') ? 'REAL' : "TEXT NOT NULL DEFAULT ''"
    database.exec(`ALTER TABLE student_profiles ADD COLUMN ${column} ${type}`)
  }
}
const dailyLogItemColumns = database.pragma('table_info(growth_passport_daily_log_items)')
if (!dailyLogItemColumns.some((column) => column.name === 'hours')) {
  database.exec('ALTER TABLE growth_passport_daily_log_items ADD COLUMN hours REAL')
}
if (!dailyLogItemColumns.some((column) => column.name === 'selected')) {
  database.exec('ALTER TABLE growth_passport_daily_log_items ADD COLUMN selected INTEGER')
}
database.exec(`
  INSERT OR IGNORE INTO student_profile_preferences (student_profile_id, preference_option_id)
  SELECT id, preference_option_id FROM student_profiles WHERE preference_option_id IS NOT NULL
`)
for (const [legacy, firstName] of [
  ['father_name', 'father_first_name'],
  ['mother_name', 'mother_first_name'],
  ['guardian_name', 'guardian_first_name'],
]) {
  if (studentProfileColumns.some((column) => column.name === legacy)) {
    database.exec(`
      UPDATE student_profiles SET ${firstName} = ${legacy}
      WHERE ${firstName} = '' AND ${legacy} != ''
    `)
  }
}

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
    ['Growth Passport', 'growth-passport', 'Student profiles and day-to-day preferences.', 'sprout', 5],
  ].forEach((item) => insertMenu.run(...item))
  const menuRows = database.prepare('SELECT id, menu_key FROM menu_items').all()
  const configure = database.prepare(`
    INSERT OR IGNORE INTO organization_menu_settings
      (organization_id, menu_item_id, enabled, show_org_admin, show_org_user, custom_label)
    VALUES (?, ?, ?, 1, ?, '')
  `)
  for (const organization of [cedar, harbor]) {
    for (const menu of menuRows) {
      const memberVisible = ['overview', 'projects', 'documents', 'growth-passport'].includes(menu.menu_key) ? 1 : 0
      configure.run(organization.id, menu.id, 1, memberVisible)
    }
  }
})
seed()
const insertGrowthPreferenceOption = database.prepare(`
  INSERT OR IGNORE INTO growth_passport_preference_options (label, sort_order) VALUES (?, ?)
`)
;[
  'TV (Games)',
  'Physical Games',
  'TV',
  'Play Studio',
].forEach((option, index) => insertGrowthPreferenceOption.run(option, index))
database.prepare(`
  UPDATE growth_passport_preference_options SET active = 0 WHERE label = 'Daily Sleep Time'
`).run()
database.prepare(`
  DELETE FROM student_profile_preferences
  WHERE preference_option_id IN (
    SELECT id FROM growth_passport_preference_options WHERE active = 0
  )
`).run()
const insertGrowthSection = database.prepare(`
  INSERT OR IGNORE INTO growth_passport_sections (section_key, title, description, sort_order)
  VALUES (?, ?, ?, ?)
`)
const growthSections = [
  ['education-preference', 'Education Preference', 'Activities and learning experiences the student enjoys.', ['Story time', 'Reading', 'Creative activities', 'Puzzles', 'Group learning']],
  ['play-time-preferences', 'Play Time Preferences', 'Favorite ways to play and move throughout the day.', ['TV (Games)', 'Physical Games', 'TV', 'Play Studio', 'Outdoor play']],
  ['food-preferences', 'Food Preferences', 'Meals, snacks, and food preferences to note.', ['Fruits', 'Vegetables', 'Dairy', 'Grains', 'Favorite meal']],
  ['emotional-preferences', 'Emotional Preferences', 'Emotional cues, comforts, and support that help the student.', ['Quiet time', 'Comfort item', 'One-on-one support', 'Group activities', 'Outdoor time']],
  ['daily-sleep-time', 'Daily Sleep Time', 'Record sleeping hours for each part of the day.', ['Morning', 'Noon', 'Night']],
]
const insertGrowthItem = database.prepare(`
  INSERT OR IGNORE INTO growth_passport_items (section_id, label, sort_order) VALUES (?, ?, ?)
`)
for (const [index, [key, title, description, items]] of growthSections.entries()) {
  insertGrowthSection.run(key, title, description, index)
  const section = database.prepare('SELECT id FROM growth_passport_sections WHERE section_key = ?').get(key)
  items.forEach((item, itemIndex) => insertGrowthItem.run(section.id, item, itemIndex))
}
database.prepare(`
  UPDATE growth_passport_daily_log_items
  SET selected = 1, hours = NULL
  WHERE section_id = (SELECT id FROM growth_passport_sections WHERE section_key = 'food-preferences')
    AND hours IS NOT NULL AND selected IS NULL
`).run()
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

function requireGrowthPassportAccess(request, response, next) {
  if (!request.user.organization_id) {
    return response.status(403).json({ error: 'Growth Passport is available to organization members only.' })
  }
  const roleColumn = request.user.role === 'org_admin' ? 'show_org_admin' : 'show_org_user'
  const access = database.prepare(`
    SELECT 1 FROM menu_items
    JOIN organization_menu_settings ON organization_menu_settings.menu_item_id = menu_items.id
    WHERE menu_items.menu_key = 'growth-passport' AND menu_items.active = 1
      AND organization_menu_settings.organization_id = ?
      AND organization_menu_settings.enabled = 1
      AND organization_menu_settings.${roleColumn} = 1
  `).get(request.user.organization_id)
  if (!access) return response.status(403).json({ error: 'Growth Passport is not enabled for your account.' })
  return next()
}

function isValidDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value
}

function growthPassportProfile(profileId, organizationId) {
  const profile = database.prepare(`
    SELECT student_profiles.id, student_profiles.student_id AS studentId,
    student_profiles.first_name AS firstName, student_profiles.middle_name AS middleName,
    student_profiles.last_name AS lastName,
      student_profiles.date_of_birth AS dateOfBirth, student_profiles.address,
      student_profiles.sex, student_profiles.parent_status AS parentStatus,
      student_profiles.father_first_name AS fatherFirstName,
      student_profiles.father_last_name AS fatherLastName,
      student_profiles.father_middle_name AS fatherMiddleName,
      student_profiles.mother_first_name AS motherFirstName,
      student_profiles.mother_last_name AS motherLastName,
      student_profiles.mother_middle_name AS motherMiddleName,
      student_profiles.guardian_first_name AS guardianFirstName,
      student_profiles.guardian_last_name AS guardianLastName,
      student_profiles.guardian_middle_name AS guardianMiddleName,
      student_profiles.sleep_morning_hours AS sleepMorningHours,
      student_profiles.sleep_noon_hours AS sleepNoonHours,
      student_profiles.sleep_night_hours AS sleepNightHours,
      student_profiles.active,
      student_profiles.updated_at AS updatedAt
    FROM student_profiles
    WHERE student_profiles.id = ? AND student_profiles.organization_id = ?
  `).get(profileId, organizationId)
  if (!profile) return null
  const preferences = database.prepare(`
    SELECT growth_passport_preference_options.id, growth_passport_preference_options.label
    FROM student_profile_preferences
    JOIN growth_passport_preference_options
      ON growth_passport_preference_options.id = student_profile_preferences.preference_option_id
    WHERE student_profile_preferences.student_profile_id = ?
    ORDER BY growth_passport_preference_options.sort_order, growth_passport_preference_options.id
  `).all(profileId)
  return {
    ...profile,
    active: Boolean(profile.active),
    preferenceOptionIds: preferences.map((option) => option.id),
    preferences: preferences.map((option) => option.label),
  }
}

function growthPassportProfileInput(body) {
  const preferenceOptionIds = Array.isArray(body.preferenceOptionIds)
    ? body.preferenceOptionIds.map(Number)
    : []
  const active = body.active === undefined ? true : body.active
  const profile = {
    firstName: String(body.firstName || '').trim(),
    middleName: String(body.middleName || '').trim(),
    lastName: String(body.lastName || '').trim(),
    dateOfBirth: String(body.dateOfBirth || '').trim(),
    address: String(body.address || '').trim(),
    sex: String(body.sex || '').trim(),
    parentStatus: String(body.parentStatus || '').trim(),
    fatherFirstName: String(body.fatherFirstName || '').trim(),
    fatherLastName: String(body.fatherLastName || '').trim(),
    fatherMiddleName: String(body.fatherMiddleName || '').trim(),
    motherFirstName: String(body.motherFirstName || '').trim(),
    motherLastName: String(body.motherLastName || '').trim(),
    motherMiddleName: String(body.motherMiddleName || '').trim(),
    guardianFirstName: String(body.guardianFirstName || '').trim(),
    guardianLastName: String(body.guardianLastName || '').trim(),
    guardianMiddleName: String(body.guardianMiddleName || '').trim(),
    sleepMorningHours: body.sleepMorningHours === '' || body.sleepMorningHours == null
      ? null
      : Number(body.sleepMorningHours),
    sleepNoonHours: body.sleepNoonHours === '' || body.sleepNoonHours == null
      ? null
      : Number(body.sleepNoonHours),
    sleepNightHours: body.sleepNightHours === '' || body.sleepNightHours == null
      ? null
      : Number(body.sleepNightHours),
    preferenceOptionIds,
    active,
  }
  profile.valid = profile.firstName.length > 0 && profile.firstName.length <= 80
    && profile.middleName.length <= 80
    && profile.lastName.length > 0 && profile.lastName.length <= 80
    && isValidDate(profile.dateOfBirth) && profile.dateOfBirth <= new Date().toISOString().slice(0, 10)
    && profile.address.length <= 1000 && profile.sex.length <= 40
    && ['', 'Single', 'Married'].includes(profile.parentStatus)
    && [
      profile.fatherFirstName, profile.fatherLastName, profile.fatherMiddleName,
      profile.motherFirstName, profile.motherLastName, profile.motherMiddleName,
      profile.guardianFirstName, profile.guardianLastName, profile.guardianMiddleName,
    ].every((name) => name.length <= 120)
    && [profile.sleepMorningHours, profile.sleepNoonHours, profile.sleepNightHours]
      .every((hours) => hours === null || (Number.isFinite(hours) && hours >= 0 && hours <= 24))
    && Array.isArray(body.preferenceOptionIds || [])
    && preferenceOptionIds.length <= 100
    && preferenceOptionIds.every((id) => Number.isInteger(id) && id > 0)
    && new Set(preferenceOptionIds).size === preferenceOptionIds.length
    && typeof active === 'boolean'
  return profile
}

function growthPassportPreferencesAreValid(preferenceOptionIds) {
  if (preferenceOptionIds.length === 0) return true
  const availableIds = new Set(database.prepare(`
    SELECT id FROM growth_passport_preference_options WHERE active = 1
  `).all().map((option) => option.id))
  return preferenceOptionIds.every((id) => availableIds.has(id))
}

function growthPassportCatalog() {
  const preferenceOptions = database.prepare(`
    SELECT id, label FROM growth_passport_preference_options
    WHERE active = 1 ORDER BY sort_order, id
  `).all()
  const sections = database.prepare(`
    SELECT id, section_key AS key, title, description
    FROM growth_passport_sections WHERE active = 1 ORDER BY sort_order, id
  `).all()
  const items = database.prepare(`
    SELECT id, section_id AS sectionId, label FROM growth_passport_items
    WHERE active = 1 ORDER BY sort_order, id
  `).all()
  return {
    preferenceOptions,
    sections: sections.map((section) => ({
      ...section,
      items: items.filter((item) => item.sectionId === section.id),
    })),
  }
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

app.get('/api/growth-passport/catalog', requireAuth, requireGrowthPassportAccess, (_request, response) => {
  return response.json(growthPassportCatalog())
})

app.get('/api/growth-passport/students', requireAuth, requireGrowthPassportAccess, (request, response) => {
  const students = database.prepare(`
    SELECT student_profiles.id, student_profiles.student_id AS studentId,
      student_profiles.first_name AS firstName, student_profiles.middle_name AS middleName,
      student_profiles.last_name AS lastName,
      student_profiles.date_of_birth AS dateOfBirth, student_profiles.active
    FROM student_profiles
    WHERE student_profiles.organization_id = ?
    ORDER BY student_profiles.last_name COLLATE NOCASE, student_profiles.first_name COLLATE NOCASE
  `).all(request.user.organization_id)
  const preferences = database.prepare(`
    SELECT student_profile_preferences.student_profile_id AS studentId,
      growth_passport_preference_options.id AS preferenceOptionId,
      growth_passport_preference_options.label
    FROM student_profile_preferences
    JOIN student_profiles ON student_profiles.id = student_profile_preferences.student_profile_id
    JOIN growth_passport_preference_options
      ON growth_passport_preference_options.id = student_profile_preferences.preference_option_id
    WHERE student_profiles.organization_id = ?
    ORDER BY growth_passport_preference_options.sort_order, growth_passport_preference_options.id
  `).all(request.user.organization_id)
  const preferencesByStudent = new Map()
  for (const preference of preferences) {
    const studentPreferences = preferencesByStudent.get(preference.studentId) || []
    studentPreferences.push(preference)
    preferencesByStudent.set(preference.studentId, studentPreferences)
  }
  const result = students.map((student) => {
    const studentPreferences = preferencesByStudent.get(student.id) || []
    return {
      ...student,
      active: Boolean(student.active),
      preferenceOptionIds: studentPreferences.map((option) => option.preferenceOptionId),
      preferences: studentPreferences.map((option) => option.label),
    }
  })
  return response.json({ students: result })
})

app.get('/api/growth-passport/students/:id', requireAuth, requireGrowthPassportAccess, (request, response) => {
  const profileId = Number(request.params.id)
  const student = Number.isInteger(profileId) && profileId > 0
    ? growthPassportProfile(profileId, request.user.organization_id)
    : null
  if (!student) return response.status(404).json({ error: 'Student profile not found.' })
  return response.json({ student })
})

app.post('/api/growth-passport/students', requireAuth, requireGrowthPassportAccess, (request, response) => {
  const body = request.body || {}
  const profile = growthPassportProfileInput(body)
  if (!profile.valid) {
    return response.status(400).json({ error: 'Check the student details and try again.' })
  }
  if (!growthPassportPreferencesAreValid(profile.preferenceOptionIds)) {
    return response.status(400).json({ error: 'Choose a valid student preference.' })
  }
  const createStudent = database.transaction(() => {
    let studentId
    do {
      const sequence = database.prepare('INSERT INTO student_id_sequences DEFAULT VALUES').run()
      studentId = `STU-${String(sequence.lastInsertRowid).padStart(6, '0')}`
    } while (database.prepare('SELECT 1 FROM student_profiles WHERE student_id = ?').get(studentId))
    const result = database.prepare(`
      INSERT INTO student_profiles
        (organization_id, student_id, first_name, middle_name, last_name, date_of_birth, address, sex,
          parent_status, father_first_name, father_last_name, father_middle_name,
          mother_first_name, mother_last_name, mother_middle_name,
          guardian_first_name, guardian_last_name, guardian_middle_name,
          sleep_morning_hours, sleep_noon_hours, sleep_night_hours, preference_option_id, active)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      request.user.organization_id, studentId, profile.firstName, profile.middleName, profile.lastName,
      profile.dateOfBirth, profile.address, profile.sex, profile.parentStatus,
      profile.fatherFirstName, profile.fatherLastName, profile.fatherMiddleName,
      profile.motherFirstName, profile.motherLastName, profile.motherMiddleName,
      profile.guardianFirstName, profile.guardianLastName, profile.guardianMiddleName,
      profile.sleepMorningHours, profile.sleepNoonHours, profile.sleepNightHours,
      profile.preferenceOptionIds[0] || null, profile.active ? 1 : 0,
    )
    const insertPreference = database.prepare(`
      INSERT INTO student_profile_preferences (student_profile_id, preference_option_id) VALUES (?, ?)
    `)
    for (const optionId of profile.preferenceOptionIds) insertPreference.run(result.lastInsertRowid, optionId)
    return Number(result.lastInsertRowid)
  })
  const profileId = createStudent()
  return response.status(201).json({ student: growthPassportProfile(profileId, request.user.organization_id) })
})

app.patch('/api/growth-passport/students/:id', requireAuth, requireGrowthPassportAccess, (request, response) => {
  const profileId = Number(request.params.id)
  if (!Number.isInteger(profileId) || profileId < 1
    || !growthPassportProfile(profileId, request.user.organization_id)) {
    return response.status(404).json({ error: 'Student profile not found.' })
  }
  const body = request.body || {}
  const profile = growthPassportProfileInput(body)
  if (!profile.valid) {
    return response.status(400).json({ error: 'Check the student details and try again.' })
  }
  if (!growthPassportPreferencesAreValid(profile.preferenceOptionIds)) {
    return response.status(400).json({ error: 'Choose a valid student preference.' })
  }
  const saveStudent = database.transaction(() => {
    database.prepare(`
      UPDATE student_profiles
      SET first_name = ?, middle_name = ?, last_name = ?, date_of_birth = ?, address = ?,
        sex = ?, parent_status = ?, father_first_name = ?, father_last_name = ?, father_middle_name = ?,
        mother_first_name = ?, mother_last_name = ?, mother_middle_name = ?,
        guardian_first_name = ?, guardian_last_name = ?, guardian_middle_name = ?,
        sleep_morning_hours = ?, sleep_noon_hours = ?, sleep_night_hours = ?,
        preference_option_id = ?, active = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND organization_id = ?
    `).run(
      profile.firstName, profile.middleName, profile.lastName, profile.dateOfBirth, profile.address,
      profile.sex, profile.parentStatus,
      profile.fatherFirstName, profile.fatherLastName, profile.fatherMiddleName,
      profile.motherFirstName, profile.motherLastName, profile.motherMiddleName,
      profile.guardianFirstName, profile.guardianLastName, profile.guardianMiddleName,
      profile.sleepMorningHours, profile.sleepNoonHours, profile.sleepNightHours,
      profile.preferenceOptionIds[0] || null, profile.active ? 1 : 0,
      profileId, request.user.organization_id,
    )
    database.prepare('DELETE FROM student_profile_preferences WHERE student_profile_id = ?').run(profileId)
    const insertPreference = database.prepare(`
      INSERT INTO student_profile_preferences (student_profile_id, preference_option_id) VALUES (?, ?)
    `)
    for (const optionId of profile.preferenceOptionIds) insertPreference.run(profileId, optionId)
  })
  saveStudent()
  return response.json({ student: growthPassportProfile(profileId, request.user.organization_id) })
})

app.delete('/api/growth-passport/students/:id', requireAuth, requireGrowthPassportAccess, (request, response) => {
  const profileId = Number(request.params.id)
  if (!Number.isInteger(profileId) || profileId < 1) {
    return response.status(404).json({ error: 'Student profile not found.' })
  }
  const result = database.prepare(`
    DELETE FROM student_profiles WHERE id = ? AND organization_id = ?
  `).run(profileId, request.user.organization_id)
  if (result.changes === 0) return response.status(404).json({ error: 'Student profile not found.' })
  return response.json({ deleted: true })
})

app.get('/api/growth-passport/students/:id/logs/:date', requireAuth, requireGrowthPassportAccess, (request, response) => {
  const profileId = Number(request.params.id)
  const logDate = request.params.date
  if (!Number.isInteger(profileId) || profileId < 1
    || !growthPassportProfile(profileId, request.user.organization_id)) {
    return response.status(404).json({ error: 'Student profile not found.' })
  }
  if (!isValidDate(logDate)) return response.status(400).json({ error: 'Enter a valid date for the daily record.' })
  const log = database.prepare(`
    SELECT id FROM growth_passport_daily_logs WHERE student_profile_id = ? AND log_date = ?
  `).get(profileId, logDate)
  const catalog = growthPassportCatalog()
  if (!log) {
    return response.json({
      logDate,
      sections: catalog.sections.map((section) => ({
        sectionId: section.id,
        note: '',
        items: section.items.map((item) => ({
          itemId: item.id,
          hours: null,
          selected: section.key === 'food-preferences' ? false : null,
        })),
      })),
    })
  }
  const savedSections = database.prepare(`
    SELECT section_id AS sectionId, note
    FROM growth_passport_daily_log_sections WHERE daily_log_id = ?
  `).all(log.id)
  const savedItems = database.prepare(`
    SELECT section_id AS sectionId, item_id AS itemId, hours, selected
    FROM growth_passport_daily_log_items WHERE daily_log_id = ?
  `).all(log.id)
  return response.json({
    logDate,
    sections: catalog.sections.map((section) => ({
      sectionId: section.id,
      note: savedSections.find((saved) => saved.sectionId === section.id)?.note || '',
      items: section.items.map((item) => ({
        itemId: item.id,
        hours: section.key === 'food-preferences'
          ? null
          : savedItems.find((saved) => saved.sectionId === section.id && saved.itemId === item.id)?.hours ?? null,
        selected: section.key === 'food-preferences'
          ? Boolean(savedItems.find((saved) => saved.sectionId === section.id && saved.itemId === item.id)?.selected)
          : null,
      })),
    })),
  })
})

app.put('/api/growth-passport/students/:id/logs/:date', requireAuth, requireGrowthPassportAccess, (request, response) => {
  const profileId = Number(request.params.id)
  const logDate = request.params.date
  if (!Number.isInteger(profileId) || profileId < 1
    || !growthPassportProfile(profileId, request.user.organization_id)) {
    return response.status(404).json({ error: 'Student profile not found.' })
  }
  if (!isValidDate(logDate) || logDate > new Date().toISOString().slice(0, 10)) {
    return response.status(400).json({ error: 'Enter a valid date no later than today.' })
  }
  if (!Array.isArray(request.body?.sections)) {
    return response.status(400).json({ error: 'Daily preference sections must be provided.' })
  }
  const sections = database.prepare(`
    SELECT id, section_key AS key FROM growth_passport_sections WHERE active = 1
  `).all()
  const sectionById = new Map(sections.map((section) => [section.id, section]))
  const sectionIds = new Set(sectionById.keys())
  const itemForSection = database.prepare(`
    SELECT 1 FROM growth_passport_items WHERE id = ? AND section_id = ? AND active = 1
  `)
  const entries = []
  const seenSections = new Set()
  for (const entry of request.body.sections) {
    const sectionId = Number(entry.sectionId)
    const note = String(entry.note || '').trim()
    if (!Number.isInteger(sectionId) || !sectionIds.has(sectionId) || seenSections.has(sectionId)
      || note.length > 1000 || !Array.isArray(entry.items)) {
      return response.status(400).json({ error: 'One or more daily preference sections are invalid.' })
    }
    seenSections.add(sectionId)
    const seenItems = new Set()
    const items = []
    const isFoodSection = sectionById.get(sectionId).key === 'food-preferences'
    for (const item of entry.items) {
      const itemId = Number(item.itemId)
      const hours = item.hours === '' || item.hours == null ? null : Number(item.hours)
      const selected = item.selected === undefined || item.selected === null ? null : item.selected
      if (!Number.isInteger(itemId) || seenItems.has(itemId) || !itemForSection.get(itemId, sectionId)
        || (hours !== null && (!Number.isFinite(hours) || hours < 0 || hours > 24))
        || (isFoodSection && (typeof selected !== 'boolean' || hours !== null))
        || (!isFoodSection && selected !== null)) {
        return response.status(400).json({ error: 'Enter valid hours for each preference item.' })
      }
      seenItems.add(itemId)
      items.push({ itemId, hours, selected })
    }
    entries.push({ sectionId, note, items })
  }
  const saveLog = database.transaction(() => {
    database.prepare(`
      INSERT INTO growth_passport_daily_logs (student_profile_id, log_date, created_by)
      VALUES (?, ?, ?)
      ON CONFLICT (student_profile_id, log_date) DO UPDATE SET
        created_by = excluded.created_by, updated_at = CURRENT_TIMESTAMP
    `).run(profileId, logDate, request.user.id)
    const log = database.prepare(`
      SELECT id FROM growth_passport_daily_logs WHERE student_profile_id = ? AND log_date = ?
    `).get(profileId, logDate)
    database.prepare('DELETE FROM growth_passport_daily_log_sections WHERE daily_log_id = ?').run(log.id)
    const insertSection = database.prepare(`
      INSERT INTO growth_passport_daily_log_sections (daily_log_id, section_id, note) VALUES (?, ?, ?)
    `)
    const insertItem = database.prepare(`
      INSERT INTO growth_passport_daily_log_items (daily_log_id, section_id, item_id, hours, selected)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const entry of entries) {
      insertSection.run(log.id, entry.sectionId, entry.note)
      for (const item of entry.items) {
        if (item.hours !== null || item.selected === true) {
          insertItem.run(log.id, entry.sectionId, item.itemId, item.hours, item.selected === null ? null : Number(item.selected))
        }
      }
    }
  })
  saveLog()
  return response.json({ saved: true, logDate })
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
      const menus = database.prepare('SELECT id, menu_key FROM menu_items').all()
      const setting = database.prepare(`
        INSERT INTO organization_menu_settings (organization_id, menu_item_id, enabled, show_org_admin, show_org_user)
        VALUES (?, ?, 1, 1, ?)
      `)
      for (const menu of menus) setting.run(organizationId, menu.id, menu.menu_key === 'growth-passport' ? 1 : 0)
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
