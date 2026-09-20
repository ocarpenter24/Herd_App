import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase.js'

const LEAFLET_JS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
const LEAFLET_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
const ESRI_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve(window.L)
    const css = document.createElement('link')
    css.rel = 'stylesheet'
    css.href = LEAFLET_CSS
    document.head.appendChild(css)
    const s = document.createElement('script')
    s.src = LEAFLET_JS
    s.onload = () => resolve(window.L)
    s.onerror = reject
    document.head.appendChild(s)
  })
}

const toYd = (mtr) => Math.round(mtr * 1.09361)

function haversine(a, b) {
  const R = 6371000
  const dLa = ((b[0] - a[0]) * Math.PI) / 180
  const dLo = ((b[1] - a[1]) * Math.PI) / 180
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const h =
    Math.sin(dLa / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLo / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

function bearingDeg(a, b) {
  const la1 = (a[0] * Math.PI) / 180
  const la2 = (b[0] * Math.PI) / 180
  const dLo = ((b[1] - a[1]) * Math.PI) / 180
  const y = Math.sin(dLo) * Math.cos(la2)
  const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLo)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

const HOP_MAX_HOURS = 24
const DAY_START = 6   // "daylight" = 6:00a-6:59p local; rough shooting light
const DAY_END = 19
const isDayHour = (h) => h >= DAY_START && h < DAY_END

// local meter projection for curves/areas (fine at property scale)
function projector(origin) {
  const kx = 111320 * Math.cos((origin[0] * Math.PI) / 180)
  const ky = 110540
  return {
    to: (p) => [(p[1] - origin[1]) * kx, (p[0] - origin[0]) * ky],
    from: (xy) => [origin[0] + xy[1] / ky, origin[1] + xy[0] / kx],
  }
}

// curved path a->b bowing right of travel, so opposite directions separate
function curvePoints(a, b) {
  const proj = projector(a)
  const [x2, y2] = proj.to(b)
  const d = Math.hypot(x2, y2)
  if (d < 15) return null
  const off = Math.min(70, Math.max(18, d * 0.16))
  const cx = x2 / 2 + (y2 / d) * off
  const cy = y2 / 2 - (x2 / d) * off
  const pts = []
  for (let i = 0; i <= 20; i++) {
    const t = i / 20
    const mt = 1 - t
    pts.push(proj.from([
      mt * mt * 0 + 2 * mt * t * cx + t * t * x2,
      mt * mt * 0 + 2 * mt * t * cy + t * t * y2,
    ]))
  }
  return pts
}

function convexHull(points) {
  if (points.length < 3) return null
  const pts = [...points].sort((a, z) => a[1] - z[1] || a[0] - z[0])
  const cross = (o, a, b) =>
    (a[1] - o[1]) * (b[0] - o[0]) - (a[0] - o[0]) * (b[1] - o[1])
  const lower = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop()
    lower.push(p)
  }
  const upper = []
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop()
    upper.push(p)
  }
  const hull = [...lower.slice(0, -1), ...upper.slice(0, -1)]
  return hull.length >= 3 ? hull : null
}

