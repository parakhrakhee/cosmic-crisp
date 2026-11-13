'use client';

import React, { useMemo, useRef, useState } from 'react';
import { MapContainer, Polygon, TileLayer, Tooltip, CircleMarker, useMapEvents } from 'react-leaflet';
import * as turf from '@turf/turf';
import { PenTool, Upload, Check, X } from 'lucide-react';
import 'leaflet/dist/leaflet.css';

export interface GeoJsonPolygon {
  type: 'Polygon';
  coordinates: number[][][];
}

export interface FieldSummary {
  id: string;
  name: string;
  location_label: string;
  geometry: GeoJsonPolygon;
  centroid_lat: number;
  centroid_lon: number;
  acreage: number;
}

interface FieldMapProps {
  fields: FieldSummary[];
  selectedField: FieldSummary | null;
  onSelectField: (fieldId: string) => void;
  onCreateField: (payload: {
    name: string;
    geometry: GeoJsonPolygon;
    previous_crops: string[];
    irrigated: boolean;
  }) => Promise<void>;
}

function DrawClickCatcher({
  active,
  onAddPoint,
}: {
  active: boolean;
  onAddPoint: (lat: number, lon: number) => void;
}) {
  useMapEvents({
    click(e) {
      if (active) {
        onAddPoint(e.latlng.lat, e.latlng.lng);
      }
    },
  });
  return null;
}

export function FieldMap({
  fields,
  selectedField,
  onSelectField,
  onCreateField,
}: FieldMapProps) {
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<Array<[number, number]>>([]);
  const [pendingGeom, setPendingGeom] = useState<GeoJsonPolygon | null>(null);
  const [name, setName] = useState('');
  const [prevCrop, setPrevCrop] = useState('corn');
  const [irrigated, setIrrigated] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const liveAcres = useMemo(() => {
    const ring = pendingGeom
      ? pendingGeom.coordinates[0]
      : points.length >= 3
        ? [...points.map(([lat, lon]) => [lon, lat]), [points[0][1], points[0][0]]]
        : null;
    if (!ring) return 0;
    try {
      return Number((turf.area(turf.polygon([ring])) * 0.000247105381).toFixed(2));
    } catch {
      return 0;
    }
  }, [points, pendingGeom]);

  const center: [number, number] = selectedField
    ? [selectedField.centroid_lat, selectedField.centroid_lon]
    : [42.0445, -93.637];

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const raw = JSON.parse(await file.text());
    const geom: GeoJsonPolygon | undefined =
      raw.type === 'FeatureCollection'
        ? raw.features?.[0]?.geometry
        : raw.type === 'Feature'
          ? raw.geometry
          : raw;
    if (geom?.type === 'Polygon') {
      setPendingGeom(geom);
      setDrawing(false);
      setPoints([]);
    }
    e.target.value = '';
  };

  const handleCompleteDraw = () => {
    if (points.length < 3) return;
    const ring = [...points.map(([lat, lon]) => [lon, lat]), [points[0][1], points[0][0]]];
    setPendingGeom({ type: 'Polygon', coordinates: [ring] });
    setDrawing(false);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingGeom || !name.trim()) return;
    setSaving(true);
    try {
      await onCreateField({
        name: name.trim(),
        geometry: pendingGeom,
        previous_crops: [prevCrop],
        irrigated,
      });
      setPendingGeom(null);
      setPoints([]);
      setName('');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 border-b border-slate-200 bg-slate-50">
        <div className="text-sm font-semibold text-slate-900">
          Field Boundary & Turf.js Acreage
          {liveAcres > 0 && (
            <span className="ml-3 text-xs font-mono text-amber-700">
              Live Area: {liveAcres.toFixed(2)} ac
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".geojson,.json" onChange={handleUpload} className="hidden" />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md"
          >
            <Upload className="w-3.5 h-3.5" />
            Upload GeoJSON
          </button>
          {!drawing ? (
            <button
              type="button"
              onClick={() => {
                setPendingGeom(null);
                setPoints([]);
                setDrawing(true);
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 rounded-md"
            >
              <PenTool className="w-3.5 h-3.5" />
              Draw Polygon
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCompleteDraw}
                disabled={points.length < 3}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-emerald-700 rounded-md disabled:opacity-40"
              >
                <Check className="w-3.5 h-3.5" />
                Complete ({points.length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setDrawing(false);
                  setPoints([]);
                }}
                className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium bg-white border border-slate-300 rounded-md"
              >
                <X className="w-3.5 h-3.5" />
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="h-[360px] w-full">
        <MapContainer center={center} zoom={14} className="h-full w-full">
          <TileLayer
            attribution="Imagery © Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          />
          <DrawClickCatcher active={drawing} onAddPoint={(lat, lon) => setPoints((p) => [...p, [lat, lon]])} />
          {fields.map((f) => {
            const positions = f.geometry.coordinates[0].map(([lon, lat]) => [lat, lon] as [number, number]);
            const active = selectedField?.id === f.id;
            return (
              <Polygon
                key={f.id}
                positions={positions}
                pathOptions={{ color: active ? '#059669' : '#64748B', weight: active ? 3 : 1.5 }}
                eventHandlers={{ click: () => onSelectField(f.id) }}
              >
                <Tooltip sticky>{`${f.name} · ${f.acreage.toFixed(1)} ac`}</Tooltip>
              </Polygon>
            );
          })}
          {points.map((pt, i) => (
            <CircleMarker key={i} center={pt} radius={5} pathOptions={{ color: '#F59E0B', fillOpacity: 1 }} />
          ))}
          {points.length >= 3 && (
            <Polygon positions={points} pathOptions={{ color: '#F59E0B', fillOpacity: 0.2 }} />
          )}
        </MapContainer>
      </div>

      {pendingGeom && (
        <form onSubmit={handleSave} className="p-4 border-t border-slate-200 bg-slate-50 flex flex-wrap gap-3 items-end">
          <input
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Field Name"
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-md flex-1 min-w-[200px]"
          />
          <select
            value={prevCrop}
            onChange={(e) => setPrevCrop(e.target.value)}
            className="px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
          >
            <option value="corn">Corn (Maize)</option>
            <option value="soybeans">Soybeans / Pulses</option>
            <option value="winter_wheat">Winter Wheat / Barley</option>
            <option value="canola">Canola / Mustard</option>
            <option value="sunflower_potato">Sunflower / Potato</option>
            <option value="alfalfa_clover">Alfalfa / Clover</option>
          </select>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={irrigated} onChange={(e) => setIrrigated(e.target.checked)} />
            Irrigated
          </label>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-emerald-700 rounded-md"
          >
            {saving ? 'Saving...' : `Save (${liveAcres.toFixed(1)} ac)`}
          </button>
        </form>
      )}
    </section>
  );
}
