export const LIBRARY_REQUEST_TIMEOUT_MS = 25_000;

export function libraryRequestKey(accountScope, collectionId, libraryId) {
  return `${accountScope || 'public'}:${collectionId}:${libraryId}`;
}

export function selectLibrarySnapshot(snapshot, libraryId) {
  if (!snapshot || !libraryId) return snapshot;
  const library = snapshot.libraries?.find((entry) => entry.id === libraryId);
  return library ? { ...snapshot, selectedLibrary: library } : snapshot;
}

export function libraryViewState({ request, hasData, confirmedLoaded, collectionPending = false, collectionError = '' }) {
  if (hasData) return request?.status === 'error' || collectionError ? 'content-error' : 'content';
  if (collectionPending || request?.status === 'restoring' || request?.status === 'loading') return 'loading';
  if (collectionError || request?.status === 'error') return 'error';
  return confirmedLoaded ? 'empty' : 'idle';
}

export class ScopedRequestRegistry {
  constructor({ timeoutMs = LIBRARY_REQUEST_TIMEOUT_MS } = {}) {
    this.timeoutMs = timeoutMs;
    this.requests = new Map();
    this.sequence = 0;
  }

  clear() {
    for (const entry of this.requests.values()) entry.controller?.abort();
    this.requests.clear();
  }

  delete(key) {
    const entry = this.requests.get(key);
    entry?.controller?.abort();
    this.requests.delete(key);
  }

  run(key, factory, { supersede = false, onResolve } = {}) {
    const existing = this.requests.get(key);
    if (existing && !supersede) return existing.promise;
    if (existing) existing.controller?.abort();

    const id = ++this.sequence;
    const controller = typeof AbortController === 'undefined' ? null : new AbortController();
    let timeout;
    let work;
    try {
      work = Promise.resolve(factory({ signal: controller?.signal, requestId: id }));
    } catch (error) {
      work = Promise.reject(error);
    }
    const timed = this.timeoutMs > 0
      ? Promise.race([
        work,
        new Promise((_, reject) => {
          timeout = setTimeout(() => {
            controller?.abort();
            reject(new Error('The library request timed out. Please try again.'));
          }, this.timeoutMs);
        }),
      ])
      : work;
    const promise = timed
      .then((value) => {
        if (this.requests.get(key)?.id === id) onResolve?.(value, id);
        return value;
      })
      .finally(() => {
        if (timeout) clearTimeout(timeout);
        if (this.requests.get(key)?.id === id) this.requests.delete(key);
      });
    this.requests.set(key, { id, promise, controller });
    return promise;
  }
}
