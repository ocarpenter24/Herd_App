import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import Login from './Login.jsx'
import Feed from './Feed.jsx'
import Bucks from './Bucks.jsx'
import MapPage from './MapPage.jsx'

const TABS = [
  { id: 'feed', label: 'Feed' },
  { id: 'bucks', label: 'Bucks' },
  { id: 'map', label: 'Map' },
]

export default function App() {
  const [session, setSession] = useState(undefined)
  const [tab, setTab] = useState('feed')
  const [pending, setPending] = useState(0)
  const [cameras, setCameras] = useState([])
  const [camFilter, setCamFilter] = useState([])
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const loadCameras = useCallback(async () => {
    const { data } = await supabase
      .from('reveal_cameras')
      .select('camera_id,name,shared,enabled')
      .order('name')
    setCameras(data || [])
  }, [])

  useEffect(() => {
    if (session) loadCameras()
  }, [session, loadCameras])

  useEffect(() => {
    if (!session) return
    supabase
      .from('buck_match_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPending(count || 0))
  }, [session, tab])

  async function toggleCamera(cam) {
    const next = cam.enabled === false
    setCameras((cs) =>
      cs.map((c) => (c.camera_id === cam.camera_id ? { ...c, enabled: next } : c))
    )
    if (!next) setCamFilter((f) => f.filter((id) => id !== cam.camera_id))
    await supabase
      .from('reveal_cameras')
      .update({ enabled: next })
      .eq('camera_id', cam.camera_id)
  }

  if (session === undefined) return <div className="spinner">Loading…</div>
  if (!session) return <Login />

  const enabledCams = cameras.filter((c) => c.enabled !== false)

  function toggleFilter(id) {
    setCamFilter((f) => (f.includes(id) ? f.filter((x) => x !== id) : [...f, id]))
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/icon-192.png" alt="" />
          <span className="wordmark">Herd</span>
          <button
            className="gear"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
            aria-label="Settings"
          >
            ⚙
          </button>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            className={'navitem' + (tab === t.id ? ' on' : '')}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'bucks' && pending > 0 && <span className="count">{pending}</span>}
          </button>
        ))}

        <div className="sidecams">
          <div className="seghead" style={{ padding: '14px 10px 4px' }}>
            Cameras
          </div>
          {enabledCams.map((c) => {
            const on = camFilter.includes(c.camera_id)
            return (
              <button
                key={c.camera_id}
                className={'camfilter' + (on ? ' on' : '')}
                onClick={() => toggleFilter(c.camera_id)}
              >
                <span className="camdot" />
                <span className="camlbl">
                  {c.name || c.camera_id}
                  {c.shared ? ' ↗' : ''}
                </span>
              </button>
            )
          })}
        </div>
      </aside>

      <div className="main">
        <div style={{ display: tab === 'feed' ? 'contents' : 'none' }}>
          <Feed
            cameras={cameras}
            camFilter={camFilter}
            setCamFilter={setCamFilter}
            toggleFilter={toggleFilter}
          />
        </div>
        {tab === 'bucks' && <Bucks />}
        {tab === 'map' && <MapPage />}
      </div>

      <nav className="mobiletabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {settingsOpen && (
        <div className="modalwrap" onClick={() => setSettingsOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modalhead">
              <h3>Settings</h3>
              <button className="close" onClick={() => setSettingsOpen(false)}>
                ✕
              </button>
            </div>
            <div className="modalbody">
              <h4 className="seghead">Cameras</h4>
              <p className="settinghint">
                Toggled-off cameras are hidden from the feed and the sidebar. Their photos
                keep syncing in the background.
              </p>
              {cameras.map((c) => (
                <label key={c.camera_id} className="switchrow">
                  <span>
                    {c.name || c.camera_id}
                    {c.shared ? ' ↗' : ''}
                  </span>
                  <input
                    type="checkbox"
                    checked={c.enabled !== false}
                    onChange={() => toggleCamera(c)}
                  />
                  <span className="switch" />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
