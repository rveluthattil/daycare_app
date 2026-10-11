import { useEffect, useState } from 'react'
import {
  ArrowDownRight,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronDown,
  CircleHelp,
  FileText,
  FolderKanban,
  Grid2X2,
  Layers3,
  LogOut,
  Menu as MenuIcon,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sprout,
  Users,
  X,
} from 'lucide-react'
import omniChildImage from './assets/omni_child.jpg'
import GrowthPassport from './GrowthPassport.jsx'
import './App.css'

const iconByName = {
  grid: Grid2X2,
  folder: FolderKanban,
  file: FileText,
  chart: BarChart3,
  users: Users,
  sprout: Sprout,
}

const demoAccounts = [
  { label: 'Platform admin', email: 'admin@atlas.test', password: 'Platform123!', icon: ShieldCheck },
  { label: 'Org admin', email: 'admin@cedar.test', password: 'Organization123!', icon: Settings2 },
  { label: 'Org member', email: 'member@cedar.test', password: 'Member123!', icon: Users },
]

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  if (response.status === 204) return null
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Something went wrong.')
  return result
}

function App() {
  const [session, setSession] = useState(null)
  const [email, setEmail] = useState('admin@atlas.test')
  const [password, setPassword] = useState('Platform123!')
  const [loginError, setLoginError] = useState('')
  const [busy, setBusy] = useState(false)
  const [section, setSection] = useState('overview')
  const [organizations, setOrganizations] = useState([])
  const [menuItems, setMenuItems] = useState([])
  const [activeOrganization, setActiveOrganization] = useState(null)
  const [organizationDetails, setOrganizationDetails] = useState(null)
  const [notice, setNotice] = useState('')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  useEffect(() => {
    api('/session')
      .then((result) => setSession(result))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (!session) return
    if (session.user.role === 'platform_admin') {
      api('/organizations').then((result) => setOrganizations(result.organizations)).catch(showError)
    } else if (session.user.organizationId) {
      api(`/organizations/${session.user.organizationId}`).then((result) => setOrganizationDetails(result)).catch(showError)
    }
  }, [session])

  useEffect(() => {
    if (session?.user.role === 'platform_admin' && section === 'menu-library') {
      api('/menu-items').then((result) => setMenuItems(result.menuItems)).catch(showError)
    }
  }, [session, section])

  function showError(error) {
    setNotice(error.message)
  }

  async function handleLogin(event) {
    event.preventDefault()
    setBusy(true)
    setLoginError('')
    try {
      const result = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      const currentSession = await api('/session')
      setSession(currentSession)
      setActiveOrganization(null)
      setOrganizationDetails(null)
      setSection(result.user.role === 'platform_admin' ? 'overview' : 'overview')
    } catch (error) {
      setLoginError(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function handleLogout() {
    await api('/auth/logout', { method: 'POST' }).catch(() => {})
    setSession(null)
    setActiveOrganization(null)
    setOrganizationDetails(null)
    setSection('overview')
  }

  async function openOrganization(organization) {
    try {
      const result = await api(`/organizations/${organization.id}`)
      setActiveOrganization(organization)
      setOrganizationDetails(result)
      setSection('overview')
    } catch (error) {
      showError(error)
    }
  }

  async function refreshOrganizations() {
    const result = await api('/organizations')
    setOrganizations(result.organizations)
  }

  if (!session) {
    return (
      <LoginScreen
        email={email}
        password={password}
        error={loginError}
        busy={busy}
        onEmail={setEmail}
        onPassword={setPassword}
        onSubmit={handleLogin}
      />
    )
  }

  const { user } = session
  const isPlatformAdmin = user.role === 'platform_admin'
  const isOrgAdmin = user.role === 'org_admin'
  const organization = organizationDetails?.organization || user.organization
  const viewingOrganization = isPlatformAdmin && activeOrganization
  const workspaceMenus = viewingOrganization
    ? organizationDetails?.menuSettings?.filter((item) => item.enabled)
      .map((item) => ({ ...item, label: item.customLabel || item.title })) || []
    : session.menus
  const currentOrganization = viewingOrganization || organization
  const navItems = isPlatformAdmin && !viewingOrganization
    ? [
        { key: 'overview', label: 'Overview', icon: Grid2X2 },
        { key: 'organizations', label: 'Organizations', icon: Layers3 },
        { key: 'menu-library', label: 'Menu library', icon: MenuIcon },
      ]
    : [
        ...workspaceMenus.map((item) => ({
          key: item.key,
          label: item.label,
          icon: iconByName[item.icon] || Grid2X2,
        })),
        ...(isOrgAdmin && !viewingOrganization ? [{ key: 'settings', label: 'Workspace settings', icon: Settings2 }] : []),
      ]

  async function addOrganization(form) {
    try {
      await api('/organizations', { method: 'POST', body: JSON.stringify(form) })
      await refreshOrganizations()
      setNotice(`${form.name} is ready to configure.`)
    } catch (error) {
      showError(error)
      throw error
    }
  }

  async function addMenuItem(form) {
    try {
      await api('/menu-items', { method: 'POST', body: JSON.stringify(form) })
      const result = await api('/menu-items')
      setMenuItems(result.menuItems)
      setNotice(`${form.title} was added to the menu library.`)
    } catch (error) {
      showError(error)
      throw error
    }
  }

  async function saveBranding(form) {
    try {
      const result = await api(`/organizations/${organization.id}`, {
        method: 'PATCH',
        body: JSON.stringify(form),
      })
      setOrganizationDetails((current) => ({ ...current, organization: result.organization }))
      setSession((current) => ({
        ...current,
        user: { ...current.user, organization: result.organization },
      }))
      setNotice('Workspace appearance saved.')
    } catch (error) {
      showError(error)
      throw error
    }
  }

  async function saveMenus(settings) {
    try {
      const result = await api(`/organizations/${organization.id}/menu-settings`, {
        method: 'PATCH',
        body: JSON.stringify({ settings }),
      })
      setOrganizationDetails((current) => ({ ...current, menus: result.menus }))
      const freshSession = await api('/session')
      setSession(freshSession)
      setNotice('Workspace navigation saved.')
    } catch (error) {
      showError(error)
      throw error
    }
  }

  function navigate(key) {
    setSection(key)
    setMobileNavOpen(false)
  }

  return (
    <div className="app-shell" style={currentOrganization ? { '--tenant-primary': currentOrganization.primaryColor, '--tenant-accent': currentOrganization.accentColor } : undefined}>
      <aside className={`sidebar ${mobileNavOpen ? 'sidebar-open' : ''}`}>
        <a className="brand-mark" href="#overview" onClick={(event) => { event.preventDefault(); navigate('overview') }}>
          <span className="brand-symbol">
            <img src={omniChildImage} alt="" />
          </span>
          <span>OmniChild<span className="brand-period">.</span></span>
        </a>
        <div className="sidebar-divider" />
        <div className="sidebar-label">{isPlatformAdmin && !viewingOrganization ? 'PLATFORM' : 'WORKSPACE'}</div>
        <nav className="side-nav" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button className={`nav-item ${section === item.key ? 'nav-item-active' : ''}`} key={item.key} onClick={() => navigate(item.key)}>
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
                {item.key === 'organizations' && <span className="nav-count">{organizations.length}</span>}
              </button>
            )
          })}
        </nav>
        <div className="sidebar-bottom">
          <div className="help-row"><CircleHelp size={17} /><span>Help center</span><ArrowUpRight size={13} /></div>
          <div className="profile-row">
            <div className="avatar">{initials(user.name)}</div>
            <div className="profile-copy"><strong>{user.name}</strong><span>{roleLabel(user.role)}</span></div>
            <button className="icon-button logout-button" onClick={handleLogout} aria-label="Sign out" title="Sign out"><LogOut size={16} /></button>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Open navigation" onClick={() => setMobileNavOpen(!mobileNavOpen)}><MenuIcon size={19} /></button>
          <div className="breadcrumb">
            <span>{isPlatformAdmin && !viewingOrganization ? 'Platform' : currentOrganization?.name || 'Workspace'}</span>
            <span className="breadcrumb-slash">/</span>
            <strong>{navItems.find((item) => item.key === section)?.label || sectionTitle(section)}</strong>
          </div>
          {viewingOrganization && <button className="back-button" onClick={() => { setActiveOrganization(null); setOrganizationDetails(null); navigate('organizations') }}><ArrowLeft size={15} /> All organizations</button>}
          <div className="topbar-right"><span className="status-dot" /> All systems normal</div>
        </header>

        <div className="page-content">
          {notice && <div className="notice" role="status"><Check size={15} />{notice}<button onClick={() => setNotice('')} aria-label="Dismiss"><X size={14} /></button></div>}
          {isPlatformAdmin && !viewingOrganization && section === 'organizations' && (
            <OrganizationsPage organizations={organizations} onAdd={addOrganization} onOpen={openOrganization} />
          )}
          {isPlatformAdmin && !viewingOrganization && section === 'menu-library' && (
            <MenuLibraryPage menuItems={menuItems} onAdd={addMenuItem} />
          )}
          {isPlatformAdmin && !viewingOrganization && section === 'overview' && (
            <PlatformOverview organizations={organizations} onOpen={openOrganization} onNavigate={navigate} />
          )}
          {section === 'settings' && isOrgAdmin && organizationDetails && (
            <WorkspaceSettings organization={organizationDetails.organization} menuSettings={organizationDetails.menuSettings} onSaveBranding={saveBranding} onSaveMenus={saveMenus} />
          )}
          {(!isPlatformAdmin || viewingOrganization) && section === 'growth-passport' && organizationDetails && (
            <GrowthPassport />
          )}
          {(!isPlatformAdmin || viewingOrganization) && section !== 'settings' && section !== 'growth-passport' && organizationDetails && (
            <WorkspacePage organization={currentOrganization} menus={workspaceMenus} section={section} user={user} />
          )}
        </div>
        <footer className="page-footer"><span>FIELDNOTE PLATFORM</span><span>© 2026</span></footer>
      </main>
    </div>
  )
}

