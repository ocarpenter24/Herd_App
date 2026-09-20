import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase.js'

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 0 },
]

const fmtH = (h) => (h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : h - 12 + 'p')
const fmtDay = (d) =>
  new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
const pct = (n, d) => (d ? Math.round((n / d) * 100) : 0)

function periodOf(h) {
  if (h >= 5 && h <= 10) return 'Morning'
  if (h >= 11 && h <= 15) return 'Midday'
  if (h >= 16 && h <= 19) return 'Evening'
  return 'Night'
}

function peakWindow(hours) {
  let best = 0
  let bestStart = 0
  for (let s = 0; s < 24; s++) {
    const sum = hours[s] + hours[(s + 1) % 24] + hours[(s + 2) % 24]
    if (sum > best) {
      best = sum
      bestStart = s
    }
  }
  if (!best) return '—'
  return `${fmtH(bestStart)}–${fmtH((bestStart + 3) % 24)}`
}

function HourChart({ rows, single }) {
  const byHour = Array.from({ length: 24 }, (_, h) => {
    const r = rows.find((x) => x.hour === h)
    return { hour: h, deer: r?.deer || 0, bucks: r?.bucks || 0 }
  })
  const max = Math.max(1, ...byHour.map((r) => (single ? r.bucks : r.deer)))
  const W = 720
  const H = 150
  const bottom = H - 18
  const bw = (W - 16) / 24
  const scale = (bottom - 10) / max
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {byHour.map((r) => {
        const x = 8 + r.hour * bw
        const dh = (single ? r.bucks : r.deer) * scale
        const bh = r.bucks * scale
        return (
          <g key={r.hour}>
            <title>{`${fmtH(r.hour)} — ${r.deer} deer, ${r.bucks} buck`}</title>
            {!single && (
              <rect x={x + 1.5} y={bottom - dh} width={bw - 3} height={dh}
                fill="var(--line-strong)" rx="2" />
            )}
            <rect x={x + 1.5} y={bottom - bh} width={bw - 3} height={bh}
              fill="var(--accent)" rx="2" />
          </g>
        )
      })}
      {[0, 6, 12, 18, 23].map((h) => (
        <text key={h} x={8 + h * bw + bw / 2} y={H - 5} textAnchor="middle"
          fontSize="10" fill="var(--faint)">
          {fmtH(h)}
        </text>
      ))}
    </svg>
  )
}

function DailyChart({ rows }) {
  if (!rows.length) return null
  const max = Math.max(1, ...rows.map((r) => r.deer))
  const W = 720
  const H = 150
  const bottom = H - 18
  const bw = (W - 16) / rows.length
  const scale = (bottom - 10) / max
  const labelIdx = new Set(
    [0, Math.floor(rows.length / 2), rows.length - 1].filter((v, i, a) => a.indexOf(v) === i)
  )
  return (
    <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img">
      {rows.map((r, i) => {
        const x = 8 + i * bw
        return (
          <g key={r.day}>
            <title>{`${fmtDay(r.day)} — ${r.deer} deer, ${r.bucks} buck (${pct(r.bucks, r.deer)}% buck)`}</title>
            <rect x={x + 0.5} y={bottom - r.deer * scale} width={Math.max(1, bw - 1)}
              height={r.deer * scale} fill="var(--line-strong)" rx="1.5" />
            <rect x={x + 0.5} y={bottom - r.bucks * scale} width={Math.max(1, bw - 1)}
              height={r.bucks * scale} fill="var(--accent)" rx="1.5" />
          </g>
        )
      })}
      {rows.map((r, i) =>
        labelIdx.has(i) ? (
          <text key={r.day} x={8 + i * bw + bw / 2} y={H - 5} textAnchor="middle"
            fontSize="10" fill="var(--faint)">
            {fmtDay(r.day)}
          </text>
        ) : null
      )}
    </svg>
  )
}

