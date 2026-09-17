import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { TAGS } from './tags.js'

let buckCache = null
const SUG_COLORS = ['#4fc3f7', '#ffd54f', '#e56b1f', '#ab47bc', '#66bb6a', '#ef5350']

export default function PhotoViewer({ photo, camera, onClose, onPrev, onNext, onSaved }) {
  const [url, setUrl] = useState(null)
  const [tags, setTags] = useState(photo.tags || [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [bucks, setBucks] = useState(buckCache || [])
  const [assigned, setAssigned] = useState([])
  const [suggestions, setSuggestions] = useState([])
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
    supabase
      .from('buck_match_suggestions')
      .select('id,box_index,box,buck_id,label,confidence,reasoning')
      .eq('camera_id', photo.camera_id)
      .eq('photo_name', photo.photo_name)
      .eq('status', 'pending')
      .order('box_index')
      .then(({ data }) => setSuggestions(data || []))
    supabase
      .from('bucks')
      .select('id,name,status')
      .order('name')
      .then(({ data }) => {
        buckCache = data || []
        setBucks(buckCache)
      })
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

  async function unassign(s) {
    await supabase.from('buck_sightings').delete().eq('id', s.id)
    setAssigned((a) => a.filter((x) => x.id !== s.id))
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

  async function acceptSuggestion(sug) {
    const { data } = await supabase
      .from('buck_sightings')
      .insert({
        buck_id: sug.buck_id,
        camera_id: photo.camera_id,
        photo_name: photo.photo_name,
        box: sug.box,
      })
      .select('id,buck_id')
      .single()
    if (data) setAssigned((a) => [...a, data])
    await supabase.from('buck_match_suggestions').update({ status: 'accepted' }).eq('id', sug.id)
    setSuggestions((s) => s.filter((x) => x.id !== sug.id))
  }

  async function rejectSuggestion(sug) {
    await supabase.from('buck_match_suggestions').update({ status: 'rejected' }).eq('id', sug.id)
    setSuggestions((s) => s.filter((x) => x.id !== sug.id))
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
      <div className="stage">
        {url ? (
          <span className="imgbox">
            <img src={url} alt="" />
            {suggestions.map((s, i) => {
              const b = s.box?.box
              if (!b) return null
              const color = SUG_COLORS[i % SUG_COLORS.length]
              return (
                <span
                  key={s.id}
                  className="detbox"
                  style={{
                    left: b[0] * 100 + '%',
                    top: b[1] * 100 + '%',
                    width: (b[2] - b[0]) * 100 + '%',
                    height: (b[3] - b[1]) * 100 + '%',
                    borderColor: color,
                  }}
                >
                  <i style={{ background: color }}>{i + 1}</i>
                </span>
              )
            })}
          </span>
        ) : (
          <div className="spinner">Loading…</div>
        )}
        {onPrev && (
          <button className="nav prev" onClick={onPrev} aria-label="Previous">
            ‹
          </button>
        )}
        {onNext && (
          <button className="nav next" onClick={onNext} aria-label="Next">
            ›
          </button>
        )}
      </div>

      <aside className="rail">
        <div className="railhead">
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

        <div className="meta">
          {photo.battery != null && <span>Battery {photo.battery}%</span>}
          {photo.signal != null && <span>Signal {photo.signal}</span>}
          {photo.reviewed && <span>Reviewed</span>}
        </div>

        <div className="railsec">
          <h3 className="seghead">Tags</h3>
          <div className="tagrow">
            {TAGS.map((t) => (
              <button
                key={t}
                className={'chip' + (tags.includes(t) ? (t === 'Buck' ? ' accent on' : ' on') : '')}
                onClick={() => toggle(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <div className="savebar">
            <button className="btn primary sm" onClick={save} disabled={saving || saved}>
              {saved ? 'Saved' : saving ? 'Saving…' : 'Save tags'}
            </button>
            {saved && <span className="reviewed-note">Marked reviewed</span>}
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="railsec">
            <h3 className="seghead">Suggested matches</h3>
            <div className="sugcol">
              {suggestions.map((s, i) => {
                const color = SUG_COLORS[i % SUG_COLORS.length]
                return (
                  <div key={s.id} className="sugrow" style={{ borderLeft: '3px solid ' + color }}>
                    <div className="sugtext">
                      <span className="sugname" style={{ color }}>
                        {i + 1} ·{' '}
                        {s.label === 'match'
                          ? `${buckName(s.buck_id)}? ${Math.round((s.confidence || 0) * 100)}%`
                          : s.label === 'new_buck'
                          ? 'New buck?'
                          : 'Unsure'}
                      </span>
                      <span className="sugwhy">{s.reasoning}</span>
                    </div>
                    {s.label === 'match' ? (
                      <div className="sugbtns">
                        <button className="btn primary sm" onClick={() => acceptSuggestion(s)}>
                          ✓
                        </button>
                        <button className="btn quiet sm" onClick={() => rejectSuggestion(s)}>
                          ✕
                        </button>
                      </div>
                    ) : (
                      <div className="sugbtns">
                        <button
                          className="btn sm"
                          onClick={() => {
                            setPickerOpen(true)
                            rejectSuggestion(s)
                          }}
                        >
                          Assign…
                        </button>
                        <button className="btn quiet sm" onClick={() => rejectSuggestion(s)}>
                          Dismiss
                        </button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="railsec">
          <h3 className="seghead">Bucks in this photo</h3>
          <div className="tagrow">
            {assigned.map((s) => (
              <button key={s.id} className="chip accent on" onClick={() => unassign(s)}>
                {buckName(s.buck_id)} ✕
              </button>
            ))}
            <button className="chip" onClick={() => setPickerOpen(!pickerOpen)}>
              {pickerOpen ? 'Close' : '+ Assign'}
            </button>
          </div>
          {pickerOpen && (
            <div className="picker">
              {bucks
                .filter((b) => !assignedIds.has(b.id))
                .map((b) => (
                  <button key={b.id} className="chip" onClick={() => assign(b.id)}>
                    {b.name}
                  </button>
                ))}
              <form className="newbuck" onSubmit={createAndAssign}>
                <input
                  className="field"
                  placeholder="New buck name…"
                  value={newBuck}
                  onChange={(e) => setNewBuck(e.target.value)}
                />
                <button className="btn primary sm" disabled={!newBuck.trim()}>
                  Add
                </button>
              </form>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