function LoginScreen({ email, password, error, busy, onEmail, onPassword, onSubmit }) {
  return (
    <main className="login-screen">
      <section className="login-panel">
        <a className="brand-mark login-brand" href="#home">
          <span className="brand-symbol"><img src={omniChildImage} alt="" /></span>
          <span>OmniChild<span className="brand-period">.</span></span>
        </a>
        <div className="login-form-wrap">
          <div className="eyebrow"><span className="eyebrow-line" />The rhythm of childcare, tailored to every child.</div>
          <h1>Good to see<br />you again.</h1>
          <p className="login-intro">Sign in to your workspace and pick up where your team left off.</p>
          <form className="login-form" onSubmit={onSubmit}>
            <label>Email address<input autoComplete="username" type="email" value={email} onChange={(event) => onEmail(event.target.value)} required /></label>
            <label>Password<input autoComplete="current-password" type="password" value={password} onChange={(event) => onPassword(event.target.value)} required /></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}<ArrowRight size={16} /></button>
          </form>
          <div className="demo-access">
            <div className="demo-head"><span>DEMO ACCESS</span><span>Choose a role</span></div>
            <div className="demo-options">
              {demoAccounts.map((account) => {
                const Icon = account.icon
                return <button key={account.email} className="demo-option" onClick={() => { onEmail(account.email); onPassword(account.password) }}><Icon size={15} /><span>{account.label}</span><ArrowRight size={14} /></button>
              })}
            </div>
          </div>
        </div>
        <div className="login-foot"><span>Secure organization access</span><span>Privacy · Terms</span></div>
      </section>
      <section className="login-art" aria-label="Workspace preview">
        <div className="art-image" />
        <div className="art-overlay" />
        <div className="art-note"><div className="art-note-top"><span>CEDAR & STONE</span><span><Sparkles size={14} /> 01 / 03</span>
        </div><p>“The rhythm of childcare, tailored to every child.”</p><div className="art-note-bottom"><span>YOUR WORKSPACE, YOUR WAY</span><span className="art-progress"><i /></span></div></div>
        <div className="art-caption"><span>FIELDNOTE / 001</span><span>DESIGNED FOR TEAMS THAT CARE</span></div>
      </section>
    </main>
  )
}

