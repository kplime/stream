import * as turf from '@turf/turf'
import type { Feature, FeatureCollection, LineString } from 'geojson'
import type { RiskScore, RiverName } from '../types/risk'

export interface RiverSegmentProperties {
  river_name: RiverName
  osm_id: number
  station_id: string | null
  risk_score: number | null
  risk_level: 'low' | 'medium' | 'high' | 'unknown'
  updated_at: string | null
}

/**
 * Colors each river way-segment by the nearest station's current risk score.
 * Station coverage is sparse relative to OSM way segmentation, so exact
 * per-meter interpolation isn't meaningful here — nearest-station-by-midpoint
 * is the right resolution for a station-based sensor network like this one.
 */
export function buildRiskSegments(
  riverGeometry: Record<RiverName, FeatureCollection<LineString>>,
  scores: RiskScore[],
): FeatureCollection<LineString, RiverSegmentProperties> {
  const features: Feature<LineString, RiverSegmentProperties>[] = []

  for (const [riverName, collection] of Object.entries(riverGeometry) as [
    RiverName,
    FeatureCollection<LineString>,
  ][]) {
    const stationsForRiver = scores.filter((s) => s.river_name === riverName)
    const stationPoints =
      stationsForRiver.length > 0
        ? turf.featureCollection(
            stationsForRiver.map((s) => turf.point([s.lng, s.lat], { stationIndex: stationsForRiver.indexOf(s) })),
          )
        : null

    for (const way of collection.features) {
      if (way.geometry.coordinates.length < 2) continue

      let nearest: RiskScore | null = null
      if (stationPoints) {
        const midpoint = turf.along(way, turf.length(way) / 2)
        const match = turf.nearestPoint(midpoint, stationPoints)
        const idx = match.properties.stationIndex as number
        nearest = stationsForRiver[idx] ?? null
      }

      features.push(
        turf.feature(way.geometry, {
          river_name: riverName,
          osm_id: way.properties?.osm_id ?? 0,
          station_id: nearest?.station_id ?? null,
          risk_score: nearest?.risk_score ?? null,
          risk_level: nearest?.risk_level ?? 'unknown',
          updated_at: nearest?.updated_at ?? null,
        }) as Feature<LineString, RiverSegmentProperties>,
      )
    }
  }

  return turf.featureCollection(features) as FeatureCollection<LineString, RiverSegmentProperties>
}
