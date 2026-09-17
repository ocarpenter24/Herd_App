import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import PhotoViewer from './PhotoViewer.jsx'

export default function Bucks() {
  const [bucks, setBucks] = useState(null)
  const [cameras, setCameras] = useState({})
  const [openBuck, setOpenBuck] = useState(null)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('bucks')
      .select('id,name,status,notes,ai_description,buck_sightings(count)')
      .order('name')
    setBucks(data || [])
  }, [])

  useEffect(() => {
    load()
    supabase
      .from('reveal_cameras')
      .select('camera_id,name,shared')
      .then(({ data }) => {
        const m = {}
        for (const c of data || []) m[c.camera_id] = c
        setCameras(m)
      })
  }, [load])

  async function createBuck(e) {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setNewName('')
    const { data } = await supabase
      .from('bucks')
      .insert({ name })
      .select('id,name,status,notes,ai_description')
      .single()
    if (data) setOpenBuck(data)
    load()
  }

  if (openBuck)
    return (
      <BuckPage
        buck={openBuck}
        cameras={cameras}
        onBack={() => {
          setOpenBuck(null)
          load()
        }}
      />
    )

  return (
    <>
      <header className="pagehead">
        <h2>Bucks</h2>
        <div className="spacer" />
        <form className="newbuck" style={{ width: 280 }} onSubmit={createBuck}>
          <input
            className="field"
            placeholder="Name a new buck…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button className="btn primary sm" disabled={!newName.trim()}>
            Add
          </button>
        </form>
      </header>
      <main className="content">
        {bucks === null && <div className="spinner">Loading…</div>}
        {bucks && bucks.length === 0 && (
          <div className="empty">
            No bucks named yet. Assign one from a photo in the Feed, or add one above.
          </div>
        )}
        {bucks && bucks.length > 0 && (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '22%' }}>Name</th>
                <th style={{ width: 110 }}>Status</th>
                <th style={{ width: 100 }}>Sightings</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {bucks.map((b) => (
                <tr key={b.id} className="row" onClick={() => setOpenBuck(b)}>
                  <td className="primarycell">{b.name}</td>
                  <td>
                    <span className={'status ' + b.status}>{b.status}</span>
                  </td>
                  <td className="mutedcell">{b.buck_sightings?.[0]?.count ?? 0}</td>
                  <td className="mutedcell">
                    {(b.notes || b.ai_description || '').slice(0, 110)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  )
}

function BuckPage({ buck, cameras, onBack }) {
  const [sightings, setSightings] = useState(null)
  const [urls, setUrls] = useState({})
  const [notes, setNotes] = useState(buck.notes || '')
  const [status, setStatus] = useState(buck.status || 'active')
  const [savedNote, setSavedNote] = useState(true)
  const [viewing, setViewing] = useState(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('buck_sightings')
      .select(
        'id,camera_id,photo_name,created_at,reveal_photos(photo_name,camera_id,taken_at,thumb_path,storage_path,tags,reviewed,battery,signal)'
      )
      .eq('buck_id', buck.id)
      .order('created_at', { ascending: false })
    const rows = (data || []).filter((s) => s.reveal_photos)
    rows.sort((a, b) =>
      (b.reveal_photos.taken_at || '').localeCompare(a.reveal_photos.taken_at || '')
    )
    setSightings(rows)
    const paths = rows
      .map((s) => s.reveal_photos.thumb_path || s.reveal_photos.storage_path)
      .filter(Boolean)
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from('trail-photos')
        .createSignedUrls(paths, 60 * 60 * 6)
      const m = {}
      for (const d of signed || []) if (d.signedUrl) m[d.path] = d.signedUrl
      setUrls(m)
    }
  }, [buck.id])

  useEffect(() => {
    load()
  }, [load])

  async function saveDetails() {
    await supabase.from('bucks').update({ notes, status }).eq('id', buck.id)
    setSavedNote(true)
  }

  async function deleteBuck() {
    if (!confirm(`Delete ${buck.name} and all his sightings?`)) return
    await supabase.from('bucks').delete().eq('id', buck.id)
    onBack()
  }

  const photos = (sightings || []).map((s) => s.reveal_photos)
  const lastSeen = photos[0]?.taken_at
    ? new Date(photos[0].taken_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })
    : '—'

  return (
    <>
      <header className="pagehead">
        <button className="btn quiet sm" onClick={onBack}>
          ‹ Bucks
        </button>
        <div className="buckhead">
          <h2>{buck.name}</h2>
          <span className={'status ' + status}>{status}</span>
          <span className="mutedcell" style={{ color: 'var(--muted)', fontSize: 12.5 }}>
            {photos.length} sightings · last seen {lastSeen}
          </span>
        </div>
        <div className="spacer" />
        <button className="btn quiet sm danger" onClick={deleteBuck}>
          Delete
        </button>
      </header>
      <main className="content">
        <div className="bucklayout">
          <div>
            {sightings === null && <div className="spinner">Loading sightings…</div>}
            {sightings && sightings.length === 0 && (
              <div className="empty">No sightings yet — assign him from photos in the Feed.</div>
            )}
            <div className="grid">
              {photos.map((p, i) => {
                const src = urls[p.thumb_path || p.storage_path]
                return (
                  <button
                    key={p.camera_id + p.photo_name}
                    className="cell"
                    onClick={() => setViewing(i)}
                  >
                    {src ? <img src={src} alt="" loading="lazy" /> : null}
                  </button>
                )
              })}
            </div>
          </div>
          <aside className="buckside">
            <div>
              <h3 className="seghead">Status</h3>
              <div className="tagrow">
                {['active', 'harvested', 'missing'].map((s) => (
                  <button
                    key={s}
                    className={'chip' + (status === s ? ' on' : '')}
                    onClick={() => {
                      setStatus(s)
                      setSavedNote(false)
                    }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <h3 className="seghead">Notes</h3>
              <textarea
                className="field"
                rows={5}
                placeholder="Points, spread, where he beds, history…"
                value={notes}
                onChange={(e) => {
                  setNotes(e.target.value)
                  setSavedNote(false)
                }}
              />
              <div className="savebar">
                <button className="btn primary sm" onClick={saveDetails} disabled={savedNote}>
                  {savedNote ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>
            {buck.ai_description && (
              <div>
                <h3 className="seghead">AI profile</h3>
                <p className="aidesc">{buck.ai_description}</p>
              </div>
            )}
          </aside>
        </div>
      </main>
      {viewing !== null && photos[viewing] && (
        <PhotoViewer
          photo={photos[viewing]}
          camera={cameras[photos[viewing].camera_id]}
          onClose={() => {
            setViewing(null)
            load()
          }}
          onPrev={viewing > 0 ? () => setViewing(viewing - 1) : null}
          onNext={viewing < photos.length - 1 ? () => setViewing(viewing + 1) : null}
          onSaved={() => {}}
        />
      )}
    </>
  )
}
