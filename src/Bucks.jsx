import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import PhotoViewer from './PhotoViewer.jsx'

const fmtH = (h) => (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : h - 12 + 'p')
const isDayHour = (h) => h >= 6 && h < 19
const AGE_CLASSES = ['', '1.5', '2.5', '3.5', '4.5', '5.5+']

function peakWindow(hours) {
  let best = 0, start = 0
  for (let s = 0; s < 24; s++) {
    const sum = hours[s] + hours[(s + 1) % 24] + hours[(s + 2) % 24]
    if (sum > best) { best = sum; start = s }
  }
  return best ? `${fmtH(start)}–${fmtH((start + 3) % 24)}` : '—'
}

async function signOne(path, secs = 3600) {
  if (!path) return null
  const { data } = await supabase.storage.from('trail-photos').createSignedUrl(path, secs)
  return data?.signedUrl || null
}

/* ---------- Instagram-style square cropper ---------- */
function CropModal({ srcUrl, onCancel, onSave }) {
  const [zoom, setZoom] = useState(1)
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [nat, setNat] = useState(null)
  const [busy, setBusy] = useState(false)
  const imgRef = useRef(null)
  const drag = useRef(null)
  const V = 300 // viewport px

  const f = nat ? (zoom * V) / Math.min(nat.w, nat.h) : 1
  const clamp = useCallback((p, fz) => {
    if (!nat) return p
    const mx = Math.max(0, (nat.w * fz - V) / 2)
    const my = Math.max(0, (nat.h * fz - V) / 2)
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) }
  }, [nat])

  function onDown(e) {
    drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function onMove(e) {
    if (!drag.current) return
    setPos(clamp({
      x: drag.current.ox + (e.clientX - drag.current.sx),
      y: drag.current.oy + (e.clientY - drag.current.sy),
    }, f))
  }
  function onUp() { drag.current = null }

  async function save() {
    if (!nat || busy) return
    setBusy(true)
    const canvas = document.createElement('canvas')
    canvas.width = 512
    canvas.height = 512
    const ctx = canvas.getContext('2d')
    const cx = (V - nat.w * f) / 2 + pos.x
    const cy = (V - nat.h * f) / 2 + pos.y
    ctx.drawImage(imgRef.current, -cx / f, -cy / f, V / f, V / f, 0, 0, 512, 512)
    canvas.toBlob((blob) => {
      if (blob) onSave(blob)
      else setBusy(false)
    }, 'image/jpeg', 0.85)
  }

  return (
    <div className="modalwrap" onClick={onCancel}>
      <div className="modal cropmodal" onClick={(e) => e.stopPropagation()}>
        <div className="modalhead"><h3>Crop profile photo</h3>
          <button className="close" onClick={onCancel}>✕</button>
        </div>
        <div className="modalbody">
          <div className="cropview" onPointerDown={onDown} onPointerMove={onMove}
            onPointerUp={onUp} onPointerCancel={onUp}>
            <img ref={imgRef} crossOrigin="anonymous" src={srcUrl} alt="" draggable={false}
              onLoad={(e) => setNat({ w: e.target.naturalWidth, h: e.target.naturalHeight })}
              style={nat ? {
                width: nat.w * f, height: nat.h * f,
                transform: `translate(${(V - nat.w * f) / 2 + pos.x}px, ${(V - nat.h * f) / 2 + pos.y}px)`,
              } : { opacity: 0 }}
            />
          </div>
          <label className="sliderrow" style={{ marginTop: 12 }}>
            <span>Zoom</span>
            <input type="range" min="1" max="3.5" step="0.05" value={zoom}
              onChange={(e) => {
                const z = Number(e.target.value)
                setZoom(z)
                setPos((p) => clamp(p, nat ? (z * V) / Math.min(nat.w, nat.h) : 1))
              }} />
          </label>
          <div className="pinactions">
            <button className="btn primary sm" onClick={save} disabled={!nat || busy}>
              {busy ? 'Saving…' : 'Save photo'}
            </button>
            <button className="btn quiet sm" onClick={onCancel}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ---------- roster ---------- */
export default function Bucks() {
  const [bucks, setBucks] = useState(null)
  const [cameras, setCameras] = useState({})
  const [avatars, setAvatars] = useState({})
  const [openBuck, setOpenBuck] = useState(null)
  const [newName, setNewName] = useState('')

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('bucks')
      .select('id,name,status,notes,ai_description,described_at,avatar_path,hit_list,age_class,score_est,buck_sightings(count)')
      .order('name')
    const rows = data || []
    rows.sort((a, z) => (z.hit_list === true) - (a.hit_list === true) || a.name.localeCompare(z.name))
    setBucks(rows)
    const withAv = rows.filter((b) => b.avatar_path)
    if (withAv.length) {
      const { data: signed } = await supabase.storage
        .from('trail-photos')
        .createSignedUrls(withAv.map((b) => b.avatar_path), 3600 * 6)
      const m = {}
      signed?.forEach((s, i) => { if (s.signedUrl) m[withAv[i].id] = s.signedUrl })
      setAvatars(m)
    }
  }, [])

  useEffect(() => {
    load()
    supabase.from('reveal_cameras').select('camera_id,name,shared').then(({ data }) => {
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
    const { data } = await supabase.from('bucks').insert({ name })
      .select('id,name,status,notes,ai_description,described_at,avatar_path,hit_list,age_class,score_est')
      .single()
    if (data) setOpenBuck(data)
    load()
  }

  if (openBuck)
    return (
      <BuckPage buck={openBuck} cameras={cameras} avatarUrl={avatars[openBuck.id]}
        onBack={() => { setOpenBuck(null); load() }} />
    )

  return (
    <>
      <header className="pagehead">
        <h2>Bucks</h2>
        <div className="spacer" />
        <form className="newbuck" style={{ width: 280 }} onSubmit={createBuck}>
          <input className="field" placeholder="Name a new buck…" value={newName}
            onChange={(e) => setNewName(e.target.value)} />
          <button className="btn primary sm" disabled={!newName.trim()}>Add</button>
        </form>
      </header>
      <main className="content">
        {bucks === null && <div className="spinner">Loading…</div>}
        {bucks && bucks.length === 0 && (
          <div className="empty">No bucks named yet. Assign one from a photo in the Feed, or add one above.</div>
        )}
        {bucks && bucks.length > 0 && (
          <div className="tscroll">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 40 }}></th>
                  <th style={{ width: '22%' }}>Name</th>
                  <th style={{ width: 110 }}>Status</th>
                  <th style={{ width: 90 }}>Age</th>
                  <th style={{ width: 100 }}>Sightings</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {bucks.map((b) => (
                  <tr key={b.id} className="row" onClick={() => setOpenBuck(b)}>
                    <td>
                      {avatars[b.id]
                        ? <img className="avatar sm" src={avatars[b.id]} alt="" />
                        : <span className="avatar sm ph" />}
                    </td>
                    <td className="primarycell">
                      {b.hit_list && <span className="star">★ </span>}{b.name}
                    </td>
                    <td><span className={'status ' + b.status}>{b.status}</span></td>
                    <td className="mutedcell">{b.age_class || '—'}</td>
                    <td className="mutedcell">{b.buck_sightings?.[0]?.count ?? 0}</td>
                    <td className="mutedcell">{(b.notes || b.ai_description || '').slice(0, 90)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  )
}

/* ---------- bio page ---------- */
function BuckPage({ buck, cameras, avatarUrl, onBack }) {
  const [sightings, setSightings] = useState(null)
  const [urls, setUrls] = useState({})
  const [notes, setNotes] = useState(buck.notes || '')
  const [status, setStatus] = useState(buck.status || 'active')
  const [ageClass, setAgeClass] = useState(buck.age_class || '')
  const [scoreEst, setScoreEst] = useState(buck.score_est || '')
  const [hitList, setHitList] = useState(buck.hit_list === true)
  const [savedNote, setSavedNote] = useState(true)
  const [viewing, setViewing] = useState(null)
  const [avatar, setAvatar] = useState(avatarUrl || null)
  const [picking, setPicking] = useState(false)
  const [cropSrc, setCropSrc] = useState(null)
  const [rebuildQueued, setRebuildQueued] = useState(
    !!buck.ai_description && !buck.described_at
  )

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('buck_sightings')
      .select('id,camera_id,photo_name,hires_path,created_at,reveal_photos(photo_name,camera_id,taken_at,thumb_path,storage_path,tags,reviewed,battery,signal,keep)')
      .eq('buck_id', buck.id)
      .order('created_at', { ascending: false })
    const rows = (data || []).filter((s) => s.reveal_photos)
    rows.sort((a, z) =>
      (z.reveal_photos.taken_at || '').localeCompare(a.reveal_photos.taken_at || ''))
    setSightings(rows)
    const paths = rows
      .map((s) => s.reveal_photos.thumb_path || s.reveal_photos.storage_path)
      .filter(Boolean)
    if (paths.length) {
      const { data: signed } = await supabase.storage
        .from('trail-photos').createSignedUrls(paths, 3600 * 6)
      const m = {}
      for (const d of signed || []) if (d.signedUrl) m[d.path] = d.signedUrl
      setUrls(m)
    }
  }, [buck.id])

  useEffect(() => { load() }, [load])

  const stats = useMemo(() => {
    if (!sightings || !sightings.length) return null
    const ts = sightings
      .map((s) => (s.reveal_photos.taken_at ? new Date(s.reveal_photos.taken_at) : null))
      .filter(Boolean)
      .sort((a, z) => a - z)
    const hours = Array(24).fill(0)
    let dayN = 0
    const cams = new Set()
    for (const s of sightings) cams.add(s.camera_id)
    for (const t of ts) {
      hours[t.getHours()]++
      if (isDayHour(t.getHours())) dayN++
    }
    const dayKeys = [...new Set(ts.map((t) => t.toDateString()))]
    let cadence = null
    if (dayKeys.length >= 3) {
      const times = dayKeys.map((d) => new Date(d).getTime()).sort((a, z) => a - z)
      cadence = (times[times.length - 1] - times[0]) / 86400000 / (dayKeys.length - 1)
    }
    const daysSince = ts.length ? (Date.now() - ts[ts.length - 1].getTime()) / 86400000 : null
    return {
      n: ts.length, cams: cams.size, hours,
      dayPct: ts.length ? Math.round((dayN / ts.length) * 100) : 0,
      peak: peakWindow(hours), cadence, daysSince,
      overdue: cadence != null && daysSince != null && daysSince > cadence * 1.5,
    }
  }, [sightings])

  const months = useMemo(() => {
    const groups = []
    if (!sightings) return groups
    const asc = [...sightings].sort((a, z) =>
      (a.reveal_photos.taken_at || '').localeCompare(z.reveal_photos.taken_at || ''))
    let cur = null
    for (const s of asc) {
      const t = s.reveal_photos.taken_at ? new Date(s.reveal_photos.taken_at) : null
      const label = t
        ? t.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
        : 'Undated'
      if (label !== cur) { groups.push({ label, items: [] }); cur = label }
      groups[groups.length - 1].items.push(s)
    }
    return groups
  }, [sightings])

  async function saveDetails() {
    await supabase.from('bucks')
      .update({ notes, status, age_class: ageClass || null, score_est: scoreEst || null })
      .eq('id', buck.id)
    setSavedNote(true)
  }

  async function toggleHit() {
    const next = !hitList
    setHitList(next)
    await supabase.from('bucks').update({ hit_list: next }).eq('id', buck.id)
  }

  async function queueRebuild() {
    setRebuildQueued(true)
    await supabase.from('bucks').update({ described_at: null }).eq('id', buck.id)
  }

  async function deleteBuck() {
    if (!confirm(`Delete ${buck.name} and all his sightings?`)) return
    await supabase.from('bucks').delete().eq('id', buck.id)
    onBack()
  }

  async function pickSource(s) {
    setPicking(false)
    const src = await signOne(s.hires_path || s.reveal_photos.storage_path)
    if (src) setCropSrc(src)
  }

  async function saveAvatar(blob) {
    const path = `avatars/${buck.id}.jpg`
    const { error } = await supabase.storage.from('trail-photos')
      .upload(path, blob, { upsert: true, contentType: 'image/jpeg' })
    if (!error) {
      await supabase.from('bucks').update({ avatar_path: path }).eq('id', buck.id)
      setAvatar(await signOne(path))
    }
    setCropSrc(null)
  }

  const flat = months.flatMap((g) => g.items)
  const viewList = flat.map((s) => s.reveal_photos)

  return (
    <>
      <header className="pagehead">
        <button className="btn quiet sm" onClick={onBack}>‹ Bucks</button>
        <div className="buckhead">
          <h2>{buck.name}</h2>
          <button className={'starbtn' + (hitList ? ' on' : '')} title="Hit list"
            onClick={toggleHit}>★</button>
          <span className={'status ' + status}>{status}</span>
        </div>
        <div className="spacer" />
        <button className="btn quiet sm danger" onClick={deleteBuck}>Delete</button>
      </header>

      <main className="content">
        <section className="dossier">
          <button className="avatarwrap" title="Set profile photo"
            onClick={() => setPicking(true)}>
            {avatar ? <img className="avatar lg" src={avatar} alt="" />
              : <span className="avatar lg ph">Set photo</span>}
          </button>
          <div className="dossierstats">
            {stats ? (
              <>
                <div className="statrow" style={{ margin: 0 }}>
                  <div className="stat"><b>{stats.n}</b><span>Sightings</span></div>
                  <div className="stat"><b>{stats.cams}</b><span>Cameras</span></div>
                  <div className="stat"><b>{stats.dayPct}%</b><span>Daylight</span></div>
                  <div className="stat"><b>{stats.peak}</b><span>Peak window</span></div>
                  {scoreEst && <div className="stat"><b>{scoreEst}</b><span>Est. score</span></div>}
                </div>
                <p className="insight" style={{ margin: '8px 0 0' }}>
                  {stats.cadence
                    ? <>Shows every ~{stats.cadence.toFixed(1)}d · last seen {Math.floor(stats.daysSince)}d ago
                        {stats.overdue ? <b className="due"> · overdue</b> : ' · on pace'}</>
                    : stats.daysSince != null
                    ? <>Last seen {Math.floor(stats.daysSince)}d ago</>
                    : null}
                </p>
              </>
            ) : (
              <p className="insight" style={{ margin: 0 }}>No confirmed sightings yet.</p>
            )}
          </div>
          {stats && (
            <svg className="minihours" viewBox="0 0 240 56" role="img">
              {stats.hours.map((n, h) => {
                const max = Math.max(1, ...stats.hours)
                const bh = (n / max) * 40
                return (
                  <g key={h}>
                    <title>{`${fmtH(h)} — ${n}`}</title>
                    <rect x={h * 10 + 1} y={46 - bh} width={8} height={bh}
                      fill="var(--accent)" rx="1.5" opacity={n ? 1 : 0.15} />
                  </g>
                )
              })}
              <text x="5" y="55" fontSize="8" fill="var(--faint)">12a</text>
              <text x="120" y="55" fontSize="8" fill="var(--faint)" textAnchor="middle">12p</text>
              <text x="235" y="55" fontSize="8" fill="var(--faint)" textAnchor="end">11p</text>
            </svg>
          )}
        </section>

        <div className="bucklayout">
          <div>
            {sightings === null && <div className="spinner">Loading sightings…</div>}
            {sightings && sightings.length === 0 && (
              <div className="empty">No sightings yet — assign him from photos in the Feed.</div>
            )}
            {months.map((g) => (
              <section key={g.label}>
                <div className="dayhead">{g.label}</div>
                <div className="grid">
                  {g.items.map((s) => {
                    const p = s.reveal_photos
                    const src = urls[p.thumb_path || p.storage_path]
                    const idx = flat.indexOf(s)
                    return (
                      <button key={s.id} className="cell" onClick={() => setViewing(idx)}>
                        {src ? <img src={src} alt="" loading="lazy" /> : null}
                        {s.hires_path && <span className="hdflag">HD</span>}
                      </button>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>

          <aside className="buckside">
            <div>
              <h3 className="seghead">Status</h3>
              <div className="tagrow">
                {['active', 'harvested', 'missing'].map((s) => (
                  <button key={s} className={'chip' + (status === s ? ' on' : '')}
                    onClick={() => { setStatus(s); setSavedNote(false) }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="fieldrow2">
              <label>
                <span className="seghead">Age class</span>
                <select className="field" value={ageClass}
                  onChange={(e) => { setAgeClass(e.target.value); setSavedNote(false) }}>
                  {AGE_CLASSES.map((a) => (
                    <option key={a} value={a}>{a || 'Unknown'}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="seghead">Est. score</span>
                <input className="field" placeholder="e.g. 140s" value={scoreEst}
                  onChange={(e) => { setScoreEst(e.target.value); setSavedNote(false) }} />
              </label>
            </div>
            <div>
              <h3 className="seghead">Notes</h3>
              <textarea className="field" rows={5}
                placeholder="Points, spread, where he beds, history…"
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setSavedNote(false) }} />
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
                <p className="profmeta">
                  {rebuildQueued
                    ? 'Rebuild queued — next hourly run'
                    : buck.described_at
                    ? 'Written ' + new Date(buck.described_at).toLocaleDateString(undefined,
                        { month: 'short', day: 'numeric' })
                    : null}
                </p>
                {!rebuildQueued && (
                  <button className="btn sm" onClick={queueRebuild}
                    title="Rewrites his profile from current best photos and your notes on the next hourly run">
                    Rebuild profile
                  </button>
                )}
              </div>
            )}
          </aside>
        </div>
      </main>

      {picking && (
        <div className="modalwrap" onClick={() => setPicking(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalhead"><h3>Choose a photo</h3>
              <button className="close" onClick={() => setPicking(false)}>✕</button>
            </div>
            <div className="modalbody">
              <p className="settinghint">HD crops give the sharpest profile picture.</p>
              <div className="grid" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
                {[...(sightings || [])]
                  .sort((a, z) => (z.hires_path ? 1 : 0) - (a.hires_path ? 1 : 0))
                  .map((s) => {
                    const p = s.reveal_photos
                    const src = urls[p.thumb_path || p.storage_path]
                    return (
                      <button key={s.id} className="cell" onClick={() => pickSource(s)}>
                        {src ? <img src={src} alt="" /> : null}
                        {s.hires_path && <span className="hdflag">HD</span>}
                      </button>
                    )
                  })}
              </div>
            </div>
          </div>
        </div>
      )}
      {cropSrc && (
        <CropModal srcUrl={cropSrc} onCancel={() => setCropSrc(null)} onSave={saveAvatar} />
      )}

      {viewing !== null && viewList[viewing] && (
        <PhotoViewer
          photo={viewList[viewing]}
          camera={cameras[viewList[viewing].camera_id]}
          onClose={() => { setViewing(null); load() }}
          onPrev={viewing > 0 ? () => setViewing(viewing - 1) : null}
          onNext={viewing < viewList.length - 1 ? () => setViewing(viewing + 1) : null}
          onSaved={() => {}}
        />
      )}
    </>
  )
}
