'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-draw';
import 'leaflet-draw/dist/leaflet.draw.css';
import { FeatureGroup, MapContainer, Polygon, TileLayer, Tooltip, useMap } from 'react-leaflet';
import * as turf from '@turf/turf';
import { Layers, Upload, X } from 'lucide-react';
import {
  PRIMARY_CROPS,
  type FieldCreateRequest,
  type FieldResponseDTO,
  type GeoJsonPolygonDTO,
} from '@/lib/api';

interface FieldMapProps {
  fields: FieldResponseDTO[];
  selectedField: FieldResponseDTO | null;
  onSelectField: (fieldId: string) => void;
  onCreateField: (payload: FieldCreateRequest) => Promise<void>;
}

function MapViewportSync({
  selectedField,
  pendingGeometry,
}: {
  selectedField: FieldResponseDTO | null;
  pendingGeometry: GeoJsonPolygonDTO | null;
}) {
  const map = useMap();

  useEffect(() => {
    const ring = pendingGeometry
      ? pendingGeometry.coordinates[0]
      : selectedField?.geometry.coordinates[0];
    if (!ring || ring.length < 3) return;
    const bounds = L.latLngBounds(ring.map(([lon, lat]) => [lat, lon] as [number, number]));
    if (bounds.isValid()) {
      map.fitBounds(bounds, { padding: [44, 44], maxZoom: 15 });
    }
  }, [map, selectedField?.id, pendingGeometry]);

  return null;
}

function LeafletDrawController({
  onPolygonCreated,
  onPolygonDeleted,
}: {
  onPolygonCreated: (geom: GeoJsonPolygonDTO) => void;
  onPolygonDeleted: () => void;
}) {
  const map = useMap();
  const drawnItemsRef = useRef<L.FeatureGroup>(new L.FeatureGroup());

  useEffect(() => {
    const drawnItems = drawnItemsRef.current;
    map.addLayer(drawnItems);

    const drawControl = new L.Control.Draw({
      position: 'topright',
      edit: {
        featureGroup: drawnItems,
        remove: true,
      },
      draw: {
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: {
            color: '#D97706',
            weight: 2.5,
            fillOpacity: 0.22,
          },
        },
        polyline: false,
        rectangle: {
          shapeOptions: {
            color: '#D97706',
            weight: 2.5,
            fillOpacity: 0.22,
          },
        },
        circle: false,
        marker: false,
        circlemarker: false,
      },
    });

    map.addControl(drawControl);

    const handleCreated = (event: L.LeafletEvent) => {
      const drawEvent = event as L.DrawEvents.Created;
      drawnItems.clearLayers();
      drawnItems.addLayer(drawEvent.layer);
      const geojson = (drawEvent.layer as L.Polygon).toGeoJSON();
      if (geojson.geometry.type === 'Polygon') {
        onPolygonCreated({
          type: 'Polygon',
          coordinates: geojson.geometry.coordinates as number[][][],
        });
      }
    };

    const handleEdited = (event: L.LeafletEvent) => {
      const editEvent = event as L.DrawEvents.Edited;
      editEvent.layers.eachLayer((layer) => {
        const geojson = (layer as L.Polygon).toGeoJSON();
        if (geojson.geometry.type === 'Polygon') {
          onPolygonCreated({
            type: 'Polygon',
            coordinates: geojson.geometry.coordinates as number[][][],
          });
        }
      });
    };

    const handleDeleted = () => {
      onPolygonDeleted();
    };

    map.on(L.Draw.Event.CREATED, handleCreated);
    map.on(L.Draw.Event.EDITED, handleEdited);
    map.on(L.Draw.Event.DELETED, handleDeleted);

    return () => {
      map.off(L.Draw.Event.CREATED, handleCreated);
      map.off(L.Draw.Event.EDITED, handleEdited);
      map.off(L.Draw.Event.DELETED, handleDeleted);
      map.removeControl(drawControl);
      map.removeLayer(drawnItems);
    };
  }, [map, onPolygonCreated, onPolygonDeleted]);

  return null;
}

