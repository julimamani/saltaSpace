import type { PolygonGeometry } from './models';

export type LatLon = [number, number];

const DMS = /(\d+(?:[.,]\d+)?)\s*°\s*(?:(\d+(?:[.,]\d+)?)\s*['′]\s*)?(?:(\d+(?:[.,]\d+)?)\s*(?:"|″|'')\s*)?([NSEWOnsewo])?/g;

function num(s: string | undefined): number {
  return s ? parseFloat(s.replace(',', '.')) : 0;
}

/** Parses one "lat, lon" pair: decimal (-25.81, -64.97) or DMS (25°48'36"S 64°58'28"O). */
export function parseLatLon(text: string): LatLon | null {
  const t = text.trim();
  if (!t) return null;
  let lat: number;
  let lon: number;
  if (t.includes('°')) {
    const parts = [...t.matchAll(DMS)];
    if (parts.length !== 2) return null;
    const [a, b] = parts.map((m) => {
      const v = num(m[1]) + num(m[2]) / 60 + num(m[3]) / 3600;
      return /[SWOswo]/.test(m[4] ?? '') ? -v : v;
    });
    [lat, lon] = [a, b];
  } else {
    const nums = t.split(/[\s;,]+/).filter(Boolean);
    if (nums.length !== 2) {
      // "-25,81 -64,97" (decimal comma) → 2 tokens after splitting on whitespace/semicolon
      const alt = t.split(/[\s;]+/).filter(Boolean);
      if (alt.length !== 2) return null;
      [lat, lon] = alt.map(num);
    } else {
      [lat, lon] = nums.map(Number);
    }
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  return [lat, lon];
}

/** One vertex per line. Returns a closed GeoJSON polygon, or an error message. */
export function parseVertices(text: string): { geometry: PolygonGeometry } | { error: string } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const pts: LatLon[] = [];
  for (const [i, line] of lines.entries()) {
    const p = parseLatLon(line);
    if (!p) return { error: `Línea ${i + 1}: no entiendo "${line}". Usá "latitud, longitud", p. ej. -25.8102, -64.9745.` };
    pts.push(p);
  }
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (pts.length > 1 && first[0] === last[0] && first[1] === last[1]) pts.pop();
  if (pts.length < 3) return { error: 'Necesito al menos 3 vértices (uno por línea).' };
  const ring = pts.map(([lat, lon]) => [+lon.toFixed(6), +lat.toFixed(6)]);
  return { geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } };
}

/** Square polygon of `hectares` centered on a point (quick lot when only the farm location is known). */
export function squareAround([lat, lon]: LatLon, hectares: number): PolygonGeometry {
  const half = Math.sqrt(hectares * 10_000) / 2;
  const dLat = half / 111_320;
  const dLon = half / (111_320 * Math.cos((lat * Math.PI) / 180));
  const r = (n: number) => +n.toFixed(6);
  const ring = [
    [r(lon - dLon), r(lat + dLat)],
    [r(lon + dLon), r(lat + dLat)],
    [r(lon + dLon), r(lat - dLat)],
    [r(lon - dLon), r(lat - dLat)],
  ];
  return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
}