function PlatformOverview({ organizations, onOpen, onNavigate }) {
  const activeCount = organizations.filter((organization) => organization.status === 'active').length
  const peopleCount = organizations.reduce((total, organization) => total + organization.userCount, 0)
  return (
    <>
      <div className="page-heading heading-with-action"><div><div className="eyebrow"><span className="eyebrow-line" />PLATFORM ADMINISTRATION</div><h1>Good morning,<br /><span>let’s get organized.</span></h1><p className="heading-copy">One clear view of every workspace, team, and shared menu.</p></div><button className="primary-button" onClick={() => onNavigate('organizations')}>Manage organizations<ArrowRight size={16} /></button></div>
      <div className="metric-grid">
        <Metric label="Organizations" value={organizations.length} detail="Across the platform" icon={Layers3} tone="sage" />
        <Metric label="Active workspaces" value={activeCount} detail="Ready for their teams" icon={Grid2X2} tone="ochre" />
        <Metric label="People" value={peopleCount} detail="Organization accounts" icon={Users} tone="blue" />
      </div>
      <section className="section-block"><div className="section-head"><div><div className="eyebrow">YOUR PORTFOLIO</div><h2>Recent organizations</h2></div><button className="text-button" onClick={() => onNavigate('organizations')}>View all <ArrowRight size={15} /></button></div>
        <OrganizationTable organizations={organizations.slice(0, 4)} onOpen={onOpen} />
      </section>
      <div className="bottom-insight"><div className="insight-icon"><Sparkles size={18} /></div><div><strong>One shared platform. Every team in its own rhythm.</strong><p>Manage a shared menu library, then tailor each workspace’s navigation and identity.</p></div><button className="text-button" onClick={() => onNavigate('menu-library')}>Menu library <ArrowRight size={15} /></button></div>
    </>
  )
}

