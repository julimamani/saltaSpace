import { parseLatLon, parseVertices, squareAround } from './geo';
import { polygonAreaHa } from './format';

describe('geo', () => {
  it('parses decimal and DMS coordinates', () => {
    expect(parseLatLon('-25.8102, -64.9745')).toEqual([-25.8102, -64.9745]);
    expect(parseLatLon('-25,8102 -64,9745')).toEqual([-25.8102, -64.9745]);
    const dms = parseLatLon(`25°48'36"S 64°58'28"O`)!;
    expect(dms[0]).toBeCloseTo(-25.81, 3);
    expect(dms[1]).toBeCloseTo(-64.9744, 3);
    expect(parseLatLon('hola')).toBeNull();
    expect(parseLatLon('-95, 10')).toBeNull();
  });

  it('builds a closed polygon from vertices', () => {
    const r = parseVertices('-25.8102, -64.9745\n-25.8102, -64.9662\n-25.8171, -64.9662\n-25.8171, -64.9745');
    expect('geometry' in r && r.geometry.coordinates[0].length).toBe(5);
    expect('error' in parseVertices('-25.8, -64.9\n-25.9, -64.9')).toBe(true);
  });

  it('squareAround matches the requested hectares', () => {
    const g = squareAround([-25.81, -64.97], 100);
    expect(polygonAreaHa(g.coordinates[0])).toBeCloseTo(100, 0);
  });
});
