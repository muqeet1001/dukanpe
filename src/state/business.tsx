import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from 'react';
import { Action, BusinessState, businessReducer, createEmptyState, removeDemoData } from '../lib/domain';

// Keep the existing key so real entries survive the one-time sample cleanup.
const STORAGE_KEY = 'jodly-demo-v1';
type BusinessContextValue = {
  state: BusinessState;
  dispatch: React.Dispatch<Action>;
  ready: boolean;
  storageError: string | null;
  reset: () => void;
  toast: string | null;
  notify: (message: string) => void;
};
const BusinessContext = createContext<BusinessContextValue | null>(null);

function isBusinessState(value: unknown): value is BusinessState {
  if (!value || typeof value !== 'object') return false;
  const data = value as BusinessState;
  return data.version === 1 && Array.isArray(data.parties) && Array.isArray(data.records)
    && Array.isArray(data.followUps)
    && data.parties.every((p) => typeof p.id === 'string' && typeof p.name === 'string' && Number.isSafeInteger(p.openingBalancePaise))
    && data.records.every((r) => typeof r.id === 'string' && ['sale', 'receipt', 'invoice', 'message'].includes(r.kind)
      && ['confirmed', 'review', 'saved', 'open'].includes(r.status) && !Number.isNaN(Date.parse(r.createdAt))
      && (r.amountPaise === undefined || Number.isSafeInteger(r.amountPaise)))
    && data.followUps.every((f) => typeof f.id === 'string' && ['open', 'done'].includes(f.status));
}

export function BusinessProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(businessReducer, undefined, createEmptyState);
  const [ready, setReady] = useState(false);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const writes = useRef(Promise.resolve());
  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY).then((raw) => {
      if (!active || !raw) return;
      const saved: unknown = JSON.parse(raw);
      if (!isBusinessState(saved)) throw new Error('Unrecognised saved state');
      dispatch({ type: 'hydrate', state: removeDemoData(saved) });
    }).catch(() => { if (active) setStorageError('Saved records could not be loaded. Reconnect the server to restore synced orders.'); })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const snapshot = JSON.stringify(state);
    writes.current = writes.current.catch(() => undefined).then(() => AsyncStorage.setItem(STORAGE_KEY, snapshot))
      .catch(() => setStorageError('Changes are in memory. Local saving is unavailable on this device.'));
  }, [ready, state]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(timer);
  }, [toast]);
  const notify = useCallback((message: string) => setToast(message), []);
  const reset = useCallback(() => {
    dispatch({ type: 'reset', state: createEmptyState() }); setStorageError(null); notify('Local records cleared');
  }, [notify]);
  return <BusinessContext.Provider value={{ state, dispatch, ready, storageError, reset, toast, notify }}>{children}</BusinessContext.Provider>;
}

export function useBusiness() {
  const context = useContext(BusinessContext);
  if (!context) throw new Error('BusinessProvider is required');
  return context;
}