function Metric({ label, value, detail, icon: Icon, tone }) {
  return <div className="metric"><div className={`metric-icon tone-${tone}`}><Icon size={17} /></div><span className="metric-label">{label}</span><strong>{value}</strong><span className="metric-detail">{detail}</span></div>
}

function OrganizationsPage({ organizations, onAdd, onOpen }) {
  const [showForm, setShowForm] = useState(false)
  const [query, setQuery] = useState('')
  const filteredOrganizations = organizations.filter((organization) => organization.name.toLowerCase().includes(query.toLowerCase()))
  return (
    <>
      <div className="page-heading compact-heading"><div><div className="eyebrow"><span className="eyebrow-line" />PLATFORM / DIRECTORY</div><h1>Organizations</h1><p className="heading-copy">Every team gets one shared home, with its own identity and access.</p></div><button className="primary-button" onClick={() => setShowForm(true)}><Plus size={17} />New organization</button></div>
      <div className="table-toolbar"><div className="table-summary"><strong>{organizations.length}</strong> workspaces <span className="summary-separator">·</span> <span>{organizations.filter((organization) => organization.status === 'active').length} active</span></div><label className="search-field"><Search size={15} /><input placeholder="Search organizations" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
      <OrganizationTable organizations={filteredOrganizations} onOpen={onOpen} />
      {showForm && <NewOrganizationModal onClose={() => setShowForm(false)} onSave={async (form) => { await onAdd(form); setShowForm(false) }} />}
    </>
  )
}

function OrganizationTable({ organizations, onOpen }) {
  return (
    <div className="org-table-wrap"><table className="org-table"><thead><tr><th>ORGANIZATION</th><th>FOLDER</th><th>PEOPLE</th><th>STATUS</th><th /></tr></thead><tbody>
      {organizations.map((organization) => <tr key={organization.id} data-org-name={organization.name.toLowerCase()}>
        <td><div className="org-name-cell"><OrgMark organization={organization} /><div><strong>{organization.name}</strong><span>{organization.tagline || 'Organization workspace'}</span></div></div></td>
        <td><code className="folder-code">app/{organization.folderName}</code></td>
        <td><span className="people-count"><Users size={14} />{organization.userCount}</span></td>
        <td><span className={`status-pill status-${organization.status}`}><i />{organization.status}</span></td>
        <td><button className="open-link" onClick={() => onOpen(organization)}>Open <ArrowUpRight size={14} /></button></td>
      </tr>)}
      {organizations.length === 0 && <tr><td colSpan="5" className="empty-state">No organizations yet. Add the first workspace to get started.</td></tr>}
    </tbody></table></div>
  )
}

function OrgMark({ organization }) {
  return organization.logoUrl
    ? <img className="org-mark org-mark-image" src={organization.logoUrl} alt="" />
    : <span className="org-mark" style={{ '--mark-primary': organization.primaryColor }}>{initials(organization.name)}</span>
}

