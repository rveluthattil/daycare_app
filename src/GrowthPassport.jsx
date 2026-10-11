import { useEffect, useState } from 'react'
import { ArrowRight, CalendarDays, Check, ClipboardList, Plus, Save, Sprout, Trash2, Users } from 'lucide-react'
import './GrowthPassport.css'

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  })
  const result = response.status === 204 ? null : await response.json()
  if (!response.ok) throw new Error(result?.error || 'Something went wrong.')
  return result
}

function toggleFoodPreference(sectionId, itemId) {
  setDailyPreferences((current) => {
    const section = current[sectionId] || { note: '', hoursByItem: {}, selectedByItem: {} }
    return {
      ...current,
      [sectionId]: {
        ...section,
        selectedByItem: {
          ...section.selectedByItem,
          [itemId]: !section.selectedByItem?.[itemId],
        },
      },
    }
  })
}

function today() {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function emptyStudent() {
  return {
    firstName: '',
    middleName: '',
    lastName: '',
    dateOfBirth: '',
    address: '',
    sex: '',
    parentStatus: '',
    fatherFirstName: '',
    fatherLastName: '',
    fatherMiddleName: '',
    motherFirstName: '',
    motherLastName: '',
    motherMiddleName: '',
    guardianFirstName: '',
    guardianLastName: '',
    guardianMiddleName: '',
    sleepMorningHours: '',
    sleepNoonHours: '',
    sleepNightHours: '',
    preferenceOptionIds: [],
    active: true,
  }
}

function GrowthPassport() {
  const [catalog, setCatalog] = useState({ preferenceOptions: [], sections: [] })
  const [students, setStudents] = useState([])
  const [selectedStudentId, setSelectedStudentId] = useState('')
  const [previousStudentId, setPreviousStudentId] = useState('')
  const [student, setStudent] = useState(null)
  const [draft, setDraft] = useState(emptyStudent)
  const [isEditing, setIsEditing] = useState(false)
  const [logDate, setLogDate] = useState(today)
  const [dailyPreferences, setDailyPreferences] = useState({})
  const [loading, setLoading] = useState(true)
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingLog, setSavingLog] = useState(false)
  const [deletingStudent, setDeletingStudent] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    let current = true
    Promise.all([api('/growth-passport/catalog'), api('/growth-passport/students')])
      .then(([nextCatalog, result]) => {
        if (!current) return
        setCatalog(nextCatalog)
        setStudents(result.students)
        if (result.students.length > 0) setSelectedStudentId(String(result.students[0].id))
      })
      .catch((loadError) => { if (current) setError(loadError.message) })
      .finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [])

  useEffect(() => {
    if (!selectedStudentId) return undefined
    let current = true
    Promise.all([
      api(`/growth-passport/students/${selectedStudentId}`),
      api(`/growth-passport/students/${selectedStudentId}/logs/${logDate}`),
    ])
      .then(([studentResult, log]) => {
        if (!current) return
        setStudent(studentResult.student)
        setDailyPreferences(Object.fromEntries(log.sections.map((section) => [
          section.sectionId,
          {
            note: section.note,
            hoursByItem: Object.fromEntries(section.items.map((item) => [
              item.itemId,
              item.hours == null ? '' : String(item.hours),
            ])),
            selectedByItem: Object.fromEntries(section.items.map((item) => [
              item.itemId,
              Boolean(item.selected),
            ])),
          },
        ])))
      })
      .catch((loadError) => { if (current) setError(loadError.message) })
    return () => { current = false }
  }, [selectedStudentId, logDate])

  function startNewStudent() {
    setPreviousStudentId(selectedStudentId)
    setSelectedStudentId('')
    setStudent(null)
    setDraft(emptyStudent())
    setIsEditing(true)
    setError('')
    setNotice('')
  }

  function cancelProfileForm() {
    if (!selectedStudentId && previousStudentId) {
      setSelectedStudentId(previousStudentId)
    }
    setPreviousStudentId('')
    setIsEditing(false)
    setError('')
    setNotice('')
  }

  function startEditing() {
    setDraft({
      ...emptyStudent(),
      ...student,
      preferenceOptionIds: student.preferenceOptionIds || [],
    })
    setIsEditing(true)
    setError('')
    setNotice('')
  }

  function updateDraft(field, value) {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  async function saveStudent(event) {
    event.preventDefault()
    setSavingProfile(true)
    setError('')
    setNotice('')
    const body = draft
    try {
      const result = selectedStudentId
        ? await api(`/growth-passport/students/${selectedStudentId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          })
        : await api('/growth-passport/students', {
            method: 'POST',
            body: JSON.stringify(body),
          })
      const refreshed = await api('/growth-passport/students')
      setStudents(refreshed.students)
      setSelectedStudentId(String(result.student.id))
      setPreviousStudentId('')
      setStudent(result.student)
      setIsEditing(false)
      setNotice('Student profile saved.')
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSavingProfile(false)
    }
  }

  function toggleStudentPreference(preferenceOptionId) {
    setDraft((current) => {
      const preferenceOptionIds = current.preferenceOptionIds.includes(preferenceOptionId)
        ? current.preferenceOptionIds.filter((id) => id !== preferenceOptionId)
        : [...current.preferenceOptionIds, preferenceOptionId]
      return { ...current, preferenceOptionIds }
    })
  }

  function updateSectionNote(sectionId, note) {
    setDailyPreferences((current) => ({
      ...current,
      [sectionId]: { ...(current[sectionId] || { hoursByItem: {} }), note },
    }))
  }

  function updateItemHours(sectionId, itemId, hours) {
    setDailyPreferences((current) => {
      const section = current[sectionId] || { note: '', hoursByItem: {} }
      return {
        ...current,
        [sectionId]: {
          ...section,
          hoursByItem: { ...section.hoursByItem, [itemId]: hours },
        },
      }
    })
  }

  async function deleteStudent() {
    setDeletingStudent(true)
    setError('')
    setNotice('')
    try {
      await api(`/growth-passport/students/${selectedStudentId}`, { method: 'DELETE' })
      const refreshed = await api('/growth-passport/students')
      setStudents(refreshed.students)
      setStudent(null)
      setDailyPreferences({})
      setSelectedStudentId(refreshed.students.length ? String(refreshed.students[0].id) : '')
      setConfirmDelete(false)
      setNotice('Student profile and its daily records were deleted.')
    } catch (deleteError) {
      setError(deleteError.message)
      setConfirmDelete(false)
    } finally {
      setDeletingStudent(false)
    }
  }

  async function saveDailyPreferences(event) {
    event.preventDefault()
    setSavingLog(true)
    setError('')
    setNotice('')
    try {
      await api(`/growth-passport/students/${selectedStudentId}/logs/${logDate}`, {
        method: 'PUT',
        body: JSON.stringify({
          sections: catalog.sections.map((section) => ({
            sectionId: section.id,
            note: dailyPreferences[section.id]?.note || '',
            items: section.items.map((item) => ({
              itemId: item.id,
              hours: section.key === 'food-preferences'
                ? null
                : dailyPreferences[section.id]?.hoursByItem?.[item.id] || null,
              selected: section.key === 'food-preferences'
                ? Boolean(dailyPreferences[section.id]?.selectedByItem?.[item.id])
                : null,
            })),
          })),
        }),
      })
      setNotice(`Daily preferences saved for ${logDate}.`)
    } catch (saveError) {
      setError(saveError.message)
    } finally {
      setSavingLog(false)
    }
  }

  return (
    <div className="growth-passport">
      <header className="growth-heading">
        <div>
          <div className="growth-eyebrow"><Sprout size={14} /> STUDENT WELLBEING</div>
          <h1>Growth Passport</h1>
          <p>A thoughtful, day-by-day picture of every student's needs and preferences.</p>
        </div>
        <div className="growth-heading-mark"><Sprout size={22} /></div>
      </header>

      {error && <div className="growth-alert growth-alert-error" role="alert">{error}</div>}
      {notice && <div className="growth-alert growth-alert-success" role="status"><Check size={15} />{notice}</div>}
      {loading ? (
        <div className="growth-loading">Loading student profiles and preference lists…</div>
      ) : (
        <>
          <section className="growth-student-toolbar">
            <div className="growth-student-picker">
              <span className="growth-icon-tile"><Users size={18} /></span>
              <label>
                <span>STUDENT PROFILE</span>
                <select value={selectedStudentId} onChange={(event) => {
                  setSelectedStudentId(event.target.value)
                  setStudent(null)
                  setDailyPreferences({})
                  setIsEditing(false)
                  setError('')
                  setNotice('')
                }}>
                  <option value="">Choose a student</option>
                  {students.map((entry) => (
                    <option key={entry.id} value={entry.id}>{[entry.firstName, entry.middleName, entry.lastName].filter(Boolean).join(' ')} · {entry.studentId}{entry.active ? '' : ' · Inactive'}</option>
                  ))}
                </select>
              </label>
            </div>
            <button className="growth-button growth-button-primary" type="button" onClick={startNewStudent}>
              <Plus size={16} /> New student
            </button>
          </section>

          {isEditing ? (
            <section className="growth-card growth-profile-card">
              <div className="growth-card-heading">
                <div><span className="growth-card-kicker">STUDENT INFORMATION</span><h2>{selectedStudentId ? 'Edit profile' : 'Create a student profile'}</h2></div>
                <button className="growth-button growth-button-secondary" type="button" onClick={cancelProfileForm}>Cancel</button>
              </div>
              <form className="growth-profile-form" onSubmit={saveStudent}>
                <div className="growth-fields">
                  <label>First name<input value={draft.firstName} onChange={(event) => updateDraft('firstName', event.target.value)} maxLength="80" required /></label>
                  <label>Middle name (optional)<input value={draft.middleName} onChange={(event) => updateDraft('middleName', event.target.value)} maxLength="80" /></label>
                  <label>Last name<input value={draft.lastName} onChange={(event) => updateDraft('lastName', event.target.value)} maxLength="80" required /></label>
                  <label>Date of birth<input type="date" value={draft.dateOfBirth} max={today()} onChange={(event) => updateDraft('dateOfBirth', event.target.value)} required /></label>
                  <label>Sex<select value={draft.sex} onChange={(event) => updateDraft('sex', event.target.value)}><option value="">Select sex</option><option>Female</option><option>Male</option><option>Other</option><option>Prefer not to say</option></select></label>
                  <label>Parent status<select value={draft.parentStatus} onChange={(event) => updateDraft('parentStatus', event.target.value)}><option value="">Select status</option><option>Single</option><option>Married</option></select></label>
                  <div className="growth-name-group">
                    <span>Father's name</span>
                    <div className="growth-name-fields">
                      <label>First name<input value={draft.fatherFirstName} onChange={(event) => updateDraft('fatherFirstName', event.target.value)} maxLength="120" /></label>
                      <label>Last name<input value={draft.fatherLastName} onChange={(event) => updateDraft('fatherLastName', event.target.value)} maxLength="120" /></label>
                      <label>Middle name<input value={draft.fatherMiddleName} onChange={(event) => updateDraft('fatherMiddleName', event.target.value)} maxLength="120" /></label>
                    </div>
                  </div>
                  <div className="growth-name-group">
                    <span>Mother's name</span>
                    <div className="growth-name-fields">
                      <label>First name<input value={draft.motherFirstName} onChange={(event) => updateDraft('motherFirstName', event.target.value)} maxLength="120" /></label>
                      <label>Last name<input value={draft.motherLastName} onChange={(event) => updateDraft('motherLastName', event.target.value)} maxLength="120" /></label>
                      <label>Middle name<input value={draft.motherMiddleName} onChange={(event) => updateDraft('motherMiddleName', event.target.value)} maxLength="120" /></label>
                    </div>
                  </div>
                  <div className="growth-name-group">
                    <span>Guardian name</span>
                    <div className="growth-name-fields">
                      <label>First name<input value={draft.guardianFirstName} onChange={(event) => updateDraft('guardianFirstName', event.target.value)} maxLength="120" /></label>
                      <label>Last name<input value={draft.guardianLastName} onChange={(event) => updateDraft('guardianLastName', event.target.value)} maxLength="120" /></label>
                      <label>Middle name<input value={draft.guardianMiddleName} onChange={(event) => updateDraft('guardianMiddleName', event.target.value)} maxLength="120" /></label>
                    </div>
                  </div>
                  <fieldset className="growth-preference-field growth-sleep-profile-field">
                    <legend>Daily sleep time <span>Hours per part of the day</span></legend>
                    <div className="growth-name-fields">
                      <label>Morning (In hrs.)<input type="number" min="0" max="24" step="0.25" value={draft.sleepMorningHours ?? ''} onChange={(event) => updateDraft('sleepMorningHours', event.target.value)} /></label>
                      <label>Noon (In hrs.)<input type="number" min="0" max="24" step="0.25" value={draft.sleepNoonHours ?? ''} onChange={(event) => updateDraft('sleepNoonHours', event.target.value)} /></label>
                      <label>Night (In hrs.)<input type="number" min="0" max="24" step="0.25" value={draft.sleepNightHours ?? ''} onChange={(event) => updateDraft('sleepNightHours', event.target.value)} /></label>
                    </div>
                  </fieldset>
                  <fieldset className="growth-preference-field">
                    <legend>Student preferences <span>Select all that apply</span></legend>
                    <div className="growth-profile-preferences">
                      {catalog.preferenceOptions.map((option) => (
                        <label className="growth-choice" key={option.id}>
                          <input
                            type="checkbox"
                            checked={draft.preferenceOptionIds.includes(option.id)}
                            onChange={() => toggleStudentPreference(option.id)}
                          />
                          <span className="growth-checkmark"><Check size={12} /></span>
                          <span>{option.label}</span>
                        </label>
                      ))}
                      {catalog.preferenceOptions.length === 0 && <span className="growth-no-options">No preferences are available yet.</span>}
                    </div>
                  </fieldset>
                  <label className="growth-active-field">
                    <input type="checkbox" checked={draft.active} onChange={(event) => updateDraft('active', event.target.checked)} />
                    <span className="growth-checkmark"><Check size={12} /></span>
                    <span><strong>Active</strong><small>Inactive profiles remain saved but are marked in the student list.</small></span>
                  </label>
                  <label className="growth-address-field">Full address<textarea value={draft.address} onChange={(event) => updateDraft('address', event.target.value)} rows="3" maxLength="1000" /></label>
                </div>
                <div className="growth-form-footer"><span>A student ID is assigned automatically when the profile is saved. Name and date of birth are required.</span><button className="growth-button growth-button-primary" type="submit" disabled={savingProfile}><Save size={15} />{savingProfile ? 'Saving…' : 'Save profile'}</button></div>
              </form>
            </section>
          ) : student ? (
            <section className="growth-card growth-profile-summary">
              <div className="growth-summary-identity">
                <span className="growth-avatar">{student.firstName.charAt(0)}{student.lastName.charAt(0)}</span>
                <div><span className="growth-card-kicker">STUDENT PROFILE</span><h2>{[student.firstName, student.middleName, student.lastName].filter(Boolean).join(' ')}</h2><span className="growth-student-id">ID {student.studentId}</span></div>
                <span className={`growth-active-badge ${student.active ? 'growth-active' : 'growth-inactive'}`}>{student.active ? 'Active' : 'Inactive'}</span>
              </div>
              <div className="growth-summary-details">
                <div><span>Date of birth</span><strong>{student.dateOfBirth}</strong></div>
                <div><span>Sex</span><strong>{student.sex || 'Not specified'}</strong></div>
                <div><span>Parent status</span><strong>{student.parentStatus || 'Not specified'}</strong></div>
                <div><span>Preferences</span><strong>{student.preferences.length ? student.preferences.join(', ') : 'Not specified'}</strong></div>
                <div className="growth-summary-address"><span>Full address</span><strong>{student.address || 'Not specified'}</strong></div>
                <div><span>Father</span><strong>{[student.fatherFirstName, student.fatherMiddleName, student.fatherLastName].filter(Boolean).join(' ') || 'Not specified'}</strong></div>
                <div><span>Mother</span><strong>{[student.motherFirstName, student.motherMiddleName, student.motherLastName].filter(Boolean).join(' ') || 'Not specified'}</strong></div>
                <div><span>Guardian</span><strong>{[student.guardianFirstName, student.guardianMiddleName, student.guardianLastName].filter(Boolean).join(' ') || 'Not specified'}</strong></div>
                <div><span>Morning sleep (hrs.)</span><strong>{student.sleepMorningHours ?? 'Not specified'}</strong></div>
                <div><span>Noon sleep (hrs.)</span><strong>{student.sleepNoonHours ?? 'Not specified'}</strong></div>
                <div><span>Night sleep (hrs.)</span><strong>{student.sleepNightHours ?? 'Not specified'}</strong></div>
              </div>
              <div className="growth-profile-actions">
                <button className="growth-button growth-button-secondary" type="button" onClick={startEditing}>Edit profile <ArrowRight size={14} /></button>
                <button className="growth-button growth-button-danger" type="button" onClick={() => setConfirmDelete(true)}><Trash2 size={14} /> Delete student</button>
              </div>
            </section>
          ) : (
            <section className="growth-empty">
              <span className="growth-icon-tile"><Users size={19} /></span>
              <h2>No student selected</h2>
              <p>Create a student profile to begin recording their daily preferences.</p>
              <button className="growth-button growth-button-primary" type="button" onClick={startNewStudent}><Plus size={16} /> Create student profile</button>
            </section>
          )}

          {student && !isEditing && (
            <section className="growth-daily">
              <div className="growth-daily-heading">
                <div><div className="growth-card-kicker"><ClipboardList size={13} /> DAILY OBSERVATIONS</div><h2>Preferences &amp; wellbeing</h2><p>Record the number of hours spent on each activity and add notes for the day.</p></div>
                <label className="growth-date-picker"><CalendarDays size={16} /><span>RECORD DATE</span><input type="date" value={logDate} max={today()} onChange={(event) => setLogDate(event.target.value)} /></label>
              </div>
              <form onSubmit={saveDailyPreferences}>
                <div className="growth-section-grid">
                  {catalog.sections.map((section, index) => {
                    const dailySection = dailyPreferences[section.id] || { note: '', hoursByItem: {}, selectedByItem: {} }
                    return (
                      <article className="growth-card growth-preference-card" key={section.id}>
                        <div className="growth-preference-heading"><span className="growth-section-number">{String(index + 1).padStart(2, '0')}</span><div><h3>{section.title}</h3><p>{section.description}</p></div></div>
                        {section.key === 'food-preferences' ? (
                          <div className="growth-choice-list">
                            {section.items.map((item) => (
                              <label className="growth-choice" key={item.id}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(dailySection.selectedByItem[item.id])}
                                  onChange={() => toggleFoodPreference(section.id, item.id)}
                                />
                                <span className="growth-checkmark"><Check size={12} /></span>
                                <span>{item.label}</span>
                              </label>
                            ))}
                          </div>
                        ) : (
                          <div className="growth-hour-list">
                            {section.items.map((item) => (
                              <label className="growth-hour-field" key={item.id}>
                                <span>{item.label} (In hrs.)</span>
                                <input
                                  aria-label={`${item.label} (in hours)`}
                                  type="number"
                                  min="0"
                                  max="24"
                                  step="0.25"
                                  value={dailySection.hoursByItem[item.id] ?? ''}
                                  onChange={(event) => updateItemHours(section.id, item.id, event.target.value)}
                                />
                              </label>
                            ))}
                          </div>
                        )}
                        {section.items.length === 0 && (
                          <span className="growth-no-options">No options are available for this section yet.</span>
                        )}
                        <label className="growth-note-label">DAILY NOTE<textarea value={dailySection.note} onChange={(event) => updateSectionNote(section.id, event.target.value)} rows="2" maxLength="1000" placeholder="Add a note for today…" /></label>
                      </article>
                    )
                  })}
                </div>
                <div className="growth-save-row"><span>Daily records can be edited by choosing a date.</span><button className="growth-button growth-button-primary" type="submit" disabled={savingLog}><Save size={15} />{savingLog ? 'Saving…' : 'Save daily record'}</button></div>
              </form>
            </section>
          )}
          {confirmDelete && (
            <div className="growth-delete-backdrop" role="presentation">
              <section className="growth-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="growth-delete-title" aria-describedby="growth-delete-description">
                <span className="growth-delete-icon"><Trash2 size={19} /></span>
                <h2 id="growth-delete-title">Delete this student?</h2>
                <p id="growth-delete-description">This permanently deletes {student?.firstName} {student?.lastName}'s profile and all of their daily records. This cannot be undone.</p>
                <div className="growth-delete-actions">
                  <button className="growth-button growth-button-secondary" type="button" disabled={deletingStudent} onClick={() => setConfirmDelete(false)}>Cancel</button>
                  <button className="growth-button growth-button-danger" type="button" disabled={deletingStudent} onClick={deleteStudent}><Trash2 size={14} />{deletingStudent ? 'Deleting…' : 'Delete student'}</button>
                </div>
              </section>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default GrowthPassport
