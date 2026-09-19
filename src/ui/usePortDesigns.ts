import { useEffect, useState } from 'react';
import { openConstructionStore, type ConstructionDesignHead } from '../ships/constructionStore';

export function usePortDesigns() {
  const [designs, setDesigns] = useState<ConstructionDesignHead[]>([]);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    void (async () => {
      const store = await openConstructionStore();
      try { const heads = await store.list(); if (active) setDesigns(heads); }
      finally { store.close(); }
    })().catch(error => { if (active) setError(error instanceof Error ? error.message : String(error)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    const focus = () => setRefresh(value => value + 1);
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, []);
  return { designs, loading, error, refresh: () => setRefresh(value => value + 1) };
}
