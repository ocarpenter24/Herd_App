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

function coneLatLngs(lat, lng, facing, spread = 32, dist = 140) {
  const pts = [[lat, lng]]
  for (let a = facing - spread; a <= facing + spread; a += 8) {
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
        .select('camera_id,name,shared,pin_lat,pin_lng,facing_deg,property_id')
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
      if (lat == null || lng == null) continue
      bounds.push([lat, lng])
      if (facing != null) {
        L.polygon(coneLatLngs(lat, lng, Number(facing)), {
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
    <div className="page mappage">
      <header className="topbar">
        <div className="row1">
          <h1>Map</h1>
        </div>
        <div className="chips">
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
          <form className="newbuck" onSubmit={createProperty}>
            <input
              placeholder="Property name…"
              value={newProp}
              onChange={(e) => setNewProp(e.target.value)}
            />
            <button disabled={!newProp.trim()}>Add</button>
          </form>
        )}
      </header>

      <div className="mapwrap">
        <div ref={mapEl} className="map" />
        {draft && (
          <div className="pinpanel">
            <div className="pintitle">
              {draft.name || draft.camera_id}
              {draft.pin_lat == null && <span className="hint"> — tap the map to drop the pin</span>}
            </div>
            {draft.pin_lat != null && (
              <label className="facingrow">
                Facing {draft.facing_deg != null ? Math.round(draft.facing_deg) + '°' : '—'}
                <input
                  type="range"
                  min="0"
                  max="359"
                  value={draft.facing_deg ?? 0}
                  onChange={(e) => setDraft({ ...draft, facing_deg: Number(e.target.value) })}
                />
              </label>
            )}
            <div className="pinrow">
              <select
                value={draft.property_id || ''}
                onChange={(e) =>
                  setDraft({ ...draft, property_id: e.target.value || null })
                }
              >
                <option value="">No property</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button className="save" onClick={saveDraft}>
                Save
              </button>
              <button className="caughtup" onClick={clearPin}>
                Clear pin
              </button>
              <button className="caughtup" onClick={() => setDraft(null)}>
                Cancel
              </button>
            </div>
          </div>
        )}
        {!draft && (
          <div className="camtray">
            {cameras
              .filter((c) => !propFilter || c.property_id === propFilter)
              .map((c) => (
                <button
                  key={c.camera_id}
                  className={'chip' + (c.pin_lat == null ? ' unpinned' : '')}
                  onClick={() => startEdit(c)}
                >
                  {c.pin_lat == null ? '◌ ' : '● '}
                  {c.name || c.camera_id}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}
