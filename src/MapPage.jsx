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
  const [ready, setReady] = useState(false)
  const [cameras, setCameras] = useState([])
  const [properties, setProperties] = useState([])
  const [propFilter, setPropFilter] = useState(null)
  const [draft, setDraft] = useState(null) // {camera_id, pin_lat, pin_lng, facing_deg, property_id}
  const [newProp, setNewProp] = useState('')
  const [addingProp, setAddingProp] = useState(false)

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
    if (!ready || !layerRef.current) return
    const L = window.L
    const layer = layerRef.current
    layer.clearLayers()

    const shown = cameras.filter((c) => !propFilter || c.property_id === propFilter)
    const bounds = []
    for (const c of shown) {
      const isDraft = draft && draft.camera_id === c.camera_id
      const lat = isDraft ? draft.pin_lat : c.pin_lat
      const lng = isDraft ? draft.pin_lng : c.pin_lng
      const facing = isDraft ? draft.facing_deg : c.facing_deg
      const dist = (isDraft ? draft.cone_dist : c.cone_dist) ?? DEFAULT_DIST
      const fov = (isDraft ? draft.cone_spread : c.cone_spread) ?? DEFAULT_FOV
      if (lat == null || lng == null) continue
      bounds.push([lat, lng])
      if (facing != null) {
        L.polygon(coneLatLngs(lat, lng, Number(facing), Number(fov), Number(dist)), {
          color: '#e56b1f',
          weight: 1,
          fillColor: '#e56b1f',
          fillOpacity: 0.22,
        }).addTo(layer)
      }
      L.circleMarker([lat, lng], {
        radius: 7,
        color: isDraft ? '#ffffff' : '#101512',
        weight: 2,
        fillColor: '#e56b1f',
        fillOpacity: 1,
      })
        .bindTooltip(c.name || c.camera_id, { direction: 'top', offset: [0, -8] })
        .on('click', () => startEdit(c))
        .addTo(layer)
    }
    if (bounds.length && !draft) {
      mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 })
    }
  }, [ready, cameras, propFilter, draft]) // eslint-disable-line

  function startEdit(c) {
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
        )}
        </aside>
      </div>
    </div>
  )
}