export function FieldMap({
  fields,
  selectedField,
  onSelectField,
  onCreateField,
}: FieldMapProps) {
  const [baseLayer, setBaseLayer] = useState<'satellite' | 'street'>('satellite');
  const [pendingGeometry, setPendingGeometry] = useState<GeoJsonPolygonDTO | null>(null);
  const [fieldName, setFieldName] = useState('');
  const [locationLabel, setLocationLabel] = useState('');
  const [prevCrop, setPrevCrop] = useState('corn');
  const [irrigated, setIrrigated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const liveMetrics = useMemo(() => {
    if (!pendingGeometry) return null;
    try {
      const poly = turf.polygon(pendingGeometry.coordinates);
      const sqMeters = turf.area(poly);
      const acres = Number((sqMeters * 0.000247105381).toFixed(2));
      const centroid = turf.centroid(poly);
      return {
        acres,
        lat: Number(centroid.geometry.coordinates[1].toFixed(4)),
        lon: Number(centroid.geometry.coordinates[0].toFixed(4)),
      };
    } catch {
      return null;
    }
  }, [pendingGeometry]);

  const handleGeoJsonUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg(null);
    try {
      const raw = JSON.parse(await file.text()) as {
        type?: string;
        features?: Array<{ geometry?: GeoJsonPolygonDTO; properties?: { name?: string } }>;
        geometry?: GeoJsonPolygonDTO;
        coordinates?: number[][][];
        properties?: { name?: string };
      };

      let geom: GeoJsonPolygonDTO | null = null;
      let uploadedName = '';

      if (raw.type === 'FeatureCollection' && raw.features?.[0]?.geometry) {
        geom = raw.features[0].geometry;
        uploadedName = raw.features[0].properties?.name || '';
      } else if (raw.type === 'Feature' && raw.geometry) {
        geom = raw.geometry;
        uploadedName = raw.properties?.name || '';
      } else if (raw.type === 'Polygon' && raw.coordinates) {
        geom = { type: 'Polygon', coordinates: raw.coordinates };
      }

      if (!geom || geom.type !== 'Polygon' || !geom.coordinates?.[0] || geom.coordinates[0].length < 4) {
        throw new Error('Uploaded GeoJSON must contain a valid Polygon geometry.');
      }

      setPendingGeometry(geom);
      if (uploadedName && !fieldName) {
        setFieldName(uploadedName);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to parse GeoJSON file.');
    } finally {
      e.target.value = '';
    }
  };

  const handleSaveField = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingGeometry) return;
    if (!fieldName.trim()) {
      setErrorMsg('Enter a field parcel name before saving.');
      return;
    }
    setSaving(true);
    setErrorMsg(null);
    try {
      await onCreateField({
        name: fieldName.trim(),
        location_label: locationLabel.trim() || undefined,
        geometry: pendingGeometry,
        previous_crops: [prevCrop],
        irrigated,
      });
      setPendingGeometry(null);
      setFieldName('');
      setLocationLabel('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create field.');
    } finally {
      setSaving(false);
    }
  };

  const initialCenter: [number, number] = selectedField
    ? [selectedField.centroid_lat, selectedField.centroid_lon]
    : [42.0445, -93.637];

  return (
    <section className="border border-slate-200 bg-white rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold text-slate-900">
            Geospatial Field Boundary & Turf.js Acreage
          </h2>
          {selectedField && !liveMetrics && (
            <span className="text-xs font-mono tabular-nums text-slate-500">
              {selectedField.centroid_lat.toFixed(4)}°N, {selectedField.centroid_lon.toFixed(4)}°E ·{' '}
              {selectedField.acreage.toFixed(1)} ac
            </span>
          )}
          {liveMetrics && (
            <span className="text-xs font-mono tabular-nums font-medium text-amber-700">
              Draft Area: {liveMetrics.acres.toFixed(2)} ac · Centroid {liveMetrics.lat}°, {liveMetrics.lon}°
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setBaseLayer((b) => (b === 'satellite' ? 'street' : 'satellite'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Layers className="w-3.5 h-3.5 text-slate-500" />
            {baseLayer === 'satellite' ? 'Satellite Imagery' : 'Street Map'}
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-300 rounded-md hover:bg-slate-50 whitespace-nowrap shrink-0"
          >
            <Upload className="w-3.5 h-3.5 text-slate-500" />
            Upload GeoJSON
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="px-5 py-2.5 bg-rose-50 border-b border-rose-200 text-xs text-rose-800">
          {errorMsg}
        </div>
      )}

      <div className="h-[380px] w-full relative z-0">
        <MapContainer center={initialCenter} zoom={14} className="h-full w-full">
          {baseLayer === 'satellite' ? (
            <TileLayer
              attribution="Imagery © Esri, Maxar"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            />
          ) : (
            <TileLayer
              attribution="© OpenStreetMap contributors"
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
          )}

          <MapViewportSync selectedField={selectedField} pendingGeometry={pendingGeometry} />
          <FeatureGroup>
            <LeafletDrawController
              onPolygonCreated={(geom) => {
                setErrorMsg(null);
                setPendingGeometry(geom);
              }}
              onPolygonDeleted={() => setPendingGeometry(null)}
            />
          </FeatureGroup>

          {fields.map((field) => {
            const positions = field.geometry.coordinates[0].map(
              ([lon, lat]) => [lat, lon] as [number, number]
            );
            const active = selectedField?.id === field.id;
            return (
              <Polygon
                key={field.id}
                positions={positions}
                pathOptions={{
                  color: active ? '#059669' : '#64748B',
                  weight: active ? 3 : 1.5,
                  fillColor: active ? '#10B981' : '#94A3B8',
                  fillOpacity: active ? 0.25 : 0.12,
                }}
                eventHandlers={{
                  click: () => onSelectField(field.id),
                }}
              >
                <Tooltip sticky>{`${field.name} · ${field.acreage.toFixed(1)} ac`}</Tooltip>
              </Polygon>
            );
          })}

          {pendingGeometry && (
            <Polygon
              positions={pendingGeometry.coordinates[0].map(
                ([lon, lat]) => [lat, lon] as [number, number]
              )}
              pathOptions={{
                color: '#D97706',
                weight: 2.5,
                fillColor: '#F59E0B',
                fillOpacity: 0.22,
              }}
            />
          )}
        </MapContainer>
      </div>

      {pendingGeometry && (
        <form
          onSubmit={handleSaveField}
          className="p-5 border-t border-slate-200 bg-slate-50 grid grid-cols-1 md:grid-cols-6 gap-3 items-end"
        >
          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-slate-700 mb-1">Field Name</label>
            <input
              type="text"
              required
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value)}
              placeholder="e.g., North Terrace Block 4"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Region Label</label>
            <input
              type="text"
              value={locationLabel}
              onChange={(e) => setLocationLabel(e.target.value)}
              placeholder="Optional (County / State)"
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Prior Crop</label>
            <select
              value={prevCrop}
              onChange={(e) => setPrevCrop(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-white border border-slate-300 rounded-md"
            >
              {PRIMARY_CROPS.map((crop) => (
                <option key={crop.id} value={crop.id}>
                  {crop.name}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-300 rounded-md text-sm text-slate-700 cursor-pointer">
            <input
              type="checkbox"
              checked={irrigated}
              onChange={(e) => setIrrigated(e.target.checked)}
              className="accent-emerald-700"
            />
            Irrigated
          </label>

          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium text-white bg-emerald-700 rounded-md hover:bg-emerald-800 disabled:opacity-50 whitespace-nowrap"
            >
              {saving ? 'Enriching...' : `Save (${liveMetrics?.acres.toFixed(1) ?? '0.0'} ac)`}
            </button>
            <button
              type="button"
              onClick={() => setPendingGeometry(null)}
              className="p-2 text-slate-500 bg-white border border-slate-300 rounded-md hover:bg-slate-100"
              aria-label="Discard draft boundary"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
