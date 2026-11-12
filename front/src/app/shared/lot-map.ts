import { Component, ElementRef, OnDestroy, afterNextRender, effect, input, output, signal, untracked, viewChild } from '@angular/core';
import type * as Leaflet from 'leaflet';
import type { PolygonGeometry } from '../core/models';

const SALTA_CENTER: [number, number] = [-25.2, -65.0];

/**
 * Leaflet map (browser only). Shows a lot polygon, or lets the user draw one by clicking vertices
 * when `editable` is set. Coordinates are emitted as a GeoJSON Polygon ([lon, lat]).
 */
@Component({
  selector: 'app-lot-map',
  template: `
    <div class="relative overflow-hidden rounded-2xl border border-stone-200 bg-stone-100" [style.height]="height()">
      <div #host class="absolute inset-0"></div>
      @if (!ready()) {
        <div class="absolute inset-0 grid place-items-center text-sm text-stone-500">Cargando mapa…</div>
      }
      @if (editable() && ready()) {
        <div class="absolute left-14 right-14 top-3 z-[1000] flex flex-wrap gap-2">
          <span class="rounded-lg bg-white/95 px-3 py-1.5 text-xs font-medium text-stone-700 shadow">
            @if (closed()) { Polígono listo · {{ points().length }} vértices } @else { Hacé clic para marcar vértices ({{ points().length }}) }
          </span>
          <button type="button" class="map-btn" (click)="undo()" [disabled]="!points().length || closed()">Deshacer</button>
          <button type="button" class="map-btn" (click)="close()" [disabled]="points().length < 3 || closed()">Cerrar polígono</button>
          <button type="button" class="map-btn" (click)="clear()" [disabled]="!points().length">Limpiar</button>
        </div>
      }
    </div>
  `,
  styles: `
    .map-btn { background: white; border-radius: 0.5rem; padding: 0.375rem 0.75rem; font-size: 0.75rem; font-weight: 600; color: #166534; box-shadow: 0 1px 3px rgb(0 0 0 / 0.2); }
    .map-btn:disabled { opacity: 0.45; }
  `,
})
export class LotMap implements OnDestroy {
  readonly geometry = input<PolygonGeometry | null>(null);
  readonly editable = input(false);
  readonly height = input('22rem');
  /** [lat, lon] to fly to and mark (e.g. typed farm coordinates). */
  readonly focus = input<[number, number] | null>(null);
  readonly geometryChange = output<PolygonGeometry | null>();

  protected readonly ready = signal(false);
  protected readonly points = signal<[number, number][]>([]); // [lat, lng]
  protected readonly closed = signal(false);

  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');
  private L?: typeof Leaflet;
  private map?: Leaflet.Map;
  private layer?: Leaflet.LayerGroup;
  private focusMarker?: Leaflet.CircleMarker;

  constructor() {
    afterNextRender(async () => {
      const mod = await import('leaflet');
      const L = ((mod as unknown as { default?: typeof Leaflet }).default ?? mod) as typeof Leaflet;
      this.L = L;
      const map = L.map(this.host().nativeElement, { zoomControl: true }).setView(SALTA_CENTER, 8);
      const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 18,
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
      }).addTo(map);
      const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      });
      L.control.layers({ Satélite: sat, Mapa: osm }).addTo(map);
      this.layer = L.layerGroup().addTo(map);
      map.on('click', (e: Leaflet.LeafletMouseEvent) => {
        if (!this.editable() || this.closed()) return;
        this.points.update((p) => [...p, [e.latlng.lat, e.latlng.lng]]);
        this.redraw();
      });
      this.map = map;
      this.ready.set(true);
      this.syncFromInput(true);
    });

    effect(() => {
      this.geometry();
      if (this.ready()) untracked(() => this.syncFromInput(true));
    });

    effect(() => {
      const f = this.focus();
      if (this.ready()) untracked(() => this.showFocus(f));
    });
  }

  ngOnDestroy(): void {
    this.map?.remove();
  }

  protected undo(): void {
    this.points.update((p) => p.slice(0, -1));
    this.redraw();
  }

  protected close(): void {
    this.closed.set(true);
    this.redraw();
    this.geometryChange.emit(this.toGeoJson());
  }

  protected clear(): void {
    this.points.set([]);
    this.closed.set(false);
    this.redraw();
    this.geometryChange.emit(null);
  }

  private showFocus(f: [number, number] | null): void {
    const L = this.L;
    if (!L || !this.map) return;
    this.focusMarker?.remove();
    this.focusMarker = undefined;
    if (!f) return;
    this.focusMarker = L.circleMarker(f, { radius: 8, color: '#fff', weight: 3, fillColor: '#dc2626', fillOpacity: 1 }).addTo(this.map);
    this.map.setView(f, Math.max(this.map.getZoom(), 15));
  }

  private syncFromInput(fit: boolean): void {
    const g = this.geometry();
    const ring = g?.coordinates?.[0];
    if (ring && ring.length >= 4) {
      const pts = ring.slice(0, -1).map(([lon, lat]) => [lat, lon] as [number, number]);
      const same = JSON.stringify(pts) === JSON.stringify(this.points());
      this.points.set(pts);
      this.closed.set(true);
      this.redraw();
      if (fit && !same && this.map && this.L) this.map.fitBounds(this.L.latLngBounds(pts), { padding: [30, 30], maxZoom: 15 });
    } else if (!this.editable()) {
      this.points.set([]);
      this.redraw();
    }
  }

  private redraw(): void {
    const L = this.L;
    if (!L || !this.layer) return;
    this.layer.clearLayers();
    const pts = this.points();
    const style = { color: '#facc15', weight: 3, fillColor: '#84cc16', fillOpacity: 0.25 };
    if (this.closed() && pts.length >= 3) {
      L.polygon(pts, style).addTo(this.layer);
    } else if (pts.length > 1) {
      L.polyline(pts, { ...style, dashArray: '6 6' }).addTo(this.layer);
    }
    if (this.editable()) {
      pts.forEach((p) => L.circleMarker(p, { radius: 5, color: '#fff', weight: 2, fillColor: '#16a34a', fillOpacity: 1 }).addTo(this.layer!));
    }
  }

  private toGeoJson(): PolygonGeometry {
    const ring = this.points().map(([lat, lng]) => [+lng.toFixed(6), +lat.toFixed(6)]);
    return { type: 'Polygon', coordinates: [[...ring, ring[0]]] };
  }
}