export default function Data({ cameras }) {
  const [days, setDays] = useState(30)
  const [totals, setTotals] = useState(null)
  const [hourly, setHourly] = useState([])
  const [daily, setDaily] = useState([])
  const [byCam, setByCam] = useState([])
  const [bucks, setBucks] = useState([])
  const [sightings, setSightings] = useState([])
  const [sel, setSel] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true)
    Promise.all([
      supabase.rpc('stats_totals', { p_days: days }),
      supabase.rpc('stats_hourly', { p_days: days }),
      supabase.rpc('stats_daily', { p_days: days }),
      supabase.rpc('stats_by_camera', { p_days: days }),
    ]).then(([t, h, d, c]) => {
      if (!alive) return
      setTotals(t.data?.[0] || null)
      setHourly(h.data || [])
      setDaily(d.data || [])
      setByCam(c.data || [])
      setLoading(false)
    })
    return () => {
      alive = false
    }
  }, [days])

  useEffect(() => {
    supabase.from('bucks').select('id,name,status').order('name')
      .then(({ data }) => setBucks(data || []))
    supabase.from('buck_sightings').select('buck_id,camera_id,reveal_photos(taken_at)')
      .then(({ data }) => setSightings(data || []))
  }, [days])

  const camName = useMemo(() => {
    const m = {}
    for (const c of cameras) m[c.camera_id] = c.name || c.camera_id
    return m
  }, [cameras])

  const buckStats = useMemo(() => {
    const cutoff = days === 0 ? null : Date.now() - days * 86400000
    const per = {}
    for (const s of sightings) {
      const iso = s.reveal_photos?.taken_at
      if (!iso) continue
      const t = new Date(iso)
      if (cutoff && t.getTime() < cutoff) continue
      const st = (per[s.buck_id] ||= {
        n: 0, hours: Array(24).fill(0), cams: {}, periods: {}, last: null,
      })
      st.n++
      st.hours[t.getHours()]++
      st.cams[s.camera_id] = (st.cams[s.camera_id] || 0) + 1
      const p = periodOf(t.getHours())
      st.periods[p] = (st.periods[p] || 0) + 1
      if (!st.last || t > st.last) st.last = t
    }
    return per
  }, [sightings, days])

  const selStats = sel !== 'all' ? buckStats[sel] : null
  const selBuck = bucks.find((b) => b.id === sel)

  function rowFor(b) {
    const st = buckStats[b.id]
    if (!st) return null
    const topPeriod = Object.entries(st.periods).sort((a, z) => z[1] - a[1])[0]
    const topCam = Object.entries(st.cams).sort((a, z) => z[1] - a[1])[0]
    return {
      id: b.id, name: b.name, status: b.status, n: st.n,
      mostly: topPeriod ? `${topPeriod[0]} ${pct(topPeriod[1], st.n)}%` : '—',
      peak: peakWindow(st.hours),
      cam: topCam ? camName[topCam[0]] || topCam[0] : '—',
      last: st.last
        ? st.last.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : '—',
    }
  }

  return (
    <>
      <header className="pagehead">
        <h2>Data</h2>
        <div className="chiprow">
          {RANGES.map((r) => (
            <button key={r.label}
              className={'chip' + (days === r.days ? ' on' : '')}
              onClick={() => setDays(r.days)}>
              {r.label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <span className="legend">
          <i className="sw dim" /> deer <i className="sw hot" /> buck
        </span>
      </header>

      <main className="content">
        {loading && <div className="spinner">Crunching…</div>}
        {!loading && totals && (
          <>
            <section className="datasec">
              <div className="statrow">
                <div className="stat"><b>{totals.photos.toLocaleString()}</b><span>Photos</span></div>
                <div className="stat"><b>{totals.deer.toLocaleString()}</b><span>Deer</span></div>
                <div className="stat"><b>{totals.bucks.toLocaleString()}</b><span>Buck photos</span></div>
                <div className="stat"><b>{totals.does.toLocaleString()}</b><span>Doe</span></div>
                <div className="stat"><b>{totals.fawns.toLocaleString()}</b><span>Fawn</span></div>
                <div className="stat"><b>{pct(totals.bucks, totals.deer)}%</b><span>Buck share</span></div>
                {totals.turkeys > 0 && (
                  <div className="stat"><b>{totals.turkeys}</b><span>Turkey</span></div>
                )}
                {totals.hogs > 0 && (
                  <div className="stat"><b>{totals.hogs}</b><span>Hog</span></div>
                )}
              </div>
            </section>

            <section className="datasec">
              <h3 className="seghead">Deer activity by time of day</h3>
              <HourChart rows={hourly} />
            </section>

            <section className="datasec">
              <h3 className="seghead">Activity by day — watch the orange share climb toward the rut</h3>
              <DailyChart rows={daily} />
            </section>

            <section className="datasec">
              <h3 className="seghead">Cameras</h3>
              <div className="tscroll">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Camera</th><th>Photos</th><th>Deer</th><th>Bucks</th><th>Buck rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {byCam.map((c) => (
                      <tr key={c.camera_id}>
                        <td className="primarycell">{c.name || c.camera_id}{c.shared ? ' ↗' : ''}</td>
                        <td className="mutedcell">{c.photos.toLocaleString()}</td>
                        <td>{c.deer.toLocaleString()}</td>
                        <td style={{ color: 'var(--accent)', fontWeight: 600 }}>{c.bucks.toLocaleString()}</td>
                        <td className="mutedcell">{pct(c.bucks, c.deer)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="datasec">
              <h3 className="seghead">Buck patterns — confirmed sightings only</h3>
              <div className="chiprow" style={{ marginBottom: 12 }}>
                <button className={'chip' + (sel === 'all' ? ' on' : '')} onClick={() => setSel('all')}>
                  All bucks
                </button>
                {bucks.map((b) => (
                  <button key={b.id}
                    className={'chip' + (sel === b.id ? ' accent on' : '')}
                    onClick={() => setSel(b.id)}>
                    {b.name}
                  </button>
                ))}
              </div>

              {sel === 'all' && (
                <div className="tscroll">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Buck</th><th>Sightings</th><th>Mostly seen</th>
                        <th>Peak hours</th><th>Top camera</th><th>Last seen</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bucks.map((b) => {
                        const r = rowFor(b)
                        if (!r) return (
                          <tr key={b.id} className="row" onClick={() => setSel(b.id)}>
                            <td className="primarycell">{b.name}</td>
                            <td className="mutedcell" colSpan={5}>No confirmed sightings in this range</td>
                          </tr>
                        )
                        return (
                          <tr key={b.id} className="row" onClick={() => setSel(b.id)}>
                            <td className="primarycell">{r.name}</td>
                            <td>{r.n}</td>
                            <td>{r.mostly}</td>
                            <td>{r.peak}</td>
                            <td>{r.cam}</td>
                            <td className="mutedcell">{r.last}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {sel !== 'all' && selStats && (
                <>
                  <p className="insight">
                    {selStats.n} confirmed sightings · {pct(selStats.periods['Night'] || 0, selStats.n)}% night ·
                    peak {peakWindow(selStats.hours)} · last seen{' '}
                    {selStats.last?.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </p>
                  <HourChart
                    rows={selStats.hours.map((n, hour) => ({ hour, deer: n, bucks: n }))}
                    single
                  />
                  <div style={{ marginTop: 14 }}>
                    {Object.entries(selStats.cams)
                      .sort((a, z) => z[1] - a[1])
                      .map(([cid, n]) => (
                        <div key={cid} className="cambar">
                          <span className="lbl">{camName[cid] || cid}</span>
                          <span className="bar"
                            style={{ width: `${Math.max(4, (n / selStats.n) * 100)}%` }} />
                          <span className="n">{n} · {pct(n, selStats.n)}%</span>
                        </div>
                      ))}
                  </div>
                </>
              )}
              {sel !== 'all' && !selStats && (
                <div className="empty">
                  No confirmed sightings for {selBuck?.name} in this range — confirm suggestions
                  in the Feed and his patterns build themselves.
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </>
  )
}
