import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import * as turf from '@turf/turf';
import { Layers, MapPin, PenTool, Trash2, Upload, X } from 'lucide-react';
import type { FieldRecord, GeoJsonPolygon } from '../types';

interface FieldMapProps {
  fields: FieldRecord[];
  selectedField: FieldRecord | null;
  onSelectField: (fieldId: string) => void;
  onPolygonCaptured: (geometry: GeoJsonPolygon, suggestedName?: string) => void;
  externalStartDrawSignal?: number;
}

const HA_PER_ACRE = 1 / 2.47105381;

export const FieldMap: React.FC<FieldMapProps> = ({
  fields,
  selectedField,
  onSelectField,
  onPolygonCaptured,
  externalStartDrawSignal,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const fieldLayerRef = useRef<L.LayerGroup | null>(null);
  const drawLayerRef = useRef<L.LayerGroup | null>(null);
  const tileLayerRef = useRef<L.TileLayer | null>(null);

  const [baseLayer, setBaseLayer] = useState<'satellite' | 'street'>('satellite');
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawCoords, setDrawCoords] = useState<Array<[number, number]>>([]); // [lat, lon]
  const [pendingGeometry, setPendingGeometry] = useState<GeoJsonPolygon | null>(null);
  const [liveAcres, setLiveAcres] = useState<number>(0);
  const [liveCentroid, setLiveCentroid] = useState<[number, number] | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Trigger draw mode from top CTA if clicked
  useEffect(() => {
    if (externalStartDrawSignal && externalStartDrawSignal > 0) {
      startDrawing();
    }
  }, [externalStartDrawSignal]);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: selectedField
        ? [selectedField.centroid_lat, selectedField.centroid_lon]
        : [42.0445, -93.637],
      zoom: 14,
      zoomControl: true,
    });

    const satLayer = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
        maxZoom: 19,
      }
    );
    satLayer.addTo(map);
    tileLayerRef.current = satLayer;

    const fieldGroup = L.layerGroup().addTo(map);
    const drawGroup = L.layerGroup().addTo(map);
    fieldLayerRef.current = fieldGroup;
    drawLayerRef.current = drawGroup;
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Switch satellite / street base layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (tileLayerRef.current) {
      map.removeLayer(tileLayerRef.current);
    }

    const nextTile =
      baseLayer === 'satellite'
        ? L.tileLayer(
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
            {
              attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
              maxZoom: 19,
            }
          )
        : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19,
          });

    nextTile.addTo(map);
    nextTile.bringToBack();
    tileLayerRef.current = nextTile;
  }, [baseLayer]);

  // Render existing field boundaries
  useEffect(() => {
    const map = mapRef.current;
    const group = fieldLayerRef.current;
    if (!map || !group) return;

    group.clearLayers();

    for (const f of fields) {
      const isSelected = selectedField?.id === f.id;
      const latLngs = f.geometry.coordinates[0].map(
        ([lon, lat]) => [lat, lon] as [number, number]
      );

      const poly = L.polygon(latLngs, {
        color: isSelected ? '#059669' : '#64748B',
        weight: isSelected ? 3 : 1.5,
        fillColor: isSelected ? '#10B981' : '#94A3B8',
        fillOpacity: isSelected ? 0.25 : 0.12,
      });

      poly.on('click', () => {
        if (!isDrawing) {
          onSelectField(f.id);
        }
      });

      poly.bindTooltip(`${f.name} · ${f.acreage.toFixed(1)} ac`, {
        sticky: true,
      });

      poly.addTo(group);
    }

    if (selectedField && !isDrawing && !pendingGeometry) {
      const latLngs = selectedField.geometry.coordinates[0].map(
        ([lon, lat]) => [lat, lon] as [number, number]
      );
      const bounds = L.latLngBounds(latLngs);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [44, 44], maxZoom: 15 });
      }
    }
  }, [fields, selectedField, isDrawing, pendingGeometry]);

  // Handle interactive map clicks when drawing
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const handleClick = (e: L.LeafletMouseEvent) => {
      if (!isDrawing) return;
      setDrawCoords((prev) => [...prev, [e.latlng.lat, e.latlng.lng]]);
    };

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [isDrawing]);

  // Render active drawing vertices & live Turf.js acreage calculation
  useEffect(() => {
    const group = drawLayerRef.current;
    if (!group) return;
    group.clearLayers();

    if (drawCoords.length === 0 && !pendingGeometry) {
      setLiveAcres(0);
      setLiveCentroid(null);
      return;
    }

    const activeRing: Array<[number, number]> = pendingGeometry
      ? pendingGeometry.coordinates[0].map(([lon, lat]) => [lat, lon])
      : drawCoords;

    activeRing.forEach(([lat, lon], idx) => {
      L.circleMarker([lat, lon], {
        radius: 5,
        color: '#0F172A',
        weight: 2,
        fillColor: idx === 0 ? '#F59E0B' : '#FFFFFF',
        fillOpacity: 1,
      }).addTo(group);
    });

    if (activeRing.length >= 2) {
      L.polyline(activeRing, {
        color: '#F59E0B',
        weight: 2.5,
        dashArray: pendingGeometry ? undefined : '6 4',
      }).addTo(group);
    }

    if (activeRing.length >= 3) {
      const closedLngLat = [
        ...activeRing.map(([lat, lon]) => [lon, lat]),
        [activeRing[0][1], activeRing[0][0]],
      ];
      try {
        const polyFeature = turf.polygon([closedLngLat]);
        const sqMeters = turf.area(polyFeature);
        const acres = Number((sqMeters * 0.000247105381).toFixed(2));
        const centroid = turf.centroid(polyFeature);
        setLiveAcres(acres);
        setLiveCentroid([
          Number(centroid.geometry.coordinates[1].toFixed(4)),
          Number(centroid.geometry.coordinates[0].toFixed(4)),
        ]);

        L.polygon(activeRing, {
          color: '#F59E0B',
          weight: 2.5,
          fillColor: '#F59E0B',
          fillOpacity: 0.22,
        }).addTo(group);
      } catch {
        setLiveAcres(0);
      }
    } else {
      setLiveAcres(0);
      setLiveCentroid(null);
    }
  }, [drawCoords, pendingGeometry]);

  const startDrawing = () => {
    setErrorMsg(null);
    setPendingGeometry(null);
    setDrawCoords([]);
    setIsDrawing(true);
  };

  const cancelDrawing = () => {
    setIsDrawing(false);
    setDrawCoords([]);
    setPendingGeometry(null);
    setErrorMsg(null);
  };

  const finishPolygon = () => {
    if (drawCoords.length < 3) {
      setErrorMsg('Place at least 3 boundary points on the map to form a parcel.');
      return;
    }
    const ring = [
      ...drawCoords.map(([lat, lon]) => [lon, lat]),
      [drawCoords[0][1], drawCoords[0][0]],
    ];
    const geom: GeoJsonPolygon = { type: 'Polygon', coordinates: [ring] };
    setIsDrawing(false);
    setDrawCoords([]);
    setPendingGeometry(null);
    setErrorMsg(null);
    onPolygonCaptured(geom);
  };

  const handleGeoJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as {
        type: string;
        features?: Array<{ geometry?: GeoJsonPolygon; properties?: { name?: string } }>;
        geometry?: GeoJsonPolygon;
        coordinates?: number[][][];
        properties?: { name?: string };
      };

      let geom: GeoJsonPolygon | null = null;
      let uploadedName = '';

      if (parsed.type === 'FeatureCollection' && parsed.features?.[0]?.geometry) {
        geom = parsed.features[0].geometry;
        uploadedName = parsed.features[0].properties?.name || '';
      } else if (parsed.type === 'Feature' && parsed.geometry) {
        geom = parsed.geometry;
        uploadedName = parsed.properties?.name || '';
      } else if (parsed.type === 'Polygon' && parsed.coordinates) {
        geom = { type: 'Polygon', coordinates: parsed.coordinates };
      }

      if (!geom || geom.type !== 'Polygon' || !geom.coordinates?.[0] || geom.coordinates[0].length < 4) {
        throw new Error('GeoJSON must contain a valid Polygon geometry.');
      }

      const latLngs = geom.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number]);
      setIsDrawing(false);
      setDrawCoords([]);
      setPendingGeometry(null);

      const map = mapRef.current;
      if (map) {
        const bounds = L.latLngBounds(latLngs);
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [44, 44], maxZoom: 15 });
        }
      }

      onPolygonCaptured(geom, uploadedName || undefined);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to parse GeoJSON file.');
    } finally {
      e.target.value = '';
    }
  };

  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Geospatial Field Boundary & Acreage
          </h2>
          {selectedField && !isDrawing && !pendingGeometry && (
            <span className="text-xs text-slate-500 font-mono tabular-nums">
              {selectedField.centroid_lat.toFixed(4)}°N, {selectedField.centroid_lon.toFixed(4)}°E ·{' '}
              {(selectedField.acreage * HA_PER_ACRE).toFixed(2)} ha ({selectedField.acreage.toFixed(1)} ac)
            </span>
          )}
          {(isDrawing || pendingGeometry) && (
            <span className="text-xs font-mono tabular-nums text-amber-700 font-medium">
              Live Turf.js Area: {(liveAcres * HA_PER_ACRE).toFixed(2)} ha ({liveAcres.toFixed(2)} ac)
              {liveCentroid ? ` · Centroid ${liveCentroid[0]}°, ${liveCentroid[1]}°` : ''}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBaseLayer((b) => (b === 'satellite' ? 'street' : 'satellite'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            {baseLayer === 'satellite' ? 'Satellite View' : 'Street Map'}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept=".geojson,.json"
            onChange={handleGeoJsonUpload}
            className="hidden"
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-md hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            Upload GeoJSON
          </button>

          {!isDrawing && !pendingGeometry ? (
            <button
              type="button"
              onClick={startDrawing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <PenTool className="w-3.5 h-3.5" />
              Draw Polygon
            </button>
          ) : (
            <button
              type="button"
              onClick={cancelDrawing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Drawing Instruction Strip */}
      {isDrawing && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-2.5 bg-amber-50 border-b border-amber-200 text-xs text-amber-900">
          <div className="flex items-center gap-2">
            <MapPin className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>
              Click on the map to drop boundary vertices ({drawCoords.length} placed). Need at least 3 vertices.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setDrawCoords((prev) => prev.slice(0, -1))}
              disabled={drawCoords.length === 0}
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-white border border-amber-300 rounded hover:bg-amber-100 disabled:opacity-40 cursor-pointer"
            >
              <Trash2 className="w-3 h-3" />
              Undo Point
            </button>
            <button
              type="button"
              onClick={finishPolygon}
              disabled={drawCoords.length < 3}
              className="inline-flex items-center gap-1 px-3 py-1 text-xs font-medium bg-emerald-700 text-white rounded hover:bg-emerald-800 disabled:opacity-40 cursor-pointer"
            >
              Complete & Enter Details
            </button>
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
          {errorMsg}
        </div>
      )}

      {/* Map Viewport */}
      <div
        ref={mapContainerRef}
        className={`w-full h-[360px] ${isDrawing ? 'cursor-crosshair' : ''}`}
      />
    </section>
  );
};
