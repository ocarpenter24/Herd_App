import { useEffect, useState } from 'react'
import { supabase } from './supabase.js'
import Login from './Login.jsx'
import Feed from './Feed.jsx'
import Bucks from './Bucks.jsx'
import MapPage from './MapPage.jsx'

export default function App() {
  const [session, setSession] = useState(undefined)
  const [tab, setTab] = useState('feed')

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <div className="spinner">Loading…</div>
  if (!session) return <Login />

  return (
    <>
      <div style={{ display: tab === 'feed' ? 'block' : 'none' }}>
        <Feed />
      </div>
      {tab === 'bucks' && <Bucks />}
      {tab === 'map' && <MapPage />}

      <nav className="tabbar">
        <button className={tab === 'feed' ? 'on' : ''} onClick={() => setTab('feed')}>
          <span className="ico">▤</span>Feed
        </button>
        <button className={tab === 'bucks' ? 'on' : ''} onClick={() => setTab('bucks')}>
          <span className="ico">⑂</span>Bucks
        </button>
        <button className={tab === 'map' ? 'on' : ''} onClick={() => setTab('map')}>
          <span className="ico">◎</span>Map
        </button>
      </nav>
    </>
  )
}
