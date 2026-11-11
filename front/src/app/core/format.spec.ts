import { polygonAreaHa, riskLabel, pct } from './format';

describe('format helpers', () => {
  it('computes polygon area in hectares (~1 km² square near Salta)', () => {
    // 0.01° lon x 0.009° lat at -25.8° ≈ 1002 m x 997 m ≈ 100 ha
    const ring = [[-65, -25.8], [-64.99, -25.8], [-64.99, -25.809], [-65, -25.809], [-65, -25.8]];
    const ha = polygonAreaHa(ring);
    expect(ha).toBeGreaterThan(95);
    expect(ha).toBeLessThan(105);
  });

  it('classifies risk', () => {
    expect(riskLabel(10).label).toContain('Bajo');
    expect(riskLabel(50).label).toContain('Medio');
    expect(riskLabel(90).label).toContain('Alto');
    expect(riskLabel(null).label).toBe('Sin datos');
  });

  it('formats percentages', () => {
    expect(pct(0.18)).toBe('18%');
    expect(pct(null)).toBe('—');
  });
});
