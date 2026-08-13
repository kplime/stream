import type { FeatureCollection, LineString } from 'geojson'
import riverFallback from '../data/riverFallback.json'
import { RIVER_NAMES, type RiverName } from '../types/risk'

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const CACHE_KEY = 'busan-rivers-overpass-cache-v1'
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 1 day

type RiverGeometry = Record<RiverName, FeatureCollection<LineString>>

const FALLBACK = riverFallback as unknown as RiverGeometry

function buildQuery(names: RiverName[]): string {
  const clauses = names
    .map(
      (name) => `
  way["waterway"="stream"]["name"="${name}"](area.busan);
  way["waterway"="river"]["name"="${name}"](area.busan);`,
    )
    .join('')
  return `[out:json][timeout:60];
area["name"="부산광역시"]["boundary"="administrative"]["admin_level"="4"]->.busan;
(${clauses}
);
out geom;`
}

interface OverpassWay {
  id: number
  tags?: { name?: string; waterway?: string }
  geometry?: { lat: number; lon: number }[]
}

interface OverpassResponse {
  elements: OverpassWay[]
}

function toFeatureCollections(elements: OverpassWay[]): RiverGeometry {
  const result = {} as RiverGeometry
  for (const river of RIVER_NAMES) {
    const ways = elements.filter((el) => el.tags?.name === river && el.geometry)
    result[river] = {
      type: 'FeatureCollection',
      features: ways.map((way) => ({
        type: 'Feature',
        properties: { river_name: river, osm_id: way.id, waterway: way.tags?.waterway },
        geometry: {
          type: 'LineString',
          coordinates: way.geometry!.map((pt) => [pt.lon, pt.lat]),
        },
      })),
    }
  }
  return result
}

function readCache(): RiverGeometry | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const { timestamp, data } = JSON.parse(raw) as { timestamp: number; data: RiverGeometry }
    if (Date.now() - timestamp > CACHE_TTL_MS) return null
    return data
  } catch {
    return null
  }
}

function writeCache(data: RiverGeometry) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }))
  } catch {
    // storage full/unavailable — non-fatal, live fetch or fallback still works next time
  }
}

/**
 * Fetches waterway=stream|river geometry for the three target rivers from
 * OpenStreetMap via Overpass. Falls back to a bundled snapshot (src/data/riverFallback.json,
 * captured 2026-08-13) if the network call fails or times out — demo venues
 * have flaky wifi, so the map must never end up with no rivers drawn.
 */
export async function fetchRiverGeometry(
  names: RiverName[] = RIVER_NAMES,
): Promise<RiverGeometry> {
  const cached = readCache()
  if (cached) return cached

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 20_000)
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: buildQuery(names),
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (!response.ok) throw new Error(`Overpass responded ${response.status}`)

    const json = (await response.json()) as OverpassResponse
    const data = toFeatureCollections(json.elements)

    const gotAnyGeometry = Object.values(data).some((fc) => fc.features.length > 0)
    if (!gotAnyGeometry) throw new Error('Overpass returned no river geometry')

    writeCache(data)
    return data
  } catch (err) {
    console.warn('[overpass] live fetch failed, using bundled fallback geometry:', err)
    return FALLBACK
  }
}

export function mergedRiverFeatureCollection(
  geometry: RiverGeometry,
): FeatureCollection<LineString> {
  return {
    type: 'FeatureCollection',
    features: RIVER_NAMES.flatMap((name) => geometry[name]?.features ?? []),
  }
}
