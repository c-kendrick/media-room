export const POSTER_PREFETCH_MARGIN = '1400px 500px';
export const REDUCED_DATA_POSTER_PREFETCH_MARGIN = '360px 160px';

export function posterPrefetchMargin(windowObject = window) {
  const connection = windowObject.navigator?.connection
    || windowObject.navigator?.mozConnection
    || windowObject.navigator?.webkitConnection;
  const reducedData = connection?.saveData
    || ['slow-2g', '2g'].includes(connection?.effectiveType)
    || windowObject.matchMedia?.('(prefers-reduced-data: reduce)').matches;
  return reducedData ? REDUCED_DATA_POSTER_PREFETCH_MARGIN : POSTER_PREFETCH_MARGIN;
}

export function createPosterObserverManager(createObserver, rootMargin) {
  const callbacks = new Map();
  let observer = null;

  const ensureObserver = () => {
    if (observer) return observer;
    observer = createObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const callback = callbacks.get(entry.target);
        if (!callback) continue;
        callbacks.delete(entry.target);
        observer?.unobserve(entry.target);
        callback();
      }
      if (!callbacks.size) {
        observer?.disconnect();
        observer = null;
      }
    }, { rootMargin });
    return observer;
  };

  return {
    observe(element, callback) {
      callbacks.set(element, callback);
      ensureObserver().observe(element);
      return () => {
        if (!callbacks.delete(element)) return;
        observer?.unobserve(element);
        if (!callbacks.size) {
          observer?.disconnect();
          observer = null;
        }
      };
    },
    pendingCount() {
      return callbacks.size;
    },
  };
}

let sharedManager = null;
let sharedMargin = '';

export function observeNearbyPoster(element, callback, windowObject = window) {
  if (!element || !windowObject.IntersectionObserver) return null;
  const rootMargin = posterPrefetchMargin(windowObject);
  if (!sharedManager || sharedMargin !== rootMargin) {
    sharedManager = createPosterObserverManager(
      (handler, options) => new windowObject.IntersectionObserver(handler, options),
      rootMargin,
    );
    sharedMargin = rootMargin;
  }
  return sharedManager.observe(element, callback);
}
