import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import PhotoViewer from './PhotoViewer.jsx'

const PAGE = 60
const LAST_SEEN_KEY = 'herd_last_seen'

function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yest)) return 'Yesterday'
  return d.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

export default function Feed() {
  const [cameras, setCameras] = useState({})
  const [photos, setPhotos] = useState([])
  const [urls, setUrls] = useState({}) // storage path -> signed url
  const [camFilter, setCamFilter] = useState(null)
  const [reviewOnly, setReviewOnly] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const [viewing, setViewing] = useState(null) // index into photos
  const lastSeenRef = useRef(localStorage.getItem(LAST_SEEN_KEY))

  // Cameras once
  useEffect(() => {
    supabase
      .from('reveal_cameras')
      .select('camera_id,name,shared')
      .then(({ data }) => {
        const map = {}
        for (const c of data || []) map[c.camera_id] = c
        setCameras(map)
      })
  }, [])

  // New-since-last-visit count
  useEffect(() => {
    const since = lastSeenRef.current
    if (!since) return
    supabase
      .from('reveal_photos')
      .select('photo_name', { count: 'exact', head: true })
      .gt('taken_at', since)
      .then(({ count }) => setNewCount(count || 0))
  }, [])

  const fetchPage = useCallback(
    async (offset) => {
      let q = supabase
        .from('reveal_photos')
        .select('photo_name,camera_id,taken_at,thumb_path,storage_path,tags,reviewed,battery,signal')
        .order('taken_at', { ascending: false })
        .range(offset, offset + PAGE - 1)
      if (camFilter) q = q.eq('camera_id', camFilter)
      if (reviewOnly) q = q.eq('reviewed', false)
      const { data, error } = await q
      if (error) {
        console.error(error)
        return []
      }
      return data || []
    },
    [camFilter, reviewOnly]
  )

  // Sign thumbnail URLs in one batch per page
  const signPaths = useCallback(async (rows) => {
    const paths = rows
      .map((p) => p.thumb_path || p.storage_path)
      .filter((p) => p && p.length)
    if (!paths.length) return
    const { data } = await supabase.storage
      .from('trail-photos')
      .createSignedUrls(paths, 60 * 60 * 6)
    if (!data) return
    setUrls((prev) => {
      const next = { ...prev }
      for (const d of data) if (d.signedUrl) next[d.path] = d.signedUrl
      return next
    })
  }, [])

  // Initial load + reload on filter change
  useEffect(() => {
    let alive = true
    setLoading(true)
    setPhotos([])
    setHasMore(true)
    fetchPage(0).then(async (rows) => {
      if (!alive) return
      setPhotos(rows)
      setHasMore(rows.length === PAGE)
      setLoading(false)
      signPaths(rows)
    })
    return () => {
      alive = false
    }
  }, [fetchPage, signPaths])

  async function loadMore() {
    const rows = await fetchPage(photos.length)
    setPhotos((p) => [...p, ...rows])
    setHasMore(rows.length === PAGE)
    signPaths(rows)
  }

  function markCaughtUp() {
    const now = new Date().toISOString()
    localStorage.setItem(LAST_SEEN_KEY, now)
    lastSeenRef.current = now
    setNewCount(0)
  }

  function onSaved(updated) {
    setPhotos((list) =>
      list.map((p) => (p.photo_name === updated.photo_name ? { ...p, ...updated } : p))
    )
  }

  // Group by day for section headers
  const groups = useMemo(() => {
    const out = []
    let curLabel = null
    for (let i = 0; i < photos.length; i++) {
      const label = photos[i].taken_at ? dayLabel(photos[i].taken_at) : 'Undated'
      if (label !== curLabel) {
        out.push({ label, items: [] })
        curLabel = label
      }
      out[out.length - 1].items.push(i)
    }
    return out
  }, [photos])

  const lastSeen = lastSeenRef.current
  const camList = Object.values(cameras).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '')
  )

  return (
    <>
      <header className="topbar">
        <div className="row1">
          <h1>Herd</h1>
          <div>
            <span className={'newcount' + (newCount ? '' : ' zero')}>
              {lastSeen
                ? newCount
                  ? `${newCount} new since last visit`
                  : 'All caught up'
                : 'First visit'}
            </span>
            {newCount > 0 && (
              <button className="caughtup" onClick={markCaughtUp}>
                Mark seen
              </button>
            )}
            {!lastSeen && (
              <button className="caughtup" onClick={markCaughtUp}>
                Start tracking
              </button>
            )}
          </div>
        </div>
        <div className="chips">
          <button
            className={'chip review' + (reviewOnly ? ' on' : '')}
            onClick={() => setReviewOnly(!reviewOnly)}
          >
            Needs review
          </button>
          <button
            className={'chip' + (!camFilter ? ' on' : '')}
            onClick={() => setCamFilter(null)}
          >
            All cameras
          </button>
          {camList.map((c) => (
            <button
              key={c.camera_id}
              className={'chip' + (camFilter === c.camera_id ? ' on' : '')}
              onClick={() =>
                setCamFilter(camFilter === c.camera_id ? null : c.camera_id)
              }
            >
              {c.name || c.camera_id}
              {c.shared ? ' ↗' : ''}
            </button>
          ))}
        </div>
      </header>

      <main className="feed">
        {loading && <div className="spinner">Loading photos…</div>}
        {!loading && photos.length === 0 && (
          <div className="empty">
            No photos here yet.
            <br />
            The sync runs hourly — check back after the next pass.
          </div>
        )}
        {groups.map((g) => (
          <section key={g.label + g.items[0]}>
            <div className="day">{g.label}</div>
            <div className="grid">
              {g.items.map((i) => {
                const p = photos[i]
                const src = urls[p.thumb_path || p.storage_path]
                const isNew = lastSeen && p.taken_at > lastSeen
                const tagline = (p.tags || []).join(' · ')
                const isBuck = (p.tags || []).includes('Buck')
                return (
                  <button key={p.photo_name} className="cell" onClick={() => setViewing(i)}>
                    {src ? <img src={src} alt="" loading="lazy" /> : null}
                    {isNew && <span className="dot" />}
                    {tagline && (
                      <span className={'tagline' + (isBuck ? ' buck' : '')}>{tagline}</span>
                    )}
                  </button>
                )
              })}
            </div>
          </section>
        ))}
        {!loading && hasMore && (
          <button className="loadmore" onClick={loadMore}>
            Load more
          </button>
        )}
      </main>

      {viewing !== null && photos[viewing] && (
        <PhotoViewer
          photo={photos[viewing]}
          camera={cameras[photos[viewing].camera_id]}
          onClose={() => setViewing(null)}
          onPrev={viewing > 0 ? () => setViewing(viewing - 1) : null}
          onNext={viewing < photos.length - 1 ? () => setViewing(viewing + 1) : null}
          onSaved={onSaved}
        />
      )}
    </>
  )
}
