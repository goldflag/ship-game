import { ConstructionStoreError, type ConstructionStore } from './constructionStore';

/** Repository adapter implements the same autosave/CAS contract as IndexedDB. */
export async function openConstructionRepository(): Promise<ConstructionStore> {
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch('/__construction' + path, { cache: 'no-store', ...init });
    const value = await response.json();
    if (!response.ok) throw new ConstructionStoreError(value.code === 'conflict' ? 'conflict' : 'unavailable', value.error ?? 'Repository source unavailable. Keep a downloaded backup.');
    return value;
  };
  const { token } = await request<{ token: string }>('');
  const route = (id: string) => '/' + encodeURIComponent(id);
  return {
    async list() { return (await request<{ designs: Awaited<ReturnType<ConstructionStore['list']>> }>('')).designs; },
    load: id => request(route(id)),
    revisions: id => request(route(id) + '/revisions'),
    save: input => request(route(input.designId), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-construction-token': token }, body: JSON.stringify(input) }),
    async remove() { throw new Error('Remove repository ships through Git.'); },
    close() {},
  };
}
