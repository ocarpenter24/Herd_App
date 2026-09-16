import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { TAGS } from './tags.js'

let buckCache = null

export default function PhotoViewer({ photo, camera, onClose, onPrev, onNext, onSaved }) {
  const [url, setUrl] = useState(null)
  const [tags, setTags] = useState(photo.tags || [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [bucks, setBucks] = useState(buckCache || [])
  const [assigned, setAssigned] = useState([]) // sighting rows
  const [pickerOpen, setPickerOpen] = useState(false)
  const [newBuck, setNewBuck] = useState('')

  useEffect(() => {
    setTags(photo.tags || [])
    setSaved(false)
    setUrl(null)
    setPickerOpen(false)
    supabase.storage
      .from('trail-photos')
      .createSignedUrl(photo.storage_path, 60 * 60)
      .then(({ data }) => setUrl(data?.signedUrl || null))
    supabase
      .from('buck_sightings')
      .select('id,buck_id')
      .eq('camera_id', photo.camera_id)
      .eq('photo_name', photo.photo_name)
      .then(({ data }) => setAssigned(data || []))
    if (!buckCache) {
      supabase
        .from('bucks')
        .select('id,name,status')
        .order('name')
        .then(({ data }) => {
          buckCache = data || []
          setBucks(buckCache)
        })
    }
  }, [photo])

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && onPrev) onPrev()
      if (e.key === 'ArrowRight' && onNext) onNext()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onPrev, onNext])

  function toggle(tag) {
    setSaved(false)
    setTags((t) => (t.includes(tag) ? t.filter((x) => x !== tag) : [...t, tag]))
  }

  async function save() {
    setSaving(true)
    const patch = { tags, reviewed: true }
    const { error } = await supabase
      .from('reveal_photos')
      .update(patch)
      .eq('photo_name', photo.photo_name)
      .eq('camera_id', photo.camera_id)
    setSaving(false)
    if (!error) {
      setSaved(true)
      onSaved({ photo_name: photo.photo_name, ...patch })
    }
  }

  async function assign(buckId) {
    const { data } = await supabase
      .from('buck_sightings')
      .insert({ buck_id: buckId, camera_id: photo.camera_id, photo_name: photo.photo_name })
      .select('id,buck_id')
      .single()
    if (data) setAssigned((a) => [...a, data])
  }

  async function unassign(sighting) {
    await supabase.from('buck_sightings').delete().eq('id', sighting.id)
    setAssigned((a) => a.filter((s) => s.id !== sighting.id))
  }

  async function createAndAssign(e) {
    e.preventDefault()
    const name = newBuck.trim()
    if (!name) return
    setNewBuck('')
    const { data } = await supabase.from('bucks').insert({ name }).select('id,name,status').single()
    if (data) {
      buckCache = [...(buckCache || []), data].sort((a, b) => a.name.localeCompare(b.name))
      setBucks(buckCache)
      assign(data.id)
    }
  }

  const assignedIds = new Set(assigned.map((s) => s.buck_id))
  const buckName = (id) => bucks.find((b) => b.id === id)?.name || '…'

  const when = photo.taken_at
    ? new Date(photo.taken_at).toLocaleString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : ''

  return (
    <div className="viewer">
      <div className="bar">
        <div>
          <div className="cam">
            {camera?.name || photo.camera_id}
            {camera?.shared ? ' ↗' : ''}
          </div>
          <div className="when">{when}</div>
        </div>
        <button className="close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <div className="imgwrap">
        {url ? <img src={url} alt="" /> : <div className="spinner">Loading…</div>}
        {onPrev && <button className="nav prev" onClick={onPrev} aria-label="Previous" />}
        {onNext && <button className="nav next" onClick={onNext} aria-label="Next" />}
      </div>

      <div className="meta">
        {photo.battery != null && <span>Battery {photo.battery}%</span>}
        {photo.signal != null && <span>Signal {photo.signal}</span>}
        {photo.reviewed && <span>Reviewed</span>}
      </div>

      <div className="tagpanel">
        <h3>What's in this photo</h3>
        <div className="tagrow">
          {TAGS.map((t) => (
            <button
              key={t}
              className={'tag' + (tags.includes(t) ? ' on' : '') + (t === 'Buck' ? ' buck' : '')}
              onClick={() => toggle(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="savebar">
          <button className="save" onClick={save} disabled={saving || saved}>
            {saved ? 'Saved' : saving ? 'Saving…' : 'Save tags'}
          </button>
          {saved && <span className="reviewed-note">Marked reviewed</span>}
        </div>

        <h3 className="assignhead">Bucks in this photo</h3>
        <div className="tagrow">
          {assigned.map((s) => (
            <button key={s.id} className="tag on buck" onClick={() => unassign(s)}>
              {buckName(s.buck_id)} ✕
            </button>
          ))}
          <button className="tag" onClick={() => setPickerOpen(!pickerOpen)}>
            {pickerOpen ? 'Close' : '+ Assign'}
          </button>
        </div>
        {pickerOpen && (
          <div className="picker">
            {bucks
              .filter((b) => !assignedIds.has(b.id))
              .map((b) => (
                <button key={b.id} className="tag" onClick={() => assign(b.id)}>
                  {b.name}
                </button>
              ))}
            <form className="newbuck" onSubmit={createAndAssign}>
              <input
                placeholder="New buck name…"
                value={newBuck}
                onChange={(e) => setNewBuck(e.target.value)}
              />
              <button disabled={!newBuck.trim()}>Add</button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}
