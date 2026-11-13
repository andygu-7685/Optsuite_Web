import { useEffect, useRef, useState } from 'react'
import { supabase } from './supabaseClient.js'
import { customOverlayStyle, parseOverlayStyle } from './overlayStyle.js'

const emptyProfile = {
  name: '', description: '', overlay_style: 'classic', flip_setting: 'auto',
}

export default function MicroscopeProfiles({ userId, selectedProfile, onSelect, disabled }) {
  const [profiles, setProfiles] = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState(emptyProfile)
  const [widthInput, setWidthInput] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const onSelectRef = useRef(onSelect)
  const formOverlay = parseOverlayStyle(form.overlay_style)

  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])

  useEffect(() => {
    if (!userId || !supabase) {
      return
    }
    let active = true
    supabase.from('microscope_profiles').select('*').eq('user_id', userId)
      .order('name').then(({ data, error: loadError }) => {
        if (!active) return
        if (loadError) setError(`Could not load profiles: ${loadError.message}`)
        else {
          setProfiles(data || [])
          onSelectRef.current(data?.[0] || null)
        }
        setLoading(false)
      })
    return () => { active = false }
  }, [userId])

  function startCreate() {
    setEditing('new')
    setForm({ ...emptyProfile, overlay_style: selectedProfile?.overlay_style || 'classic', flip_setting: selectedProfile?.flip_setting || 'auto' })
    setError('')
  }

  function startEdit() {
    if (!selectedProfile) return
    setEditing(selectedProfile.id)
    setForm({ ...selectedProfile, description: selectedProfile.description ?? '' })
    setError('')
  }

  async function save(event) {
    event.preventDefault()
    const name = form.name.trim()
    if (!name) { setError('Enter a profile name.'); return }
    setPending(true)
    setError('')
    const values = {
      name,
      description: form.description.trim(),
      overlay_style: form.overlay_style, flip_setting: form.flip_setting,
    }
    try {
      const query = editing === 'new'
        ? supabase.from('microscope_profiles').insert({ ...values, id: crypto.randomUUID(), user_id: userId })
        : supabase.from('microscope_profiles').update({ ...values, updated_at: new Date().toISOString() }).eq('id', editing).eq('user_id', userId)
      const { data, error: saveError } = await query.select('*').single()
      if (saveError) throw saveError
      setProfiles((current) => [...current.filter((profile) => profile.id !== data.id), data].sort((a, b) => a.name.localeCompare(b.name)))
      onSelect(data)
      setEditing(null)
    } catch (saveError) {
      setError(`Could not save profile: ${saveError.message || 'Please try again.'}`)
    } finally {
      setPending(false)
    }
  }

  return <section className="panel-section microscope-section">
    <h2>Microscope profile</h2>
    {!userId ? <p className="muted">Sign in to create a microscope profile and save reports.</p> : <>
      {loading ? <p className="muted">Loading profiles…</p> : <>
        <select aria-label="Microscope profile" value={selectedProfile?.id || ''} onChange={(event) => onSelect(profiles.find((profile) => profile.id === event.target.value) || null)} disabled={disabled || pending || !!editing}>
          <option value="">Choose a microscope</option>
          {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
        </select>
        {selectedProfile?.description && !editing && <p className="microscope-summary">{selectedProfile.description}</p>}
        {!editing && <div className="microscope-actions"><button type="button" onClick={startCreate} disabled={disabled}>New profile</button><button type="button" onClick={startEdit} disabled={disabled || !selectedProfile}>Edit</button></div>}
      </>}
      {editing && <form className="microscope-form" onSubmit={save}>
        <label>Name<input value={form.name} maxLength={100} required onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>Description <span className="microscope-character-count">{form.description.length}/100</span><textarea rows="3" maxLength={100} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label>Default scanline color<input type="color" value={formOverlay.color} onChange={(event) => setForm({ ...form, overlay_style: customOverlayStyle(event.target.value, formOverlay.width) })} /></label>
        <label>Default scanline width (px)<input type="number" min="1" max="20" step="1" value={widthInput?.style === form.overlay_style ? widthInput.value : String(formOverlay.width)} onChange={(event) => { const value = event.target.value; setWidthInput({ style: form.overlay_style, value }); const width = Number(value); if (value !== '' && Number.isInteger(width) && width >= 1 && width <= 20) setForm({ ...form, overlay_style: customOverlayStyle(formOverlay.color, width) }) }} onBlur={() => setWidthInput(null)} /></label>
        <label>Default flip setting<select value={form.flip_setting} onChange={(event) => setForm({ ...form, flip_setting: event.target.value })}><option value="auto">Auto</option><option value="yes">Yes</option><option value="no">No</option></select></label>
        <div className="microscope-actions"><button type="submit" disabled={pending}>{pending ? 'Saving…' : 'Save profile'}</button><button type="button" onClick={() => setEditing(null)} disabled={pending}>Cancel</button></div>
      </form>}
      {error && <p className="microscope-error" role="alert">{error}</p>}
    </>}
  </section>
}
