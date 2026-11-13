'use client';

import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import Dexie, { type Table } from 'dexie';
import { SoilAuditCard, type SoilProfileData } from '../components/SoilAuditCard';
import { RotationCards, type RotationResponse } from '../components/RotationCards';
import type { FieldSummary, GeoJsonPolygon } from '../components/FieldMap';

const FieldMap = dynamic(
  () => import('../components/FieldMap').then((mod) => mod.FieldMap),
  { ssr: false }
);

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000/api/v1';

interface FullField extends FieldSummary {
  previous_crops: string[];
  soil: SoilProfileData;
}

class OfflineCache extends Dexie {
  rotations!: Table<{ field_id: string; data: RotationResponse }, string>;
  constructor() {
    super('cosmic_crisp_next_cache');
    this.version(1).stores({ rotations: 'field_id' });
  }
}

const offlineCache = new OfflineCache();

export default function CosmicCrispDashboardPage() {
  const [fields, setFields] = useState<FullField[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [rotationData, setRotationData] = useState<RotationResponse | null>(null);

  const selectedField = fields.find((f) => f.id === selectedId) || fields[0] || null;

  useEffect(() => {
    fetch(`${API_BASE}/fields`)
      .then((r) => r.json())
      .then((res) => {
        setFields(res.fields || []);
        if (res.fields?.[0]?.id) setSelectedId(res.fields[0].id);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!selectedField) return;
    fetch(`${API_BASE}/rotations/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ field_id: selectedField.id }),
    })
      .then((r) => r.json())
      .then(async (data: RotationResponse) => {
        setRotationData(data);
        await offlineCache.rotations.put({ field_id: selectedField.id, data });
      })
      .catch(async () => {
        const cached = await offlineCache.rotations.get(selectedField.id);
        if (cached) setRotationData(cached.data);
      });
  }, [selectedField?.id]);

  const handleCreateField = async (payload: {
    name: string;
    geometry: GeoJsonPolygon;
    previous_crops: string[];
    irrigated: boolean;
  }) => {
    const res = await fetch(`${API_BASE}/fields`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setFields((prev) => [data.field, ...prev]);
    setSelectedId(data.field.id);
  };

  const handleSaveSoil = async (
    fieldId: string,
    payload: Omit<SoilProfileData, 'source' | 'is_manual_override'>
  ) => {
    const res = await fetch(`${API_BASE}/fields/${fieldId}/soil`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    setFields((prev) => prev.map((f) => (f.id === fieldId ? data.field : f)));
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between gap-8">
        <span className="text-lg font-bold tracking-tight whitespace-nowrap shrink-0">
          Cosmic Crisp
        </span>
        <span className="text-xs text-slate-500">
          Precision Crop Rotation & NASA POWER / USDA Soil Decision Support
        </span>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-6">
        <FieldMap
          fields={fields}
          selectedField={selectedField}
          onSelectField={setSelectedId}
          onCreateField={handleCreateField}
        />

        {selectedField && (
          <SoilAuditCard
            fieldId={selectedField.id}
            fieldName={selectedField.name}
            soil={selectedField.soil}
            onSaveOverride={handleSaveSoil}
          />
        )}

        <RotationCards data={rotationData} />
      </main>
    </div>
  );
}
