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
      .select('id,name,status,notes,buck_sightings(count)')
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
      .select('id,name,status,notes')
      .single()
    if (data) setOpenBuck({ ...data, buck_sightings: [{ count: 0 }] })
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
    <div className="page">
      <header className="topbar">
        <div className="row1">
          <h1>Bucks</h1>
        </div>
        <form className="newbuck" onSubmit={createBuck}>
          <input
            placeholder="Name a new buck…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <button disabled={!newName.trim()}>Add</button>
        </form>
      </header>
      <main className="feed">
        {bucks === null && <div className="spinner">Loading…</div>}
        {bucks && bucks.length === 0 && (
          <div className="empty">
            No bucks named yet.
            <br />
            Open a buck photo in the Feed and hit "Assign bucks", or add one above.
          </div>
        )}
        <div className="bucklist">
          {(bucks || []).map((b) => (
            <button key={b.id} className="buckcard" onClick={() => setOpenBuck(b)}>
              <span className="antler">⑂</span>
              <span className="bname">{b.name}</span>
              <span className="bmeta">
                {b.buck_sightings?.[0]?.count ?? 0} sightings
                {b.status !== 'active' ? ` · ${b.status}` : ''}
              </span>
            </button>
          ))}
        </div>
      </main>
    </div>
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

  return (
    <div className="page">
      <header className="topbar">
        <div className="row1">
          <button className="backbtn" onClick={onBack}>
            ‹ Bucks
          </button>
          <h1>{buck.name}</h1>
          <button className="caughtup" onClick={deleteBuck}>
            Delete
          </button>
        </div>
        <div className="chips">
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
      </header>
      <main className="feed">
        <div className="notesbox">
          <textarea
            rows={3}
            placeholder="Notes — points, spread, where he beds, history…"
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value)
              setSavedNote(false)
            }}
          />
          <button className="save" onClick={saveDetails} disabled={savedNote}>
            {savedNote ? 'Saved' : 'Save'}
          </button>
        </div>
        {sightings === null && <div className="spinner">Loading sightings…</div>}
        {sightings && sightings.length === 0 && (
          <div className="empty">
            No sightings yet — assign him from photos in the Feed.
          </div>
        )}
        <div className="grid">
          {photos.map((p, i) => {
            const src = urls[p.thumb_path || p.storage_path]
            return (
              <button key={p.camera_id + p.photo_name} className="cell" onClick={() => setViewing(i)}>
                {src ? <img src={src} alt="" loading="lazy" /> : null}
              </button>
            )
          })}
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
    </div>
  )
}
