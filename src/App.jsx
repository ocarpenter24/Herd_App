import { useEffect, useState } from 'react'
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

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    supabase
      .from('buck_match_suggestions')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count }) => setPending(count || 0))
  }, [session, tab])

  if (session === undefined) return <div className="spinner">Loading…</div>
  if (!session) return <Login />

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/icon-192.png" alt="" />
          <span className="wordmark">Herd</span>
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
      </aside>

      <div className="main">
        <div style={{ display: tab === 'feed' ? 'contents' : 'none' }}>
          <Feed />
        </div>
        {tab === 'bucks' && <Bucks />}
        {tab === 'map' && <MapPage />}
      </div>

      <nav className="mobiletabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? 'on' : ''}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}