function NewOrganizationModal({ onClose, onSave }) {
  const [name, setName] = useState('')
  const [folderName, setFolderName] = useState('')
  const [tagline, setTagline] = useState('')
  const [adminName, setAdminName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  function updateName(value) {
    setName(value)
    setFolderName(value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try { await onSave({ name, folderName, tagline, adminName, adminEmail, adminPassword }) } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-org-title"><div className="modal-head"><div><div className="eyebrow">NEW WORKSPACE</div><h2 id="new-org-title">Add an organization</h2></div><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={18} /></button></div><form onSubmit={submit}><label>Organization name<input value={name} onChange={(event) => updateName(event.target.value)} placeholder="e.g. Juniper Works" required maxLength="80" /></label><label>Folder name<span className="input-hint">Created under app/</span><div className="folder-input"><span>app/</span><input value={folderName} onChange={(event) => setFolderName(event.target.value.toLowerCase())} required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" /></div></label><label>Short description<input value={tagline} onChange={(event) => setTagline(event.target.value)} placeholder="A line for the workspace welcome" maxLength="140" /></label><div className="modal-section-label">FIRST ORGANIZATION ADMIN</div><label>Admin name<input value={adminName} onChange={(event) => setAdminName(event.target.value)} required maxLength="80" /></label><label>Admin email<input type="email" value={adminEmail} onChange={(event) => setAdminEmail(event.target.value)} required maxLength="254" /></label><label>Temporary password <span className="input-hint">At least 12 characters</span><input type="password" value={adminPassword} onChange={(event) => setAdminPassword(event.target.value)} required minLength="12" maxLength="200" autoComplete="new-password" /></label>{error && <p className="form-error">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" disabled={saving}>{saving ? 'Creating…' : 'Create workspace'}<ArrowRight size={15} /></button></div></form></section></div>
}

function MenuLibraryPage({ menuItems, onAdd }) {
  const [title, setTitle] = useState('')
  const [key, setKey] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  function setMenuTitle(value) {
    setTitle(value)
    setKey(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
  }
  async function submit(event) {
    event.preventDefault()
    setSaving(true)
    setError('')
    try { await onAdd({ title, key, description }) ; setTitle(''); setKey(''); setDescription('') } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow"><span className="eyebrow-line" />PLATFORM / SHARED NAVIGATION</div><h1>Menu library</h1><p className="heading-copy">Build a common set of destinations. Each organization decides what its people see.</p></div><div className="catalog-count"><span>{String(menuItems.length).padStart(2, '0')}</span> destinations</div></div>
    <div className="library-layout"><section className="library-list"><div className="library-list-head"><span>AVAILABLE DESTINATIONS</span><span>{menuItems.length} ITEMS</span></div>{menuItems.map((item, index) => { const Icon = iconByName[item.icon] || Grid2X2; return <div className="library-row" key={item.id}><span className="library-index">{String(index + 1).padStart(2, '0')}</span><span className="library-icon"><Icon size={17} /></span><div className="library-copy"><strong>{item.title}</strong><span>{item.description || 'No description provided.'}</span></div><code>/{item.key}</code><span className="library-available"><i />AVAILABLE</span></div> })}</section>
      <form className="add-menu-panel" onSubmit={submit}><div className="eyebrow">EXPAND THE PLATFORM</div><h2>Add a destination</h2><p>New destinations become available to every organization admin.</p><label>Menu label<input value={title} onChange={(event) => setMenuTitle(event.target.value)} placeholder="e.g. Calendar" required maxLength="40" /></label><label>Route key<div className="route-input"><span>/</span><input value={key} onChange={(event) => setKey(event.target.value.toLowerCase())} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" required /></div></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this space for?" maxLength="140" /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button full-button" disabled={saving}>{saving ? 'Adding…' : 'Add to library'}<Plus size={15} /></button><div className="panel-note"><ShieldCheck size={15} />Organization admins control role visibility.</div></form>
    </div>
  </>
}

function WorkspaceSettings({ organization, menuSettings, onSaveBranding, onSaveMenus }) {
  const [branding, setBranding] = useState({ name: organization.name, tagline: organization.tagline, primaryColor: organization.primaryColor, accentColor: organization.accentColor, logoUrl: organization.logoUrl || '' })
  const [settings, setSettings] = useState(menuSettings.map((item) => ({ ...item })))
  const [savingBranding, setSavingBranding] = useState(false)
  const [savingMenus, setSavingMenus] = useState(false)
  const [error, setError] = useState('')
  function updateSetting(id, changes) {
    setSettings((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item))
  }
  async function saveAppearance(event) {
    event.preventDefault()
    setSavingBranding(true)
    setError('')
    try { await onSaveBranding(branding) } catch (saveError) { setError(saveError.message) } finally { setSavingBranding(false) }
  }
  async function saveNavigation() {
    setSavingMenus(true)
    setError('')
    try { await onSaveMenus(settings) } catch (saveError) { setError(saveError.message) } finally { setSavingMenus(false) }
  }
  return <>
    <div className="page-heading compact-heading"><div><div className="eyebrow"><span className="eyebrow-line" />WORKSPACE / CONFIGURATION</div><h1>Make it yours.</h1><p className="heading-copy">Set the tone, then shape how each role finds their way around.</p></div><div className="settings-org-mark"><OrgMark organization={{ ...organization, ...branding }} /><span>{organization.folderName}</span></div></div>
    {error && <div className="form-error settings-error">{error}</div>}
    <div className="settings-grid"><form className="settings-panel appearance-panel" onSubmit={saveAppearance}><div className="settings-panel-head"><span className="settings-number">01</span><div><h2>Workspace identity</h2><p>Name, welcome, and signature colors.</p></div><Sparkles size={18} /></div><div className="brand-preview" style={{ '--preview-primary': branding.primaryColor, '--preview-accent': branding.accentColor }}><span className="preview-monogram">{initials(branding.name || organization.name)}</span><div><strong>{branding.name || 'Organization name'}</strong><span>{branding.tagline || 'A line that welcomes your people.'}</span></div><span className="preview-dot" /></div><label>Organization name<input value={branding.name} onChange={(event) => setBranding({ ...branding, name: event.target.value })} required maxLength="80" /></label><label>Welcome line<input value={branding.tagline} onChange={(event) => setBranding({ ...branding, tagline: event.target.value })} maxLength="140" /></label><label>Logo image URL <span className="input-hint">Optional</span><input type="url" value={branding.logoUrl} onChange={(event) => setBranding({ ...branding, logoUrl: event.target.value })} placeholder="https://…" /></label><div className="color-fields"><label>Primary color<span className="color-input"><input type="color" value={branding.primaryColor} onChange={(event) => setBranding({ ...branding, primaryColor: event.target.value })} /><code>{branding.primaryColor}</code></span></label><label>Accent color<span className="color-input"><input type="color" value={branding.accentColor} onChange={(event) => setBranding({ ...branding, accentColor: event.target.value })} /><code>{branding.accentColor}</code></span></label></div><button className="primary-button full-button" disabled={savingBranding}>{savingBranding ? 'Saving…' : 'Save identity'}<Check size={15} /></button></form>
      <section className="settings-panel navigation-panel"><div className="settings-panel-head"><span className="settings-number">02</span><div><h2>Workspace navigation</h2><p>Decide who sees each destination.</p></div><MenuIcon size={18} /></div><div className="role-key"><span>DESTINATION</span><span>ON</span><span>ADMIN</span><span>MEMBER</span></div>{settings.map((item) => { const Icon = iconByName[item.icon] || Grid2X2; return <div className={`permission-row ${item.enabled ? '' : 'permission-disabled'}`} key={item.id}><span className="permission-title"><span className="permission-icon"><Icon size={15} /></span><span>{item.title}</span></span><label className="switch-control" aria-label={`${item.title} enabled`}><input type="checkbox" checked={Boolean(item.enabled)} onChange={(event) => updateSetting(item.id, { enabled: event.target.checked })} /><span /></label><label className="permission-check"><input type="checkbox" disabled={!item.enabled} checked={Boolean(item.showOrgAdmin)} onChange={(event) => updateSetting(item.id, { showOrgAdmin: event.target.checked })} aria-label={`${item.title} visible to admins`} /></label><label className="permission-check"><input type="checkbox" disabled={!item.enabled} checked={Boolean(item.showOrgUser)} onChange={(event) => updateSetting(item.id, { showOrgUser: event.target.checked })} aria-label={`${item.title} visible to members`} /></label></div> })}<div className="permission-footer"><div><strong>Role-based access</strong><span>Changes apply to every account in this workspace.</span></div><button className="primary-button" onClick={saveNavigation} disabled={savingMenus}>{savingMenus ? 'Saving…' : 'Save navigation'}<Check size={15} /></button></div></section></div>
  </>
}

function WorkspacePage({ organization, menus, section, user }) {
  const currentMenu = menus.find((menu) => menu.key === section)
  const isOverview = section === 'overview' || !currentMenu
  const greeting = getGreeting()
  return <>
    <div className="workspace-welcome" style={{ '--welcome-primary': organization?.primaryColor || '#244b42', '--welcome-accent': organization?.accentColor || '#d58c64' }}><div className="welcome-copy"><div className="eyebrow"><span className="eyebrow-line" />{organization?.name || 'YOUR WORKSPACE'}</div><h1>{isOverview ? `${greeting}, ${user.name.split(' ')[0]}.` : currentMenu?.label}</h1><p>{isOverview ? organization?.tagline || 'A considered space for better work.' : currentMenu?.description}</p><div className="welcome-actions"><button className="light-button" onClick={() => window.alert('Your workspace is ready for your next project.')}>Explore workspace<ArrowRight size={15} /></button><span><i />PRIVATE TEAM SPACE</span></div></div><div className="welcome-art"><div className="art-ring ring-one" /><div className="art-ring ring-two" /><div className="art-center"><OrgMark organization={organization || { name: 'FN', primaryColor: '#244b42' }} /></div><span className="art-index">WORKSPACE N° {String(organization?.id || 1).padStart(2, '0')}</span></div><span className="welcome-watermark">{organization?.name?.split(' ')[0] || 'WORK'}</span></div>
    <div className="workspace-overview-head"><div><div className="eyebrow">YOUR TEAM, IN GOOD FLOW</div><h2>{isOverview ? 'A little room to do great things.' : `Inside ${currentMenu?.label.toLowerCase()}.`}</h2></div><button className="period-button">This week <ChevronDown size={14} /></button></div>
    <div className="workspace-metrics"><Metric label="Active projects" value="08" detail="2 moving this week" icon={FolderKanban} tone="sage" /><Metric label="Shared files" value="24" detail="Updated across your team" icon={FileText} tone="ochre" /><Metric label="Team members" value="12" detail="Across 3 project groups" icon={Users} tone="blue" /></div>
    <div className="workspace-columns"><section className="activity-panel"><div className="section-head"><div><div className="eyebrow">RECENT MOVEMENT</div><h2>Team activity</h2></div><button className="icon-button" aria-label="More activity"><ArrowUpRight size={16} /></button></div><ActivityRow initialsText="ML" person="Morgan Lee" action="shared a new project brief" time="12 min ago" tone="activity-sage" /><ActivityRow initialsText="JR" person="Jamie Reed" action="updated the launch timeline" time="1 hour ago" tone="activity-orange" /><ActivityRow initialsText="AK" person="Avery Kim" action="added 3 files to Resources" time="Yesterday" tone="activity-blue" /><ActivityRow initialsText="+4" person="Your team" action="has been active this week" time="View all" tone="activity-neutral" /></section><aside className="focus-panel"><div className="focus-top"><span>THE WEEK AHEAD</span><ArrowUpRight size={15} /></div><div className="focus-number">03<span> things in focus</span></div><div className="focus-line"><span className="focus-mark mark-one" /><div><strong>Studio launch</strong><span>Milestone · Thursday</span></div><ArrowDownRight size={15} /></div><div className="focus-line"><span className="focus-mark mark-two" /><div><strong>Monthly review</strong><span>Team moment · Friday</span></div><ArrowRight size={15} /></div><div className="focus-foot"><span>MAKE THE WEEK COUNT</span><div className="focus-bars"><i /><i /><i /><i /><i /><i /><i /></div></div></aside></div>
  </>
}

function ActivityRow({ initialsText, person, action, time, tone }) {
  return <div className="activity-row"><span className={`activity-avatar ${tone}`}>{initialsText}</span><div className="activity-copy"><strong>{person}</strong><span>{action}</span></div><span className="activity-time">{time}</span></div>
}

function initials(value = '') {
  return value.split(/\s|&/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
}

function roleLabel(role) {
  return ({ platform_admin: 'Platform admin', org_admin: 'Organization admin', org_user: 'Organization member' })[role] || role
}

function sectionTitle(section) {
  return section.replaceAll('-', ' ').replace(/\b\w/g, (character) => character.toUpperCase())
}

function getGreeting() {
  const hour = new Date().getHours()
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

export default App