function hullAcres(hull) {
  const proj = projector(hull[0])
  const xy = hull.map(proj.to)
  let s = 0
  for (let i = 0; i < xy.length; i++) {
    const [x1, y1] = xy[i]
    const [x2, y2] = xy[(i + 1) % xy.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s / 2) / 4046.86
}

const DAY_ROUTE = '#e5a440'
const NIGHT_ROUTE = '#6d93ad'
const MIX_ROUTE = '#9aa39a'
const hopWhen = (h) => {
  const e = Object.entries(h.periods).sort((a, z) => z[1] - a[1])
  if (!e.length) return ''
  return e.length === 1 || e[0][1] > h.n / 2 ? e[0][0] : e[0][0] + '+'
}
const routeColor = (h) =>
  h.dayN === h.nightN ? MIX_ROUTE : h.dayN > h.nightN ? DAY_ROUTE : NIGHT_ROUTE

// Point `dist` meters from (lat,lng) at compass bearing `deg`
function destPoint(lat, lng, deg, dist) {
  const R = 6371000
  const br = (deg * Math.PI) / 180
  const la1 = (lat * Math.PI) / 180
  const lo1 = (lng * Math.PI) / 180
  const la2 = Math.asin(
    Math.sin(la1) * Math.cos(dist / R) + Math.cos(la1) * Math.sin(dist / R) * Math.cos(br)
  )
  const lo2 =
    lo1 +
    Math.atan2(
      Math.sin(br) * Math.sin(dist / R) * Math.cos(la1),
      Math.cos(dist / R) - Math.sin(la1) * Math.sin(la2)
    )
  return [(la2 * 180) / Math.PI, (lo2 * 180) / Math.PI]
}

const YD = 0.9144 // yards -> meters
const DEFAULT_DIST = 150 // yards
const DEFAULT_FOV = 64 // degrees

function coneLatLngs(lat, lng, facing, fovDeg, distYd) {
  const half = fovDeg / 2
  const dist = distYd * YD
  const pts = [[lat, lng]]
  const step = Math.max(4, half / 5)
  for (let a = facing - half; a <= facing + half + 0.01; a += step) {
    pts.push(destPoint(lat, lng, a, dist))
  }
  pts.push([lat, lng])
  return pts
}

export default function MapPage() {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const layerRef = useRef(null)
  const draftRef = useRef(null)
  const fitKeyRef = useRef(null)
  const [ready, setReady] = useState(false)
  const [cameras, setCameras] = useState([])
  const [properties, setProperties] = useState([])
  const [propFilter, setPropFilter] = useState(null)
  const [draft, setDraft] = useState(null) // {camera_id, pin_lat, pin_lng, facing_deg, property_id}
  const [newProp, setNewProp] = useState('')
  const [addingProp, setAddingProp] = useState(false)
  const [bucks, setBucks] = useState([])
  const [sightings, setSightings] = useState([])
  const [selBuck, setSelBuck] = useState(null)
  const [timeFilter, setTimeFilter] = useState('all') // all | day | night
  const [showTrail, setShowTrail] = useState(true)

  draftRef.current = draft

  const load = useCallback(async () => {
    const [{ data: cams }, { data: props }] = await Promise.all([
      supabase
        .from('reveal_cameras')
        .select('camera_id,name,shared,pin_lat,pin_lng,facing_deg,cone_dist,cone_spread,property_id')
        .order('name'),
      supabase.from('properties').select('id,name').order('name'),
    ])
    setCameras(cams || [])
    setProperties(props || [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Init map once
  useEffect(() => {
    let dead = false
    loadLeaflet().then((L) => {
      if (dead || mapRef.current) return
      const map = L.map(mapEl.current, { zoomControl: true }).setView([32.9, -87.5], 8)
      L.tileLayer(ESRI_TILES, {
        maxZoom: 19,
        attribution: 'Imagery © Esri',
      }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      map.on('click', (e) => {
        const d = draftRef.current
        if (!d) return
        setDraft({ ...d, pin_lat: e.latlng.lat, pin_lng: e.latlng.lng })
      })
      mapRef.current = map
      setReady(true)
    })
    return () => {
      dead = true
      if (mapRef.current) {
        mapRef.current.remove()
        mapRef.current = null
      }
    }
  }, [])

  // Redraw markers on data / filter / draft change
  useEffect(() => {
    supabase.from('bucks').select('id,name,status').order('name')
      .then(({ data }) => setBucks(data || []))
    supabase.from('buck_sightings').select('buck_id,camera_id,reveal_photos(taken_at)')
      .then(({ data }) => setSightings(data || []))
  }, [])

  // Selected buck's travel picture: visits + hops from the time-filtered
  // sightings; cadence/daylight-trend/core always from ALL sightings.
  function buckTravel(buckId, filter) {
    const camPos = {}
    for (const c of cameras)
      if (c.pin_lat != null) camPos[c.camera_id] = [c.pin_lat, c.pin_lng]
    const all = sightings
      .filter((s) => s.buck_id === buckId && s.reveal_photos?.taken_at)
      .map((s) => ({ cam: s.camera_id, t: new Date(s.reveal_photos.taken_at) }))
      .sort((a, z) => a.t - z.t)

    const seq = all.filter((s) => {
      if (filter === 'day') return isDayHour(s.t.getHours())
      if (filter === 'night') return !isDayHour(s.t.getHours())
      return true
    })

    const visits = {}
    let unpinned = 0
    for (const s of seq) {
      visits[s.cam] = (visits[s.cam] || 0) + 1
      if (!camPos[s.cam]) unpinned++
    }

    const stops = []
    for (const s of seq) {
      const last = stops[stops.length - 1]
      if (last && last.cam === s.cam) last.t = s.t
      else stops.push({ ...s })
    }
    const hops = {}
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1]
      const b = stops[i]
      if (!camPos[a.cam] || !camPos[b.cam]) continue
      if (b.t - a.t > HOP_MAX_HOURS * 3600 * 1000) continue
      const key = a.cam + '>' + b.cam
      const h = (hops[key] = hops[key] || {
        from: a.cam, to: b.cam, n: 0, dayN: 0, nightN: 0, periods: {},
        dist: haversine(camPos[a.cam], camPos[b.cam]),
      })
      h.n++
      const hr = b.t.getHours()
      isDayHour(hr) ? h.dayN++ : h.nightN++
      const per = hr >= 5 && hr <= 10 ? 'Morning' : hr >= 11 && hr <= 15
        ? 'Midday' : hr >= 16 && hr <= 19 ? 'Evening' : 'Night'
      h.periods[per] = (h.periods[per] || 0) + 1
    }

    // recent trail: last pinned stops (of the filtered network)
    const pinnedStops = stops.filter((s) => camPos[s.cam])
    const trail = pinnedStops.slice(-6)

    // ---- stats from ALL sightings ----
    const dayKeys = [...new Set(all.map((s) => s.t.toDateString()))]
    let cadence = null
    if (dayKeys.length >= 3) {
      const times = dayKeys.map((d) => new Date(d).getTime()).sort((a, z) => a - z)
      const span = (times[times.length - 1] - times[0]) / 86400000
      cadence = span / (dayKeys.length - 1)
    }
    const daysSince = all.length
      ? (Date.now() - all[all.length - 1].t.getTime()) / 86400000
      : null

    const cut = Date.now() - 14 * 86400000
    const recent = all.filter((s) => s.t.getTime() >= cut)
    const older = all.filter((s) => s.t.getTime() < cut)
    const dayPct = (arr) =>
      arr.length ? Math.round((arr.filter((s) => isDayHour(s.t.getHours())).length / arr.length) * 100) : null
    const trend =
      recent.length >= 4 && older.length >= 4
        ? { now: dayPct(recent), was: dayPct(older) }
        : { overall: dayPct(all) }

    const visitedPins = Object.keys(visits).filter((c) => camPos[c]).map((c) => camPos[c])
    let maxRange = 0
    for (let i = 0; i < visitedPins.length; i++)
      for (let j = i + 1; j < visitedPins.length; j++)
        maxRange = Math.max(maxRange, haversine(visitedPins[i], visitedPins[j]))
    const hull = convexHull(visitedPins)
    const acres = hull ? hullAcres(hull) : null

    return { visits, hops: Object.values(hops), camPos, maxRange, unpinned,
      total: seq.length, allTotal: all.length, trail, cadence, daysSince,
      trend, hull, acres }
  }

  useEffect(() => {
    if (!ready || !layerRef.current) return
    const L = window.L
    const layer = layerRef.current
    layer.clearLayers()

    const shown = cameras.filter((c) => !propFilter || c.property_id === propFilter)
    const bounds = []
    const travel = selBuck && !draft ? buckTravel(selBuck, timeFilter) : null
    for (const c of shown) {
      const isDraft = draft && draft.camera_id === c.camera_id
      const lat = isDraft ? draft.pin_lat : c.pin_lat
      const lng = isDraft ? draft.pin_lng : c.pin_lng
      const facing = isDraft ? draft.facing_deg : c.facing_deg
      const dist = (isDraft ? draft.cone_dist : c.cone_dist) ?? DEFAULT_DIST
      const fov = (isDraft ? draft.cone_spread : c.cone_spread) ?? DEFAULT_FOV
      if (lat == null || lng == null) continue
      const visitN = travel ? travel.visits[c.camera_id] || 0 : null
      if (travel && !visitN) {
        // cameras this buck hasn't hit: dim, no cone
        L.circleMarker([lat, lng], {
          radius: 5, color: '#101512', weight: 1,
          fillColor: '#5d645c', fillOpacity: 0.55,
        })
          .bindTooltip(c.name || c.camera_id, { direction: 'top', offset: [0, -8] })
          .on('click', () => startEdit(c))
          .addTo(layer)
        continue
      }
      bounds.push([lat, lng])
      if (!travel && facing != null) {
        L.polygon(coneLatLngs(lat, lng, Number(facing), Number(fov), Number(dist)), {
          color: '#e56b1f',
          weight: 1,
          fillColor: '#e56b1f',
          fillOpacity: 0.22,
        }).addTo(layer)
      }
      L.circleMarker([lat, lng], {
        radius: travel ? Math.min(14, 7 + visitN) : 7,
        color: isDraft ? '#ffffff' : '#101512',
        weight: 2,
        fillColor: '#e56b1f',
        fillOpacity: 1,
      })
        .bindTooltip(
          travel
            ? `${c.name || c.camera_id} · ${visitN}`
            : c.name || c.camera_id,
          travel
            ? { permanent: true, direction: 'right', offset: [10, 0], className: 'pinlbl' }
            : { direction: 'top', offset: [0, -8] }
        )
        .on('click', () => startEdit(c))
        .addTo(layer)
    }

    if (travel) {
      // core area under everything
      if (travel.hull) {
        L.polygon(travel.hull, {
          color: '#e56b1f', weight: 1, opacity: 0.35,
          fillColor: '#e56b1f', fillOpacity: 0.07, dashArray: '4 6',
          interactive: false,
        }).addTo(layer)
      }
      for (const h of travel.hops) {
        const a = travel.camPos[h.from]
        const b = travel.camPos[h.to]
        if (!a || !b) continue
        const pts = curvePoints(a, b)
        if (!pts) continue
        const col = routeColor(h)
        const when = hopWhen(h)
        L.polyline(pts, {
          color: col, weight: Math.min(7, 1.5 + h.n * 1.2),
          opacity: 0.8, dashArray: h.n === 1 ? '6 6' : null,
        })
          .bindTooltip(`${h.n}× this direction · ${toYd(h.dist)} yd · ${when}`,
            { sticky: true })
          .addTo(layer)
        const rot = bearingDeg(pts[17], pts[19]) - 90
        L.marker(pts[18], {
          interactive: false,
          icon: L.divIcon({
            className: 'hoparrow',
            html: `<span style="transform:rotate(${rot}deg);color:${col}">➤</span>`,
            iconSize: [18, 18], iconAnchor: [9, 9],
          }),
        }).addTo(layer)
      }
      // recent trail: numbered latest stops over the aggregate
      if (showTrail && travel.trail.length >= 2) {
        const t = travel.trail
        L.polyline(t.map((s) => travel.camPos[s.cam]), {
          color: '#e7e5df', weight: 2, opacity: 0.9, dashArray: '2 5',
          interactive: false,
        }).addTo(layer)
        t.forEach((s, i) => {
          L.marker(travel.camPos[s.cam], {
            icon: L.divIcon({
              className: 'trailnum',
              html: `<b>${i + 1}</b>`,
              iconSize: [16, 16], iconAnchor: [8, 22],
            }),
          })
            .bindTooltip(
              `#${i + 1} · ${s.t.toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
              })}`,
              { direction: 'top', offset: [0, -14] }
            )
            .addTo(layer)
        })
      }
    }
    const fitKey = (propFilter || 'all') + '|' + (selBuck || '')
    if (bounds.length && !draft && fitKeyRef.current !== fitKey) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
      fitKeyRef.current = fitKey
    }
  }, [ready, cameras, propFilter, draft, selBuck, sightings, timeFilter, showTrail]) // eslint-disable-line

  const camLabel = (id) => {
    const c = cameras.find((x) => x.camera_id === id)
    return c?.name || id
  }

  function startEdit(c) {
    setSelBuck(null)
    setDraft({
      camera_id: c.camera_id,
      name: c.name,
      pin_lat: c.pin_lat,
      pin_lng: c.pin_lng,
      facing_deg: c.facing_deg,
      cone_dist: c.cone_dist,
      cone_spread: c.cone_spread,
      property_id: c.property_id,
    })
  }

  async function saveDraft() {
    const d = draft
    await supabase
      .from('reveal_cameras')
      .update({
        pin_lat: d.pin_lat,
        pin_lng: d.pin_lng,
        facing_deg: d.facing_deg,
        cone_dist: d.cone_dist,
        cone_spread: d.cone_spread,
        property_id: d.property_id,
      })
      .eq('camera_id', d.camera_id)
    setDraft(null)
    load()
  }

  async function clearPin() {
    setDraft({ ...draft, pin_lat: null, pin_lng: null, facing_deg: null })
  }

  async function createProperty(e) {
    e.preventDefault()
    const name = newProp.trim()
    if (!name) return
    setNewProp('')
    setAddingProp(false)
    await supabase.from('properties').insert({ name })
    load()
  }

  return (
    <div className="mappage-content">
      <header className="pagehead">
        <h2>Map</h2>
        <div className="chiprow">
          <button
            className={'chip' + (!propFilter ? ' on' : '')}
            onClick={() => setPropFilter(null)}
          >
            All properties
          </button>
          {properties.map((p) => (
            <button
              key={p.id}
              className={'chip' + (propFilter === p.id ? ' on' : '')}
              onClick={() => setPropFilter(propFilter === p.id ? null : p.id)}
            >
              {p.name}
            </button>
          ))}
          <button className="chip" onClick={() => setAddingProp(!addingProp)}>
            + Property
          </button>
        </div>
        {addingProp && (
          <form className="newbuck" style={{ width: 260 }} onSubmit={createProperty}>
            <input
              className="field"
              placeholder="Property name…"
              value={newProp}
              onChange={(e) => setNewProp(e.target.value)}
            />
            <button className="btn primary sm" disabled={!newProp.trim()}>Add</button>
          </form>
        )}
      </header>

      <div className="maplayout">
        <div ref={mapEl} className="map" />
        <aside className="mapside">
        {draft ? (
          <div className="railsec">
            <h3 className="seghead">Camera setup</h3>
            <div style={{ fontWeight: 600 }}>{draft.name || draft.camera_id}</div>
            {draft.pin_lat == null && (
              <div className="hintline">Click the map to drop the pin</div>
            )}
            {draft.pin_lat != null && (
              <>
                <label className="sliderrow">
                  <span>Facing {draft.facing_deg != null ? Math.round(draft.facing_deg) + '°' : '—'}</span>
                  <input
                    type="range" min="0" max="359"
                    value={draft.facing_deg ?? 0}
                    onChange={(e) => setDraft({ ...draft, facing_deg: Number(e.target.value) })}
                  />
                </label>
                {draft.facing_deg != null && (
                  <>
                    <label className="sliderrow">
                      <span>Reach {Math.round(draft.cone_dist ?? 150)} yd</span>
                      <input
                        type="range" min="20" max="400" step="5"
                        value={draft.cone_dist ?? 150}
                        onChange={(e) => setDraft({ ...draft, cone_dist: Number(e.target.value) })}
                      />
                    </label>
                    <label className="sliderrow">
                      <span>View {Math.round(draft.cone_spread ?? 64)}°</span>
                      <input
                        type="range" min="15" max="130"
                        value={draft.cone_spread ?? 64}
                        onChange={(e) => setDraft({ ...draft, cone_spread: Number(e.target.value) })}
                      />
                    </label>
                  </>
                )}
                <label className="sliderrow">
                  <span>Property</span>
                  <select
                    className="field"
                    style={{ flex: 1 }}
                    value={draft.property_id || ''}
                    onChange={(e) => setDraft({ ...draft, property_id: e.target.value || null })}
                  >
                    <option value="">None</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
              </>
            )}
            <div className="pinactions">
              <button className="btn primary sm" onClick={saveDraft}>Save</button>
              <button className="btn quiet sm" onClick={clearPin}>Clear pin</button>
              <button className="btn quiet sm" onClick={() => setDraft(null)}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
          <div className="railsec">
            <h3 className="seghead">Buck travel</h3>
            <div className="tagrow">
              {bucks.map((b) => (
                <button key={b.id}
                  className={'chip' + (selBuck === b.id ? ' accent on' : '')}
                  onClick={() => {
                    setSelBuck(selBuck === b.id ? null : b.id)
                    setTimeFilter('all')
                  }}>
                  {b.name}
                </button>
              ))}
            </div>
            {selBuck && (() => {
              const t = buckTravel(selBuck, timeFilter)
              const name = bucks.find((b) => b.id === selBuck)?.name
              const cad = t.cadence
              const overdue = cad && t.daysSince != null && t.daysSince > cad * 1.5
              return (
                <div className="travelsum">
                  <div className="tagrow" style={{ margin: '10px 0 8px' }}>
                    {[['all', 'All'], ['day', 'Daylight'], ['night', 'Night']].map(([v, l]) => (
                      <button key={v}
                        className={'chip' + (timeFilter === v ? ' on' : '')}
                        onClick={() => setTimeFilter(v)}>
                        {l}
                      </button>
                    ))}
                    <button className={'chip' + (showTrail ? ' on' : '')}
                      onClick={() => setShowTrail(!showTrail)}>
                      Recent trail
                    </button>
                  </div>

                  <p className="insight" style={{ margin: '0 0 2px' }}>
                    {name}: {t.total}
                    {timeFilter !== 'all' ? ` ${timeFilter}` : ''} sighting
                    {t.total === 1 ? '' : 's'} · {Object.keys(t.visits).length} camera
                    {Object.keys(t.visits).length === 1 ? '' : 's'}
                    {t.maxRange > 0 && <> · range {toYd(t.maxRange)} yd</>}
                    {t.acres != null && t.acres >= 1 && <> · core ~{Math.round(t.acres)} ac</>}
                  </p>
                  <p className="insight" style={{ margin: '0 0 2px' }}>
                    {cad
                      ? <>Shows every ~{cad.toFixed(1)}d · last seen {Math.floor(t.daysSince)}d ago
                          {overdue ? <b className="due"> · overdue</b> : ' · on pace'}</>
                      : t.daysSince != null
                      ? <>Last seen {Math.floor(t.daysSince)}d ago</>
                      : null}
                  </p>
                  <p className="insight" style={{ margin: '0 0 8px' }}
                     title={`daylight = ${DAY_START}:00a-${DAY_END - 12}:00p`}>
                    {t.trend.now != null ? (
                      <>Daylight: {t.trend.now}% last 2wks (was {t.trend.was}%)
                        {t.trend.now > t.trend.was ? ' ↑' : t.trend.now < t.trend.was ? ' ↓' : ''}</>
                    ) : t.trend.overall != null ? (
                      <>Daylight sightings: {t.trend.overall}%</>
                    ) : null}
                    {t.unpinned > 0 && (
                      <> · {t.unpinned} at unpinned cameras</>
                    )}
                  </p>

                  {t.hops.length > 0 ? (
                    <>
                      <span className="legend" style={{ marginBottom: 6 }}>
                        <i className="sw" style={{ background: DAY_ROUTE }} /> day
                        <i className="sw" style={{ background: NIGHT_ROUTE }} /> night
                      </span>
                      {t.hops
                        .sort((a, z) => z.n - a.n)
                        .map((h) => (
                          <div key={h.from + h.to} className="hoprow"
                            style={{ borderLeft: '3px solid ' + routeColor(h), paddingLeft: 8 }}>
                            <span className="hoplbl">
                              {camLabel(h.from)} → {camLabel(h.to)}
                            </span>
                            <span className="n">
                              ×{h.n} · {toYd(h.dist)} yd · {hopWhen(h)}
                            </span>
                          </div>
                        ))}
                    </>
                  ) : (
                    <p className="insight" style={{ margin: 0 }}>
                      No camera-to-camera moves inside {HOP_MAX_HOURS}h
                      {timeFilter !== 'all' ? ` in ${timeFilter} hours` : ''} yet —
                      routes draw themselves as confirmed sightings stack up.
                    </p>
                  )}
                </div>
              )
            })()}
          </div>
          <div className="railsec">
            <h3 className="seghead">Cameras</h3>
            {cameras
              .filter((c) => !propFilter || c.property_id === propFilter)
              .map((c) => (
                <button key={c.camera_id} className="camrow" onClick={() => startEdit(c)}>
                  <span className={'pinstate' + (c.pin_lat != null ? ' pinned' : '')}>●</span>
                  <span className="camname">{c.name || c.camera_id}{c.shared ? ' ↗' : ''}</span>
                  <span className="camprop">
                    {properties.find((p) => p.id === c.property_id)?.name || ''}
                  </span>
                </button>
              ))}
          </div>
          </>
        )}
        </aside>
      </div>
    </div>
  )
}
