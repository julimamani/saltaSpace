export function shortAddr(a: string | null | undefined): string {
  return a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '';
}

export function usd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${(n * 100).toLocaleString('es-AR', { maximumFractionDigits: digits })}%`;
}

export function dateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('es-AR', { dateStyle: 'medium', timeStyle: 'short' });
}

export function shortDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('es-AR', { day: '2-digit', month: 'short' });
}

export function duration(seconds: number): string {
  const s = Math.abs(seconds);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400 * 2) return `${Math.round(s / 3600)} h`;
  return `${Math.round(s / 86400)} días`;
}

export function riskLabel(score: number | null | undefined): { label: string; cls: string } {
  if (score === null || score === undefined) return { label: 'Sin datos', cls: 'bg-stone-100 text-stone-600' };
  if (score < 35) return { label: `Bajo · ${score}`, cls: 'bg-emerald-100 text-emerald-800' };
  if (score < 65) return { label: `Medio · ${score}`, cls: 'bg-amber-100 text-amber-800' };
  return { label: `Alto · ${score}`, cls: 'bg-red-100 text-red-800' };
}

/** Geodesic polygon area (spherical approximation) in hectares. Ring as [lon, lat]. */
export function polygonAreaHa(ring: number[][]): number {
  const R = 6378137;
  const rad = (d: number) => (d * Math.PI) / 180;
  let area = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    area += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((area * R * R) / 2) / 10_000;
}
