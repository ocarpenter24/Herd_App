import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from './supabase.js'
import PhotoViewer from './PhotoViewer.jsx'

const PAGE = 80
const LAST_SEEN_KEY = 'herd_last_seen'

function dayLabel(iso) {
  const d = new Date(iso)
  const today = new Date()
  const yest = new Date(today)
  yest.setDate(today.getDate() - 1)
  const same = (a, b) => a.toDateString() === b.toDateString()
  if (same(d, today)) return 'Today'
  if (same(d, yest)) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

export default function Feed() {
  const [cameras, setCameras] = useState({})
  const [photos, setPhotos] = useState([])
  const [urls, setUrls] = useState({})
  const [camFilter, setCamFilter] = useState([])
  const [reviewOnly, setReviewOnly] = useState(false)
  const [sugOnly, setSugOnly] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [newCount, setNewCount] = useState(0)
  const [viewing, setViewing] = useState(null)
  const lastSeenRef = useRef(localStorage.getItem(LAST_SEEN_KEY))

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
      const cols =
        'photo_name,camera_id,taken_at,thumb_path,storage_path,tags,reviewed,battery,signal'
      let q = supabase
        .from('reveal_photos')
        .select(sugOnly ? cols + ',buck_match_suggestions!inner(id)' : cols)
        .order('taken_at', { ascending: false })
        .range(offset, offset + PAGE - 1)
      if (camFilter.length) q = q.in('camera_id', camFilter)
      if (reviewOnly) q = q.eq('reviewed', false)
      if (sugOnly) q = q.eq('buck_match_suggestions.status', 'pending')
      const { data, error } = await q
      if (error) {
        console.error(error)
        return []
      }
      return data || []
    },
    [camFilter, reviewOnly, sugOnly]
  )

  const signPaths = useCallback(async (rows) => {
    const paths = rows.map((p) => p.thumb_path || p.storage_path).filter(Boolean)
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

  useEffect(() => {
    let alive = true
    setLoading(true)
    setPhotos([])
    setHasMore(true)
    fetchPage(0).then((rows) => {
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

  const groups = useMemo(() => {
    const out = []
    let cur = null
    for (let i = 0; i < photos.length; i++) {
      const label = photos[i].taken_at ? dayLabel(photos[i].taken_at) : 'Undated'
      if (label !== cur) {
        out.push({ label, items: [] })
        cur = label
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
      <header className="pagehead">
        <h2>Feed</h2>
        <div className="chiprow">
          <button
            className={'chip accent' + (reviewOnly ? ' on' : '')}
            onClick={() => setReviewOnly(!reviewOnly)}
          >
            Needs review
          </button>
          <button
            className={'chip accent' + (sugOnly ? ' on' : '')}
            onClick={() => setSugOnly(!sugOnly)}
          >
            Buck matches
          </button>
          <button
            className={'chip' + (camFilter.length === 0 ? ' on' : '')}
            onClick={() => setCamFilter([])}
          >
            All cameras
          </button>
          {camList.map((c) => (
            <button
              key={c.camera_id}
              className={'chip' + (camFilter.includes(c.camera_id) ? ' on' : '')}
              onClick={() =>
                setCamFilter((f) =>
                  f.includes(c.camera_id)
                    ? f.filter((x) => x !== c.camera_id)
                    : [...f, c.camera_id]
                )
              }
            >
              {c.name || c.camera_id}
              {c.shared ? ' ↗' : ''}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className={'newnote' + (newCount ? '' : ' zero')}>
          {lastSeen ? (newCount ? `${newCount} new` : 'Caught up') : ''}
        </span>
        {(newCount > 0 || !lastSeen) && (
          <button className="btn sm" onClick={markCaughtUp}>
            {lastSeen ? 'Mark seen' : 'Start tracking'}
          </button>
        )}
      </header>

      <main className="content">
        {loading && <div className="spinner">Loading photos…</div>}
        {!loading && photos.length === 0 && (
          <div className="empty">Nothing here — the sync runs every 15 minutes.</div>
        )}
        {groups.map((g) => (
          <section key={g.label + g.items[0]}>
            <div className="dayhead">{g.label}</div>
            <div className="grid">
              {g.items.map((i) => {
                const p = photos[i]
                const src = urls[p.thumb_path || p.storage_path]
                const isNew = lastSeen && p.taken_at > lastSeen
                const tagline = (p.tags || []).join(' · ')
                const isBuck = (p.tags || []).includes('Buck')
                return (
                  <button key={p.camera_id + p.photo_name} className="cell" onClick={() => setViewing(i)}>
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
          <button className="btn loadmore" onClick={loadMore}>
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
