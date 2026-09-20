import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { TAGS } from './tags.js'

let buckCache = null
const SUG_COLORS = ['#4fc3f7', '#ffd54f', '#e56b1f', '#ab47bc', '#66bb6a', '#ef5350']
const SIGHT_COLOR = '#7fbf7a'

export default function PhotoViewer({ photo, camera, onClose, onPrev, onNext, onSaved }) {
  const [url, setUrl] = useState(null)
  const [tags, setTags] = useState(photo.tags || [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [bucks, setBucks] = useState(buckCache || [])
  const [assigned, setAssigned] = useState([]) // sightings: {id, buck_id, box}
  const [suggestions, setSuggestions] = useState([]) // + local res: {type:'buck'|'doe'|'dismissed'}
  const [pickerOpen, setPickerOpen] = useState(false)
  const [openChange, setOpenChange] = useState(null) // suggestion id with picker open
  const [newBuck, setNewBuck] = useState('')
  const [keep, setKeep] = useState(photo.keep === true)
  const [faces, setFaces] = useState({})

  useEffect(() => {
    setTags(photo.tags || [])
    setKeep(photo.keep === true)
    setSaved(false)
    setUrl(null)
    setPickerOpen(false)
    setOpenChange(null)
    supabase.storage
      .from('trail-photos')
      .createSignedUrl(photo.storage_path, 60 * 60)
      .then(({ data }) => setUrl(data?.signedUrl || null))
    supabase
      .from('buck_sightings')
      .select('id,buck_id,box,hires_path')
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
      .select('id,name,status,avatar_path')
      .order('name')
      .then(async ({ data }) => {
        buckCache = data || []
        setBucks(buckCache)
        const withAv = buckCache.filter((b) => b.avatar_path)
        if (withAv.length) {
          const { data: signed } = await supabase.storage
            .from('trail-photos')
            .createSignedUrls(withAv.map((b) => b.avatar_path), 3600)
          const m = {}
          signed?.forEach((s, i) => { if (s.signedUrl) m[withAv[i].id] = s.signedUrl })
          setFaces(m)
        }
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

  // ----- manual (boxless) assignment -----
  async function assign(buckId, box = null) {
    const { data } = await supabase
      .from('buck_sightings')
      .insert({
        buck_id: buckId,
        camera_id: photo.camera_id,
        photo_name: photo.photo_name,
        box,
      })
      .select('id,buck_id,box')
      .single()
    if (data) setAssigned((a) => [...a, data])
    return data
  }

  async function unassign(s) {
    await supabase.from('buck_sightings').delete().eq('id', s.id)
    setAssigned((a) => a.filter((x) => x.id !== s.id))
  }

  async function createBuck(name) {
    const { data } = await supabase
      .from('bucks')
      .insert({ name })
      .select('id,name,status')
      .single()
    if (data) {
      buckCache = [...(buckCache || []), data].sort((a, b) => a.name.localeCompare(b.name))
      setBucks(buckCache)
    }
    return data
  }

  async function createAndAssign(e) {
    e.preventDefault()
    const name = newBuck.trim()
    if (!name) return
    setNewBuck('')
    const b = await createBuck(name)
    if (b) assign(b.id)
  }

  // ----- box resolution -----
  function markResolved(sugId, res) {
    setSuggestions((s) => s.map((x) => (x.id === sugId ? { ...x, res } : x)))
    setOpenChange(null)
  }

  async function resolveAsBuck(sug, buckId) {
    await assign(buckId, sug.box)
    const wasAiPick = sug.label === 'match' && sug.buck_id === buckId
    await supabase
      .from('buck_match_suggestions')
      .update({ status: wasAiPick ? 'accepted' : 'corrected' })
      .eq('id', sug.id)
    markResolved(sug.id, { type: 'buck', name: buckName(buckId) })
  }

  async function resolveAsNewBuck(sug, name) {
    const b = await createBuck(name)
    if (!b) return
    await assign(b.id, sug.box)
    await supabase
      .from('buck_match_suggestions')
      .update({ status: 'corrected' })
      .eq('id', sug.id)
    markResolved(sug.id, { type: 'buck', name: b.name })
  }

  async function resolveAsDoe(sug) {
    await supabase
      .from('buck_match_suggestions')
      .update({ status: 'not_buck' })
      .eq('id', sug.id)
    setSaved(false)
    setTags((t) => (t.includes('Doe') ? t : [...t, 'Doe']))
    markResolved(sug.id, { type: 'doe' })
  }

  async function dismissSuggestion(sug) {
    // 'unsure' = human couldn't tell either; not counted as a wrong AI guess
    await supabase
      .from('buck_match_suggestions')
      .update({ status: 'unsure' })
      .eq('id', sug.id)
    markResolved(sug.id, { type: 'dismissed' })
  }

  async function toggleKeep() {
    const next = !keep
    setKeep(next)
    await supabase
      .from('reveal_photos')
      .update({ keep: next })
      .eq('photo_name', photo.photo_name)
      .eq('camera_id', photo.camera_id)
  }

  async function openHires(s) {
    const { data } = await supabase.storage
      .from('trail-photos')
      .createSignedUrl(s.hires_path, 60 * 10)
    if (data?.signedUrl) window.open(data.signedUrl, '_blank')
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

  const unresolvedCount = suggestions.filter((s) => !s.res).length

  return (
    <div className="viewer">
      <div className="stage">
        {url ? (
          <span className="imgbox">
            <img src={url} alt="" />
            {/* confirmed sightings with a box: green, named */}
            {assigned.map((s) => {
              const b = s.box?.box
              if (!b) return null
              return (
                <span
                  key={'sight' + s.id}
                  className="detbox resolved"
                  style={{
                    left: b[0] * 100 + '%',
                    top: b[1] * 100 + '%',
                    width: (b[2] - b[0]) * 100 + '%',
                    height: (b[3] - b[1]) * 100 + '%',
                    borderColor: SIGHT_COLOR,
                  }}
                >
                  <i style={{ background: SIGHT_COLOR }}>{buckName(s.buck_id)}</i>
                </span>
              )
            })}
            {/* open questions + session resolutions */}
            {suggestions.map((s, i) => {
              const b = s.box?.box
              if (!b) return null
              if (s.res?.type === 'buck') return null // green sighting box covers it
              const color = SUG_COLORS[i % SUG_COLORS.length]
              const resolved = !!s.res
              return (
                <span
                  key={s.id}
                  className={'detbox' + (resolved ? ' resolved' : '')}
                  style={{
                    left: b[0] * 100 + '%',
                    top: b[1] * 100 + '%',
                    width: (b[2] - b[0]) * 100 + '%',
                    height: (b[3] - b[1]) * 100 + '%',
                    borderColor: color,
                  }}
                >
                  <i style={{ background: color }}>
                    {s.res?.type === 'doe'
                      ? 'Doe'
                      : s.res?.type === 'dismissed'
                      ? 'Unsure'
                      : i + 1}
                  </i>
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
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button
              className={'chip' + (keep ? ' accent on' : '')}
              title="Protect this photo from auto-cleanup"
              onClick={toggleKeep}
            >
              {keep ? 'Kept ★' : 'Keep'}
            </button>
            <button className="close" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
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
            <h3 className="seghead">
              Deer in this photo
              {unresolvedCount > 0 ? ` — ${unresolvedCount} to identify` : ' — all identified'}
            </h3>
            <div className="sugcol">
              {suggestions.map((s, i) => {
                const color = SUG_COLORS[i % SUG_COLORS.length]
                if (s.res) {
                  return (
                    <div key={s.id} className="sugrow done" style={{ borderLeft: '3px solid ' + color }}>
                      <span className="sugname" style={{ color }}>
                        {i + 1} ·{' '}
                        {s.res.type === 'buck'
                          ? s.res.name + ' ✓'
                          : s.res.type === 'doe'
                          ? 'Doe'
                          : 'Unsure'}
                      </span>
                    </div>
                  )
                }
                return (
                  <div key={s.id} className="sugwrap">
                    <div className="sugrow" style={{ borderLeft: '3px solid ' + color }}>
                      <div className="sugtext">
                        <span className="sugname" style={{ color }}>
                          {i + 1} ·{' '}
                          {s.label === 'match' && faces[s.buck_id] && (
                            <img className="sugface" src={faces[s.buck_id]} alt="" />
                          )}
                          {s.label === 'match'
                            ? `${buckName(s.buck_id)}? ${Math.round((s.confidence || 0) * 100)}%`
                            : s.label === 'new_buck'
                            ? 'Buck not on roster?'
                            : 'Unsure'}
                        </span>
                        <span className="sugwhy">{s.reasoning}</span>
                      </div>
                      <div className="sugbtns col">
                        <div className="sugbtnrow">
                          {s.label === 'match' && (
                            <button
                              className="btn primary sm"
                              title={'Confirm ' + buckName(s.buck_id)}
                              onClick={() => resolveAsBuck(s, s.buck_id)}
                            >
                              ✓
                            </button>
                          )}
                          {s.label !== 'match' && s.label !== 'new_buck' && (
                            <button
                              className="btn primary sm"
                              title="Confirm — can't tell who this is"
                              onClick={() => dismissSuggestion(s)}
                            >
                              ✓
                            </button>
                          )}
                          <button
                            className="btn sm"
                            onClick={() => setOpenChange(openChange === s.id ? null : s.id)}
                          >
                            {s.label === 'match' ? 'Change' : 'Identify'}
                          </button>
                        </div>
                        {(s.label === 'match' || s.label === 'new_buck') && (
                          <button className="btn quiet sm" onClick={() => dismissSuggestion(s)}>
                            Unsure
                          </button>
                        )}
                      </div>
                    </div>
                    {openChange === s.id && (
                      <div className="picker">
                        <div className="pickerhead">Deer {i + 1} is:</div>
                        {bucks.map((b) => (
                          <button
                            key={b.id}
                            className={'chip' + (b.id === s.buck_id ? ' accent on' : '')}
                            onClick={() => resolveAsBuck(s, b.id)}
                          >
                            {b.name}
                          </button>
                        ))}
                        <button className="chip" onClick={() => resolveAsDoe(s)}>
                          Doe / not a buck
                        </button>
                        <button className="chip" onClick={() => dismissSuggestion(s)}>
                          Can't tell — skip
                        </button>
                        <form
                          className="newbuck"
                          onSubmit={(e) => {
                            e.preventDefault()
                            const name = newBuck.trim()
                            if (!name) return
                            setNewBuck('')
                            resolveAsNewBuck(s, name)
                          }}
                        >
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
                )
              })}
            </div>
          </div>
        )}

        <div className="railsec">
          <h3 className="seghead">Bucks in this photo</h3>
          <div className="tagrow">
            {assigned.map((s) => (
              <span key={s.id} style={{ display: 'inline-flex', gap: 4 }}>
                <button className="chip accent on" onClick={() => unassign(s)}>
                  {buckName(s.buck_id)} ✕
                </button>
                {s.hires_path && (
                  <button className="chip" title="Open full-resolution crop" onClick={() => openHires(s)}>
                    HD
                  </button>
                )}
              </span>
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
