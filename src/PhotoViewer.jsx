import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import { TAGS } from './tags.js'

export default function PhotoViewer({ photo, camera, onClose, onPrev, onNext, onSaved }) {
  const [url, setUrl] = useState(null)
  const [tags, setTags] = useState(photo.tags || [])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setTags(photo.tags || [])
    setSaved(false)
    setUrl(null)
    supabase.storage
      .from('trail-photos')
      .createSignedUrl(photo.storage_path, 60 * 60)
      .then(({ data }) => setUrl(data?.signedUrl || null))
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
    setSaving(false)
    if (!error) {
      setSaved(true)
      onSaved({ photo_name: photo.photo_name, ...patch })
    }
  }

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
              className={
                'tag' + (tags.includes(t) ? ' on' : '') + (t === 'Buck' ? ' buck' : '')
              }
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
      </div>
    </div>
  )
}
