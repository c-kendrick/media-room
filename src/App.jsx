import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Cloud,
  Command,
  Film,
  Download,
  Gamepad2,
  GripVertical,
  ListOrdered,
  LogIn,
  LogOut,
  Menu,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  ChevronsDown,
  ChevronsUp,
  UserRound,
  X,
} from 'lucide-react';
import { loadMediaSnapshot } from './data.js';
import { loadAuthenticatedAccount, registerWithPassword, signInWithPassword, signOut } from './auth.js';
import { loadPublicCollections } from './supabase-data.js';
import { createMediaItem, createShelf, deleteShelf, permanentlyDeleteMedia, replaceMediaShelfMemberships, reorderMainWatchlist, reorderShelfMedia, reorderShelves, setInterest, setMediaDeleted, updateCollection, updateMediaItem, updateShelf } from './media-write.js';
import { approveProfile, deactivateProfile, listProfiles, rejectProfile, restoreProfile } from './admin.js';

function cls(...values) {
  return values.filter(Boolean).join(' ');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function active(rows) {
  return (rows || []).filter((row) => !row.deleted_at);
}

function useEscape(onClose, active = true) {
  useEffect(() => {
    if (!active) return undefined;
    const close = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    };
    window.addEventListener('keydown', close, true);
    return () => window.removeEventListener('keydown', close, true);
  }, [active, onClose]);
}

function exportCollection(snapshot) {
  const payload = { exported_at: new Date().toISOString(), format: 'media-room/v1', collection: { id: snapshot.collectionId, title: snapshot.collectionTitle, owner_id: snapshot.ownerId }, shelves: snapshot.mediaShelves, media: snapshot.media };
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `${snapshot.collectionTitle.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase()}-backup.json`; link.click(); URL.revokeObjectURL(url);
}

function normalizePlatform(value) {
  const platform = String(value || '').trim();
  if (/^xbox[- ]?pc$/i.test(platform)) return 'PC';
  if (/ubisoft connect/i.test(platform)) return 'Ubisoft';
  if (/xbox series x\/?s/i.test(platform)) return 'Xbox Series X';
  return platform;
}

function mediaSection(item) {
  if (item.type === 'book') return 'book';
  if (item.type === 'game') return 'game';
  return 'screen';
}

function splitMediaValues(value) {
  if (Array.isArray(value)) return value.flatMap(splitMediaValues);
  return String(value || '')
    .split(/[,;|]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function displayMediaTag(value, isGame = false) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^blu[- ]?ray$/i.test(raw)) return 'Blu-ray';
  if (/^4k$/i.test(raw)) return '4K';
  return isGame ? normalizePlatform(raw) : raw;
}

function mediaDisplayTags(item) {
  const isGame = item.type === 'game';
  const source = isGame && item.platforms?.length ? item.platforms : item.format;
  return unique(splitMediaValues(source).map((value) => displayMediaTag(value, isGame)));
}

function mediaTagTone(value, isGame = false) {
  const tag = String(value || '').trim();
  if (/^4k$/i.test(tag)) return 'format-4k';
  if (/^blu[- ]?ray$/i.test(tag)) return 'format-bluray';
  if (/^dvd$/i.test(tag)) return 'format-dvd';
  return isGame ? 'format-platform' : 'format-default';
}

function cleanImportedMediaTitle(value) {
  const title = String(value ?? '');
  return /^\d{4}\.0$/.test(title) ? title.slice(0, -2) : title;
}

function mediaShelvesForSection(data, section) {
  return (data.mediaShelves || [])
    .filter((shelf) => shelf.section === section && !shelf.deleted_at)
    .sort((a, b) => Number(a.position || 0) - Number(b.position || 0));
}

function shelfPosition(item, shelfId, fallback = Number.MAX_SAFE_INTEGER) {
  const value = item.list_positions?.[shelfId];
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function sortShelfItems(items, shelfId, sourceOrder = []) {
  const sourceIndex = new Map(sourceOrder.map((item, index) => [item.item_id, index]));
  return [...items].sort((a, b) => {
    const first = shelfPosition(a, shelfId);
    const second = shelfPosition(b, shelfId);
    if (first !== second) return first - second;
    return (sourceIndex.get(a.item_id) ?? 0) - (sourceIndex.get(b.item_id) ?? 0);
  });
}

function Button({ children, className, icon: Icon, ...props }) {
  return (
    <button className={cls('button', className)} {...props}>
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}

function Empty({ children }) {
  return <div className="empty-state">{children}</div>;
}

function PageHero({ eyebrow, title, description, icon: Icon, stats }) {
  return (
    <section className="page-hero dotted">
      {Icon && <div className="hero-icon"><Icon size={28} /></div>}
      <div className="hero-copy">
        <span className="eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        {description && (typeof description === 'string' ? <p>{description}</p> : description)}
      </div>
      <div className="hero-side">
        {stats?.map(([value, label]) => (
          <div className="hero-stat" key={label}>
            <b>{value}</b>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function MultiSelect({ label, values, options, onChange }) {
  const selected = new Set(values);
  const display = !values.length
    ? label
    : values.length === 1
      ? (options.find(([value]) => value === values[0])?.[1] || values[0])
      : `${values.length} selected`;
  const toggle = (value) => {
    onChange(selected.has(value)
      ? values.filter((item) => item !== value)
      : [...values, value]);
  };

  return (
    <details className="multi-select">
      <summary><span>{display}</span><ChevronRight size={14} /></summary>
      <div className="multi-select-menu">
        <div className="multi-select-head">
          <span>{label}</span>
          {values.length > 0 && <button type="button" onClick={() => onChange([])}>Clear</button>}
        </div>
        {options.map(([value, optionLabel]) => (
          <label key={value}>
            <input type="checkbox" checked={selected.has(value)} onChange={() => toggle(value)} />
            <span>{optionLabel}</span>
          </label>
        ))}
        {!options.length && <small>No options available.</small>}
      </div>
    </details>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMediaId, setSelectedMediaId] = useState(null);
  const [account, setAccount] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [collections, setCollections] = useState([]);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [collectionId, setCollectionId] = useState(null);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [landingApplied, setLandingApplied] = useState(false);
  const snapshotCache = useRef(new Map());
  const latestRequest = useRef(0);
  const userSelectedCollection = useRef(false);

  const cacheSnapshot = (snapshot, requestedCollectionId = null) => {
    if (snapshot?.collectionId) snapshotCache.current.set(snapshot.collectionId, snapshot);
    if (!requestedCollectionId) snapshotCache.current.set('default', snapshot);
  };

  const refresh = async ({ fresh = false, notify = false, targetCollectionId = collectionId } = {}) => {
    const request = ++latestRequest.current;
    if (fresh) setRefreshing(true);
    try {
      const snapshot = await loadMediaSnapshot({ fresh, collectionId: targetCollectionId });
      cacheSnapshot(snapshot, targetCollectionId);
      if (fresh && snapshot.collectionId !== MAIN_WATCHLIST_ID) snapshotCache.current.delete(MAIN_WATCHLIST_ID);
      if (request !== latestRequest.current) return;
      setData(snapshot);
      setError('');
      if (notify) setToast('Public media data refreshed.');
    } catch (loadError) {
      if (request !== latestRequest.current) return;
      setError(loadError.message);
    } finally {
      if (request === latestRequest.current) {
        setLoading(false);
        setRefreshing(false);
        setCollectionLoading(false);
      }
    }
  };

  const selectCollection = (nextCollectionId, { userInitiated = true } = {}) => {
    if (userInitiated) userSelectedCollection.current = true;
    if (nextCollectionId === collectionId || nextCollectionId === data?.collectionId) return;
    const cached = snapshotCache.current.get(nextCollectionId);
    setCollectionId(nextCollectionId);
    setSelectedMediaId(null);
    setError('');
    if (cached) setData(cached);
    setCollectionLoading(!cached);
    setMobileNav(false);
  };

  useEffect(() => {
    refresh();
  }, [collectionId]);

  useEffect(() => {
    loadPublicCollections({ fresh: true })
      .then(setCollections)
      .catch(() => setCollections([]))
      .finally(() => setCollectionsLoading(false));
  }, []);

  useEffect(() => {
    if (!data?.collectionId || !collections.length) return undefined;
    let cancelled = false;
    const prefetch = async () => {
      for (const collection of collections) {
        if (cancelled || snapshotCache.current.has(collection.id)) continue;
        try {
          const snapshot = await loadMediaSnapshot({ collectionId: collection.id });
          if (!cancelled) cacheSnapshot(snapshot, collection.id);
        } catch {
          // Prefetch is best-effort; foreground navigation retains its own error state.
        }
      }
    };
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(prefetch, { timeout: 1800 })
      : window.setTimeout(prefetch, 500);
    return () => {
      cancelled = true;
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, [collections, data?.collectionId]);

  useEffect(() => {
    if (authLoading || !collections.length || landingApplied || userSelectedCollection.current) return;
    const landingCollection = account?.profile?.approved_at && !account.profile.deactivated_at
      ? collections.find((collection) => collection.owner_id === account.profile.id)
      : collections.find((collection) => collection.slug === 'kits-collection');
    setLandingApplied(true);
    if (landingCollection) selectCollection(landingCollection.id, { userInitiated: false });
  }, [account, authLoading, collections, landingApplied]);

  useEffect(() => {
    let cancelled = false;
    loadAuthenticatedAccount()
      .then((nextAccount) => {
        if (!cancelled) setAccount(nextAccount);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const onKeyDown = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (event.key === 'Escape') {
        setSearchOpen(false);
        setSelectedMediaId(null);
        setMobileNav(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  if (loading || authLoading || collectionsLoading || (!landingApplied && collections.length > 0)) {
    return <div className="loading-screen"><div className="brand-mark">KM</div><p>Opening Kit’s Media Room…</p></div>;
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <p>{error || 'The public media collection could not be opened.'}</p>
        <Button onClick={() => refresh({ fresh: true })}>Try again</Button>
      </div>
    );
  }

  const selectedMedia = data.media.find((item) => item.item_id === selectedMediaId);
  const canEditCollection = Boolean(
    account?.profile?.approved_at
    && !account.profile.deactivated_at
    && data.ownerId
    && account.profile.id === data.ownerId,
  );
  const isAdmin = account?.profile?.role === 'admin';
  const generatedAt = data.generatedAt ? new Date(data.generatedAt) : null;

  return (
    <div className="app-shell media-only-shell public-media-shell">
      <div className="paper-texture" />
      <aside className={cls('sidebar', mobileNav && 'open')}>
        <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="brand-mark">KM</span>
          <span><strong>Kit’s Media<br />Room</strong><small>A LIVING LIBRARY</small></span>
        </button>
        <nav>
          {data?.storage === 'supabase' && <button className={data.mainWatchlist ? 'active' : ''} onClick={() => selectCollection(MAIN_WATCHLIST_ID)}>
            <ListOrdered size={17} />Main Watchlist
          </button>}
          <small className="collection-nav-label">COLLECTIONS</small>
          {data?.storage === 'supabase' && collections.map((collection) => <button key={collection.id} className={collection.id === (collectionId || data?.collectionId) ? 'active' : ''} onClick={() => selectCollection(collection.id)}>
            <UserRound size={17} />{collection.title}
          </button>)}
        </nav>
        <div className="sidebar-bottom">
          <blockquote>“Screen, shelf & story.”</blockquote>
          <button className="drive-state" onClick={() => refresh({ fresh: true, notify: true })}>
            <Cloud size={16} />
            <span>
              <strong>Public collection</strong>
              <small>{refreshing ? 'Refreshing…' : generatedAt ? `Published ${generatedAt.toLocaleDateString('en-AU')}` : 'Static snapshot'}</small>
            </span>
          </button>
        </div>
      </aside>

      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close menu" />}

      <div className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button>
          <button className="search-trigger" onClick={() => setSearchOpen(true)}>
            <Search size={17} /><span>Search the collection…</span><kbd><Command size={12} />K</kbd>
          </button>
          <div className="top-actions">
            <span className="today"><CalendarDays size={14} />{new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span>
            {authLoading ? <span className="account-state">Checking account…</span> : (
              <Button className="account-button" icon={account ? UserRound : LogIn} onClick={() => setAccountOpen(true)}>
                {account?.profile?.display_name || account?.profile?.username || 'Sign in'}
              </Button>
            )}
            <Button className="sync-button" icon={RotateCw} onClick={() => refresh({ fresh: true, notify: true })} disabled={refreshing}>
              {refreshing ? 'Refreshing' : 'Refresh'}
            </Button>
          </div>
        </header>

        {error && <div className="error-banner">The public collection could not refresh: {error}</div>}

        <main className={cls(collectionLoading && 'collection-loading')} aria-busy={collectionLoading}>
          <MediaView data={data} notify={setToast} openMedia={setSelectedMediaId} canEdit={canEditCollection} isAdmin={isAdmin} accessToken={account?.session?.access_token} refresh={refresh} onExport={() => exportCollection(data)} onDescriptionChange={async (description) => {
            const previousData = data;
            const optimisticData = { ...data, collectionDescription: description };
            setData(optimisticData);
            cacheSnapshot(optimisticData, data.collectionId);
            try {
              await updateCollection(account.session.access_token, data.collectionId, { description });
              snapshotCache.current.delete(MAIN_WATCHLIST_ID);
              setToast('Collection introduction saved.');
            } catch (error) {
              setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData);
              cacheSnapshot(previousData, previousData.collectionId);
              setToast('Collection introduction could not be saved.');
              throw error;
            }
          }} />
        </main>
        <footer>Published from Kit’s Local Media Room.</footer>
      </div>

      {selectedMedia && (
        <MediaDrawer
          item={selectedMedia}
          shelves={data.mainWatchlist ? data.mediaShelves : mediaShelvesForSection(data, mediaSection(selectedMedia))}
          onClose={() => setSelectedMediaId(null)}
          canEdit={canEditCollection}
          onUpdate={async (changes) => {
            const previousData = data;
            const applyMediaUpdate = (currentData, mediaChanges) => ({
              ...currentData,
              media: currentData.media.map((item) => item.database_id === selectedMedia.database_id
                ? { ...item, ...mediaChanges }
                : item),
            });
            const optimisticData = applyMediaUpdate(data, { ...changes, updated_at: new Date().toISOString() });
            setData(optimisticData);
            cacheSnapshot(optimisticData, data.collectionId);
            try {
              const updated = await updateMediaItem(account.session.access_token, selectedMedia.database_id, changes);
              const confirmedData = applyMediaUpdate(optimisticData, updated);
              setData((currentData) => currentData?.collectionId === data.collectionId ? confirmedData : currentData);
              cacheSnapshot(confirmedData, data.collectionId);
              snapshotCache.current.delete(MAIN_WATCHLIST_ID);
              setToast('Media details saved.');
            } catch (error) {
              setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData);
              cacheSnapshot(previousData, previousData.collectionId);
              setToast('Media details could not be saved.');
              throw error;
            }
          }}
          onUpdateShelves={async (currentShelfIds, selectedShelfIds) => {
            await replaceMediaShelfMemberships(account.session.access_token, selectedMedia.database_id, currentShelfIds, selectedShelfIds);
            await refresh({ fresh: true });
            setToast('Shelf membership saved.');
          }}
          canInterest={Boolean(account?.profile?.approved_at && !account.profile.deactivated_at && ['film', 'television'].includes(selectedMedia.type))}
          interested={Boolean(selectedMedia.interests?.some((person) => person?.username === account?.profile?.username))}
          onInterest={async (enabled) => {
            const previousData = data;
            const person = { id: account.profile.id, username: account.profile.username, display_name: account.profile.display_name };
            const optimisticData = {
              ...data,
              media: data.media.map((item) => item.database_id === selectedMedia.database_id
                ? { ...item, interests: enabled ? [...(item.interests || []).filter((entry) => entry.id !== person.id), person] : (item.interests || []).filter((entry) => entry.id !== person.id) }
                : item),
            };
            setData(optimisticData);
            cacheSnapshot(optimisticData, data.collectionId);
            try {
              await setInterest(account.session.access_token, account.profile.id, selectedMedia.database_id, enabled);
              setToast(enabled ? 'Priority Watch added.' : 'Priority Watch removed.');
            } catch (error) {
              cacheSnapshot(previousData, previousData.collectionId);
              setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData);
              setToast('Priority Watch could not be updated. Please try again.');
              throw error;
            }
          }}
          onDelete={async (permanent) => { if (!window.confirm(permanent ? 'Permanently delete this item? This cannot be undone.' : 'Move this item to Bin?')) return; permanent ? await permanentlyDeleteMedia(account.session.access_token, selectedMedia.database_id) : await setMediaDeleted(account.session.access_token, selectedMedia.database_id, true); setSelectedMediaId(null); await refresh({ fresh: true }); setToast(permanent ? 'Media permanently deleted.' : 'Media moved to Bin.'); }}
          onRestore={async () => { await setMediaDeleted(account.session.access_token, selectedMedia.database_id, false); await refresh({ fresh: true }); setToast('Media restored.'); }}
        />
      )}

      {searchOpen && (
        <SearchModal
          data={data}
          query={searchQuery}
          setQuery={setSearchQuery}
          onClose={() => setSearchOpen(false)}
          onOpen={(id) => {
            setSearchOpen(false);
            setSelectedMediaId(id);
          }}
        />
      )}

      {accountOpen && (
        <AccountDialog
          account={account}
          onClose={() => setAccountOpen(false)}
          onSignedIn={(nextAccount) => {
            setAccount(nextAccount);
            setAccountOpen(false);
            setLandingApplied(false);
            userSelectedCollection.current = false;
            setToast('Signed in securely.');
          }}
          onSignedOut={() => {
            setAccount(null);
            setAccountOpen(false);
            setLandingApplied(false);
            userSelectedCollection.current = false;
            setToast('Signed out.');
          }}
          onManageUsers={() => { setAccountOpen(false); setAdminOpen(true); }}
        />
      )}

      {adminOpen && <AdminUsers accessToken={account?.session?.access_token} onClose={() => setAdminOpen(false)} onUsersChanged={async () => {
        const nextCollections = await loadPublicCollections({ fresh: true });
        setCollections(nextCollections);
        snapshotCache.current.clear();
        if (data.collectionId === MAIN_WATCHLIST_ID) {
          await refresh({ fresh: true, targetCollectionId: MAIN_WATCHLIST_ID });
        } else if (!nextCollections.some((collection) => collection.id === data.collectionId)) {
          const kit = nextCollections.find((collection) => collection.slug === 'kits-collection');
          if (kit) selectCollection(kit.id, { userInitiated: false });
        }
      }} />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  );
}

function NoteDrawer({ title, value, onClose }) {
  useEscape(onClose);
  return createPortal(<div className="drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="collection-note-drawer"><button className="close" onClick={onClose} aria-label="Close note"><X /></button><span className="eyebrow">COLLECTION NOTE</span><h2>{title}</h2><div className="collection-note-full">{value}</div></aside></div>, document.body);
}

function EditableDescription({ value, canEdit, onSave, title = 'Collection note' }) {
  const fallback = 'A living collection of films, television, books and games.';
  const [editing, setEditing] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draft, setDraft] = useState(value || fallback);
  useEffect(() => { if (!editing) setDraft(value || fallback); }, [value, editing]);
  if (!canEdit || !editing) {
    const note = value || fallback;
    const isLong = note.length > 180 || note.split('\n').length > 3;
    return <div className="collection-note-preview"><p className={cls(canEdit && 'editable-description')} tabIndex={canEdit ? 0 : undefined} title={canEdit ? 'Click to edit this note' : undefined} onClick={() => canEdit && setEditing(true)} onKeyDown={(event) => { if (canEdit && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setEditing(true); } }}>{note}</p>{isLong && <button className="open-note-button" onClick={() => setDrawerOpen(true)}><BookOpen size={14} />Read full note</button>}{drawerOpen && <NoteDrawer title={title} value={note} onClose={() => setDrawerOpen(false)} />}</div>;
  }
  const save = async () => {
    const next = draft.trim();
    if (next === (value || fallback)) { setEditing(false); return; }
    try { await onSave(next); setEditing(false); } catch { /* Keep the text available for another attempt. */ }
  };
  return <textarea className="editable-description-input" aria-label="Collection note" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => { if (event.key === 'Escape') { setDraft(value || fallback); setEditing(false); } if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.blur(); }} />;
}

function MediaView({ data, notify, openMedia, canEdit, isAdmin, accessToken, refresh, onExport, onDescriptionChange }) {
  const [section, setSection] = useState('screen');
  const [query, setQuery] = useState('');
  const [listFilters, setListFilters] = useState([]);
  const [formatFilters, setFormatFilters] = useState([]);
  const [genreFilters, setGenreFilters] = useState([]);
  const [typeFilters, setTypeFilters] = useState([]);
  const [stampFilters, setStampFilters] = useState([]);
  const [newShelf, setNewShelf] = useState('');
  const [addingMedia, setAddingMedia] = useState(false);
  const [addToShelfIds, setAddToShelfIds] = useState([]);
  const [draggedShelfId, setDraggedShelfId] = useState(null);
  const [optimisticShelfIds, setOptimisticShelfIds] = useState([]);
  const [optimisticMainShelfIds, setOptimisticMainShelfIds] = useState([]);

  const sourceShelves = mediaShelvesForSection(data, section);
  useEffect(() => { setOptimisticShelfIds(sourceShelves.map((shelf) => shelf.shelf_id)); }, [data.collectionId, data.mediaShelves, section]);
  useEffect(() => { setOptimisticMainShelfIds(data.mediaShelves.filter((shelf) => shelf.showInMainWatchlist).map((shelf) => shelf.shelf_id)); }, [data.collectionId, data.mediaShelves]);
  const shelfIndex = new Map(optimisticShelfIds.map((id, index) => [id, index]));
  const shelves = [...sourceShelves].sort((a, b) => (shelfIndex.get(a.shelf_id) ?? Number.MAX_SAFE_INTEGER) - (shelfIndex.get(b.shelf_id) ?? Number.MAX_SAFE_INTEGER));
  const items = active(data.media).filter((item) => data.mainWatchlist || mediaSection(item) === section);
  const formats = unique(items.flatMap(mediaDisplayTags)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const genres = unique(items.flatMap((item) => item.genres || [])).sort((a, b) => a.localeCompare(b));
  const sectionTypes = section === 'screen'
    ? [['film', 'Films'], ['television', 'Television']]
    : section === 'book'
      ? [['book', 'Books']]
      : [['game', 'Video games']];

  const matchesAny = (selected, values) => !selected.length || selected.some((value) => values.includes(value));
  const queryLower = query.trim().toLowerCase();
  const contentFiltered = items.filter((item) => {
    const searchable = `${item.title} ${item.creator || ''} ${item.director || ''}`.toLowerCase();
    return (!queryLower || searchable.includes(queryLower))
      && matchesAny(typeFilters, [item.type])
      && matchesAny(formatFilters, mediaDisplayTags(item))
      && matchesAny(genreFilters, item.genres || [])
      && (!data.mainWatchlist || !stampFilters.length || stampFilters.includes(String(item.interests?.length || 0)));
  });
  const randomPool = contentFiltered.filter((item) => matchesAny(listFilters, item.lists || []));
  const visibleShelves = shelves.filter((shelf) => !listFilters.length || listFilters.includes(shelf.shelf_id));
  const seenOwners = new Set();
  const ownerIntroShelfIds = new Set(visibleShelves.filter((shelf) => {
    const ownerKey = shelf.sourceCollectionId || shelf.ownerName;
    if (!shelf.ownerName || seenOwners.has(ownerKey)) return false;
    seenOwners.add(ownerKey);
    return true;
  }).map((shelf) => shelf.shelf_id));

  const sectionLabel = data.mainWatchlist ? 'Main Watchlist' : section === 'screen' ? 'Film & TV' : section === 'book' ? 'Books' : 'Video Games';
  const singularLabel = data.mainWatchlist ? 'item' : section === 'screen' ? 'film or TV show' : section === 'book' ? 'book' : 'video game';
  const canReorderShelves = canEdit || Boolean(data.mainWatchlist && isAdmin);
  const canCurateMain = Boolean(!data.mainWatchlist && (canEdit || isAdmin));

  const switchSection = (next) => {
    setSection(next);
    setQuery('');
    setListFilters([]);
    setFormatFilters([]);
    setGenreFilters([]);
    setTypeFilters([]);
    setStampFilters([]);
  };

  const pickRandom = () => {
    if (!randomPool.length) {
      notify('Nothing matches the current media filters.');
      return;
    }
    const picked = randomPool[Math.floor(Math.random() * randomPool.length)];
    openMedia(picked.item_id);
  };

  const clearFilters = () => {
    setQuery('');
    setListFilters([]);
    setFormatFilters([]);
    setGenreFilters([]);
    setTypeFilters([]);
    setStampFilters([]);
  };

  const saveShelfOrder = async (ordered, previous) => {
    setOptimisticShelfIds(ordered);
    try {
      if (data.mainWatchlist) await reorderMainWatchlist(accessToken, ordered);
      else await reorderShelves(accessToken, data.collectionId, section, ordered);
      await refresh({ fresh: true });
      notify(data.mainWatchlist ? 'Main Watchlist order saved.' : 'Shelf order saved.');
    } catch {
      setOptimisticShelfIds(previous);
      notify('Shelf order could not be saved.');
      throw new Error('Shelf order could not be saved.');
    }
  };

  const toggleMainWatchlistShelf = async (shelf) => {
    const enabled = !shelf.showInMainWatchlist;
    const previousIds = optimisticMainShelfIds;
    setOptimisticMainShelfIds((ids) => enabled ? [...ids, shelf.shelf_id] : ids.filter((id) => id !== shelf.shelf_id));
    try {
      await updateShelf(accessToken, shelf.shelf_id, { show_in_main_watchlist: enabled });
      await refresh({ fresh: true });
      notify(enabled ? `${shelf.name} added to Main Watchlist.` : `${shelf.name} removed from Main Watchlist.`);
    } catch (error) {
      setOptimisticMainShelfIds(previousIds);
      notify('Main Watchlist selection could not be updated. Apply the latest Supabase migration and try again.');
      throw error;
    }
  };

  return (
    <div className="page media-page">
      <PageHero
        eyebrow={data.mainWatchlist ? 'EVERYONE’S NEXT WATCH' : 'SCREEN, SHELF & STORY'}
        title={data.collectionTitle || 'The media room'}
        description={data.mainWatchlist
          ? 'Every selected shelf, mirrored live from its owner’s collection.'
          : <EditableDescription value={data.collectionDescription} canEdit={canEdit} onSave={onDescriptionChange} title={`${data.collectionTitle || 'Collection'} note`} />}
        icon={Clapperboard}
        stats={[
          [data.mainWatchlist ? items.length : items.filter((item) => ['watchlist', 'reading_list'].some((list) => item.lists?.includes(list))).length, 'to watch/read'],
          [data.mainWatchlist ? shelves.length : items.filter((item) => ['collection', 'library', 'top_shelf', 'xbox', 'rpg', 'action_adventure', 'building_puzzle', 'strategy', 'vr'].some((list) => item.lists?.includes(list))).length, data.mainWatchlist ? 'mirrored shelves' : 'owned'],
        ]}
      />

      <div className="media-command public-media-command">
        <div className={cls('media-tabs', data.mainWatchlist && 'single')}>
          <button className={section === 'screen' ? 'active' : ''} onClick={() => switchSection('screen')}>{data.mainWatchlist ? <ListOrdered /> : <Film />}{data.mainWatchlist ? 'All Watchlists' : 'Film & TV'}</button>
          {!data.mainWatchlist && <button className={section === 'book' ? 'active' : ''} onClick={() => switchSection('book')}><BookOpen />Books</button>}
          {!data.mainWatchlist && <button className={section === 'game' ? 'active' : ''} onClick={() => switchSection('game')}><Gamepad2 />Video Games</button>}
        </div>

        <div className={cls('media-filters', section === 'screen' && 'has-type')}>
          <label className="media-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${sectionLabel.toLowerCase()}…`} /></label>
          <MultiSelect label="All lists" values={listFilters} options={shelves.map((shelf) => [shelf.shelf_id, data.mainWatchlist ? <span className="owned-list-option"><small>{shelf.ownerName}</small><b>{shelf.name}</b></span> : shelf.name])} onChange={setListFilters} />
          {section === 'screen' && !data.mainWatchlist && <MultiSelect label="Film & TV" values={typeFilters} options={sectionTypes} onChange={setTypeFilters} />}
          {data.mainWatchlist && <MultiSelect label="Priority stamps" values={stampFilters} options={['1', '2', '3', '4'].map((count) => [count, `${count} ${count === '1' ? 'Stamp' : 'Stamps'}`])} onChange={setStampFilters} />}
          <MultiSelect label={section === 'game' ? 'All platforms' : 'All formats'} values={formatFilters} options={formats.map((value) => [value, value])} onChange={setFormatFilters} />
          <MultiSelect label="All genres" values={genreFilters} options={genres.map((value) => [value, value])} onChange={setGenreFilters} />
        </div>

        <div className="media-action-row public-actions">
          <Button className="random-pick" icon={Shuffle} onClick={pickRandom}>{data.mainWatchlist ? 'Pick an item' : `Pick a ${singularLabel}`}</Button>
          {(listFilters.length || formatFilters.length || genreFilters.length || typeFilters.length || stampFilters.length || query) && (
            <button className="clear-media-filters" type="button" onClick={clearFilters}><SlidersHorizontal size={14} />Clear filters</button>
          )}
        </div>
      </div>

      <div className="dynamic-shelves">
        {visibleShelves.map((shelf) => {
          const shelfItems = sortShelfItems(
            contentFiltered.filter((item) => item.lists?.includes(shelf.shelf_id)),
            shelf.shelf_id,
            data.media,
          );
          if (!shelfItems.length && queryLower) return null;
          const showOwnerIntro = data.mainWatchlist && ownerIntroShelfIds.has(shelf.shelf_id);
          return <React.Fragment key={shelf.shelf_id}>{showOwnerIntro && <section className="main-owner-intro"><h2>{shelf.ownerName}</h2><EditableDescription value={shelf.ownerNote} canEdit={false} title={`${shelf.ownerName}’s note`} /></section>}<MediaShelf shelf={{ ...shelf, ownerName: data.mainWatchlist ? null : shelf.ownerName, showInMainWatchlist: optimisticMainShelfIds.includes(shelf.shelf_id) }} items={shelfItems} onOpen={openMedia} canEdit={canEdit} canReorderShelf={canReorderShelves} canCurateMain={canCurateMain} canRemoveMirror={Boolean(data.mainWatchlist && isAdmin)} onRemoveMirror={async () => { if (!window.confirm(`Remove ${shelf.name} from Main Watchlist? The original shelf will be left untouched.`)) return; try { await updateShelf(accessToken, shelf.shelf_id, { show_in_main_watchlist: false }); await refresh({ fresh: true }); notify(`${shelf.name} removed from Main Watchlist.`); } catch { notify('That mirror could not be removed.'); } }} onToggleMain={() => toggleMainWatchlistShelf({ ...shelf, showInMainWatchlist: optimisticMainShelfIds.includes(shelf.shelf_id) })} canMoveUp={shelves.findIndex((row) => row.shelf_id === shelf.shelf_id) > 0} canMoveDown={shelves.findIndex((row) => row.shelf_id === shelf.shelf_id) < shelves.length - 1} onMoveShelf={async (direction) => { const previous = shelves.map((row) => row.shelf_id); const ordered = [...previous]; const from = ordered.indexOf(shelf.shelf_id); const to = from + direction; if (to < 0 || to >= ordered.length) return; [ordered[from], ordered[to]] = [ordered[to], ordered[from]]; await saveShelfOrder(ordered, previous); }} onAdd={() => { setAddToShelfIds([shelf.shelf_id]); setAddingMedia(true); }} shelfDragging={draggedShelfId === shelf.shelf_id} onShelfDragStart={(event) => { event.dataTransfer.setData('text/plain', shelf.shelf_id); event.dataTransfer.effectAllowed = 'move'; setDraggedShelfId(shelf.shelf_id); }} onShelfDragEnd={() => setDraggedShelfId(null)} onShelfDrop={async () => { if (!draggedShelfId || draggedShelfId === shelf.shelf_id) return; const previous = shelves.map((row) => row.shelf_id); const ordered = [...previous]; const from = ordered.indexOf(draggedShelfId); const to = ordered.indexOf(shelf.shelf_id); ordered.splice(to, 0, ordered.splice(from, 1)[0]); setDraggedShelfId(null); try { await saveShelfOrder(ordered, previous); } catch {} }} onReorder={async (ordered) => { try { await reorderShelfMedia(accessToken, shelf.shelf_id, ordered); await refresh({ fresh: true }); notify('Item order saved.'); } catch (error) { notify('Item order could not be saved.'); throw error; } }} onRename={async () => { const name = window.prompt('Shelf name', shelf.name); if (name?.trim() && name.trim() !== shelf.name) { await updateShelf(accessToken, shelf.shelf_id, { name: name.trim() }); await refresh({ fresh: true }); } }} onDelete={async () => { if (window.confirm(`Move ${shelf.name} to Bin? Its media will remain.`)) { await updateShelf(accessToken, shelf.shelf_id, { deleted_at: new Date().toISOString() }); await refresh({ fresh: true }); } }} /></React.Fragment>;
        })}
      </div>

      {!randomPool.length && <Empty>No media matches those filters.</Empty>}
      {canEdit && <section className="collection-tools"><div><span className="eyebrow">COLLECTION TOOLS</span><p>Manage this section without cluttering the shelves.</p></div><form className="inline-create" onSubmit={async (event) => { event.preventDefault(); if (!newShelf.trim()) return; try { await createShelf(accessToken, { collection_id: data.collectionId, section, name: newShelf.trim(), position: (shelves.at(-1)?.position || 0) + 1000 }); setNewShelf(''); await refresh({ fresh: true }); notify('Shelf created.'); } catch { notify('That shelf could not be created. Names must be unique within this section.'); } }}><input value={newShelf} onChange={(event) => setNewShelf(event.target.value)} placeholder="Name a new shelf" aria-label="New shelf name" /><Button type="submit" icon={Plus}>Add shelf</Button></form><Button className="quiet-button" icon={Download} onClick={onExport}>Export backup</Button></section>}
      {addingMedia && <AddMediaDialog section={section} shelves={shelves} initialShelfIds={addToShelfIds} onClose={() => { setAddingMedia(false); setAddToShelfIds([]); }} onSave={async (item, shelfIds) => { const created = await createMediaItem(accessToken, { ...item, collection_id: data.collectionId }); await replaceMediaShelfMemberships(accessToken, created[0].id, [], shelfIds); setAddingMedia(false); setAddToShelfIds([]); await refresh({ fresh: true }); notify('Media added.'); }} />}
    </div>
  );
}

function MediaShelf({ shelf, items, onOpen, canEdit, canReorderShelf, canCurateMain, canRemoveMirror, onRemoveMirror, onToggleMain, canMoveUp, canMoveDown, onMoveShelf, onAdd, shelfDragging, onShelfDragStart, onShelfDragEnd, onShelfDrop, onReorder, onRename, onDelete }) {
  const trackRef = useRef(null);
  const [draggedId, setDraggedId] = useState(null);
  const [displayItems, setDisplayItems] = useState(items);
  const [arranging, setArranging] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const serverOrderKey = items.map((item) => `${item.database_id}:${item.updated_at || ''}:${item.list_positions?.[shelf.shelf_id] ?? ''}:${(item.interests || []).map((person) => person.id || person.username).sort().join(',')}`).join('|');
  useEffect(() => { setDisplayItems(items); }, [serverOrderKey]);
  const rowBreak = Math.ceil(displayItems.length / 2);
  const displayRows = [displayItems.slice(0, rowBreak), displayItems.slice(rowBreak)];
  const pageCount = Math.ceil(Math.max(...displayRows.map((row) => row.length), 0) / 7);
  const displayPages = Array.from({ length: pageCount }, (_, pageIndex) => displayRows.map((row) => row.slice(pageIndex * 7, (pageIndex + 1) * 7)));
  useEffect(() => { setCurrentPage((page) => Math.min(page, Math.max(pageCount - 1, 0))); }, [pageCount]);
  const scrollPage = (direction) => {
    const track = trackRef.current;
    if (!track) return;
    const nextPage = Math.max(0, Math.min(currentPage + direction, Math.max(pageCount - 1, 0)));
    setCurrentPage(nextPage);
    const page = track.querySelector('.poster-page');
    track.scrollTo({ left: nextPage * ((page?.offsetWidth || track.clientWidth) + 24), behavior: 'smooth' });
  };

  return (
    <section className={cls('media-shelf', shelfDragging && 'shelf-dragging')} onDragOver={(event) => canReorderShelf && event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (canReorderShelf) onShelfDrop?.(); }}>
      <div className="shelf-head">
        <div className="shelf-title">
          {canReorderShelf && <button className="shelf-drag-handle" aria-label={`Drag ${shelf.name} to reorder`} title="Drag to reorder shelf" draggable onDragStart={onShelfDragStart} onDragEnd={onShelfDragEnd}><GripVertical size={16} /></button>}
          <span className="shelf-heading-copy">{shelf.ownerName && <small>{shelf.ownerName}</small>}<h2>{shelf.name}<span>{items.length}</span></h2></span>
        </div>
        <div className="shelf-actions">
          <span className="shelf-action-group shelf-content-actions">{canRemoveMirror && <button className="remove-main-mirror" onClick={onRemoveMirror} title="Remove this mirror; the original shelf stays unchanged"><X size={14} /><span>Remove from Main</span></button>}{canEdit && items.length > 1 && <button className="shelf-control-button arrange-button" aria-label={`Arrange items in ${shelf.name}`} title="Arrange shelf" onClick={() => setArranging(true)}><ListOrdered size={15} /><span>Arrange shelf</span></button>}{canCurateMain && <button className={cls('shelf-control-button main-watchlist-toggle', shelf.showInMainWatchlist && 'active')} aria-pressed={shelf.showInMainWatchlist} aria-label={`${shelf.showInMainWatchlist ? 'Remove' : 'Add'} ${shelf.name} ${shelf.showInMainWatchlist ? 'from' : 'to'} Main Watchlist`} title={shelf.showInMainWatchlist ? 'Click to remove from Main Watchlist' : 'Show in Main Watchlist'} onClick={onToggleMain}><ListOrdered size={15} /><span>{shelf.showInMainWatchlist ? 'Included' : 'Include this shelf'}</span>{shelf.showInMainWatchlist && <Check size={14} />}</button>}{canEdit && <Button className="shelf-control-button shelf-add-button" icon={Plus} onClick={onAdd}>Add item</Button>}</span>
          <span className="shelf-action-group shelf-order-actions">{canReorderShelf && <button aria-label={`Move ${shelf.name} up`} title="Move shelf up" disabled={!canMoveUp} onClick={() => onMoveShelf(-1)}><ArrowUp size={15} /></button>}{canReorderShelf && <button aria-label={`Move ${shelf.name} down`} title="Move shelf down" disabled={!canMoveDown} onClick={() => onMoveShelf(1)}><ArrowDown size={15} /></button>}</span>
          <span className="shelf-action-group shelf-edit-actions">{canEdit && !shelf.required && <button aria-label={`Rename ${shelf.name}`} title="Rename shelf" onClick={onRename}><Pencil size={15} /></button>}{canEdit && !shelf.required && <button className="delete-shelf" aria-label={`Delete ${shelf.name}`} title="Move shelf to Bin" onClick={onDelete}><X size={15} /></button>}</span>
          <span className="shelf-action-group shelf-page-actions"><button aria-label={`Scroll ${shelf.name} left`} disabled={currentPage <= 0 || pageCount <= 1} onClick={() => scrollPage(-1)}><ChevronLeft /></button>{pageCount > 1 && <small>{currentPage + 1} / {pageCount}</small>}<button aria-label={`Scroll ${shelf.name} right`} disabled={currentPage >= pageCount - 1 || pageCount <= 1} onClick={() => scrollPage(1)}><ChevronRight /></button></span>
        </div>
      </div>
      <div className="poster-track" ref={trackRef} onScroll={(event) => { const page = event.currentTarget.querySelector('.poster-page'); const width = (page?.offsetWidth || event.currentTarget.clientWidth) + 24; if (width > 0) setCurrentPage(Math.max(0, Math.min(Math.round(event.currentTarget.scrollLeft / width), Math.max(pageCount - 1, 0)))); }}>
        {displayPages.map((pageRows, pageIndex) => <div className="poster-page" key={pageIndex}>
          {pageRows.flat().map((item) => <MediaCard key={item.item_id} item={item} onClick={() => onOpen(item.item_id)} draggable={canEdit} dragging={draggedId === item.database_id} onDragStart={(event) => { event.dataTransfer.setData('text/plain', item.database_id); event.dataTransfer.effectAllowed = 'move'; setDraggedId(item.database_id); }} onDragEnd={() => setDraggedId(null)} onDrop={async () => { if (!draggedId || draggedId === item.database_id) return; const previous = [...displayItems]; const next = [...displayItems]; const from = next.findIndex((entry) => entry.database_id === draggedId); const to = next.findIndex((entry) => entry.database_id === item.database_id); next.splice(to, 0, next.splice(from, 1)[0]); setDisplayItems(next); setDraggedId(null); try { await onReorder(next.map((entry) => entry.database_id)); } catch { setDisplayItems(previous); } }} />)}
        </div>)}
        {!displayItems.length && <div className="empty-poster">No items on this shelf yet.</div>}
      </div>
      {arranging && <ArrangeShelfDialog shelf={shelf} items={displayItems} onClose={() => setArranging(false)} onSave={async (nextItems) => { const previous = [...displayItems]; setDisplayItems(nextItems); setArranging(false); try { await onReorder(nextItems.map((item) => item.database_id)); } catch { setDisplayItems(previous); } }} />}
    </section>
  );
}

const MAIN_WATCHLIST_ID = 'main-watchlist';

function ArrangeShelfDialog({ shelf, items, onClose, onSave }) {
  useEscape(onClose);
  const [ordered, setOrdered] = useState(items);
  const [saving, setSaving] = useState(false);
  const [draggedItemId, setDraggedItemId] = useState(null);
  const [positionDrafts, setPositionDrafts] = useState({});
  const move = (index, destination) => {
    if (destination < 0 || destination >= ordered.length || destination === index) return;
    setOrdered((current) => {
      const next = [...current];
      next.splice(destination, 0, next.splice(index, 1)[0]);
      return next;
    });
  };
  const moveById = (itemId, destination) => {
    const index = ordered.findIndex((item) => item.database_id === itemId);
    move(index, destination);
  };
  const commitPosition = (itemId, currentIndex) => {
    const raw = positionDrafts[itemId];
    const destination = Math.max(0, Math.min(ordered.length - 1, Number(raw) - 1));
    if (Number.isInteger(destination)) move(currentIndex, destination);
    setPositionDrafts((current) => { const next = { ...current }; delete next[itemId]; return next; });
  };
  const rowBreak = Math.ceil(ordered.length / 2);
  const rows = [ordered.slice(0, rowBreak), ordered.slice(rowBreak)];
  return <div className="modal-layer editor-layer"><section className="media-edit-dialog arrange-dialog">
    <button className="close" type="button" onClick={onClose} aria-label="Close arranger"><X /></button>
    <span className="eyebrow">ARRANGE SHELF</span><h2>{shelf.name}</h2>
    <p className="dialog-intro">Drag an item anywhere—including between rows—or click its position number and type exactly where it should go.</p>
    <div className="arrange-help"><span><GripVertical size={13} />Drag to move</span><span className="position-demo">12</span><span>Click a number to enter a position</span></div>
    <div className="arrange-rows">{rows.map((row, rowIndex) => <section className="arrange-row" key={rowIndex}>
      <header><span>ROW {rowIndex + 1}</span><small>{row.length ? `${rowIndex === 0 ? 1 : rowBreak + 1}–${rowIndex === 0 ? rowBreak : ordered.length}` : 'Empty'}</small></header>
      <ol className="arrange-list">{row.map((item) => { const index = ordered.findIndex((entry) => entry.database_id === item.database_id); return <li className={draggedItemId === item.database_id ? 'dragging' : ''} key={item.database_id} draggable onDragStart={(event) => { event.dataTransfer.setData('text/plain', item.database_id); event.dataTransfer.effectAllowed = 'move'; setDraggedItemId(item.database_id); }} onDragEnd={() => setDraggedItemId(null)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (draggedItemId && draggedItemId !== item.database_id) moveById(draggedItemId, index); setDraggedItemId(null); }}>
        <GripVertical className="arrange-grip" size={14} />
        <input className="arrange-position" aria-label={`Position for ${item.title}`} inputMode="numeric" value={positionDrafts[item.database_id] ?? index + 1} onFocus={() => setPositionDrafts((current) => ({ ...current, [item.database_id]: String(index + 1) }))} onChange={(event) => setPositionDrafts((current) => ({ ...current, [item.database_id]: event.target.value.replace(/\D/g, '') }))} onBlur={() => commitPosition(item.database_id, index)} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
        {item.poster_url ? <img src={item.poster_url} alt="" /> : <span className="arrange-poster-fallback"><Clapperboard size={13} /></span>}
        <strong>{cleanImportedMediaTitle(item.title)}</strong>
        <div className="arrange-row-actions">
          <button disabled={index === 0} onClick={() => move(index, 0)} title="Move to beginning" aria-label={`Move ${item.title} to beginning`}><ChevronsUp size={14} /></button>
          <button disabled={index === ordered.length - 1} onClick={() => move(index, ordered.length - 1)} title="Move to end" aria-label={`Move ${item.title} to end`}><ChevronsDown size={14} /></button>
        </div>
      </li>; })}</ol>
    </section>)}</div>
    <div className="dialog-actions"><button className="text-button" onClick={onClose}>Cancel</button><Button disabled={saving} onClick={async () => { setSaving(true); try { await onSave(ordered); } finally { setSaving(false); } }}>{saving ? 'Saving…' : 'Save order'}</Button></div>
  </section></div>;
}

function MediaCard({ item, onClick, draggable, dragging, onDragStart, onDragEnd, onDrop }) {
  const tags = mediaDisplayTags(item);
  const title = cleanImportedMediaTitle(item.title);
  return (
    <button className={cls('media-card', dragging && 'is-dragging')} title="Open item" onClick={onClick} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={(event) => draggable && event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop?.(); }}>
      {item.poster_url
        ? <img src={item.poster_url} alt={`${title} poster`} loading="lazy" />
        : <div className="poster-fallback"><Clapperboard /><span>{title}</span></div>}
      <span className="media-card-title">{title}</span>
      <span className="media-card-meta">
        {tags.length > 0 && (
          <span className="media-format-list">
            {tags.map((tag) => <span className={cls('media-format-tag', mediaTagTone(tag, item.type === 'game'))} key={tag}>{tag}</span>)}
          </span>
        )}
        {tags.length > 0 && item.year && <span className="media-meta-dash">—</span>}
        {item.year && <span className="media-year">{item.year}</span>}
        {item.interests?.map((person) => <span className="card-interest" title={person.display_name || person.username} key={person.username}>— {String(person.display_name || person.username).slice(0, 1).toUpperCase()}</span>)}
      </span>
    </button>
  );
}

function MediaDrawer({ item, shelves, onClose, canEdit, onUpdate, onUpdateShelves, canInterest, interested, onInterest, onDelete, onRestore }) {
  const [editing, setEditing] = useState(false);
  const [editingShelves, setEditingShelves] = useState(false);
  const [selectedShelves, setSelectedShelves] = useState([]);
  const [savingShelves, setSavingShelves] = useState(false);
  const [shelfError, setShelfError] = useState('');
  const [optimisticInterest, setOptimisticInterest] = useState(interested);
  useEscape(() => setEditingShelves(false), editingShelves);
  useEffect(() => { setOptimisticInterest(interested); }, [interested, item.database_id]);
  const tags = mediaDisplayTags(item);
  const title = cleanImportedMediaTitle(item.title);
  const memberShelves = shelves.filter((shelf) => item.lists?.includes(shelf.shelf_id));

  return (
    <div className="drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <aside className="media-drawer public-drawer">
        <button className="close" onClick={onClose}><X /></button>
        <div className="drawer-layout">
          <div className="drawer-poster">
            {item.poster_url
              ? <img src={item.poster_url} alt={`${title} poster`} />
              : <div className="poster-fallback"><Clapperboard /><span>{title}</span></div>}
          </div>
          <div className="drawer-copy">
            <span className="eyebrow">{item.type}{item.runtime ? ` · ${item.runtime} min` : ''}</span>
            <h1>{title}</h1>
            <div className="drawer-meta-tags">
              {tags.length > 0 && (
                <span className="drawer-format-list">
                  {tags.map((tag) => <span className={cls('drawer-format-tag', mediaTagTone(tag, item.type === 'game'))} key={tag}>{tag}</span>)}
                </span>
              )}
              {tags.length > 0 && item.year && <span className="media-meta-dash">—</span>}
              {item.year && <span className="drawer-year">{item.year}</span>}
              {item.interests?.map((person) => <span className="interest-initial" title={person.display_name} key={person.username}>— {String(person.display_name || person.username).slice(0, 1).toUpperCase()}</span>)}
            </div>
            <p className="creator">{item.director || item.creator}</p>
            {canInterest && <button className={cls('priority-watch', optimisticInterest && 'active')} onClick={async () => { const previous = optimisticInterest; const next = !previous; setOptimisticInterest(next); try { await onInterest(next); } catch { setOptimisticInterest(previous); } }}><span>{optimisticInterest ? '✓' : '+'}</span>{optimisticInterest ? 'Priority Watch' : 'Mark Priority Watch'}</button>}
            {canEdit && <div className="drawer-owner-actions">
              <Button className="drawer-edit-button primary" icon={Pencil} onClick={() => setEditing(true)}>Edit details</Button>
              <Button className="drawer-edit-button" onClick={() => {
                setSelectedShelves(item.lists || []);
                setShelfError('');
                setEditingShelves(true);
              }}>Edit shelves</Button>
            </div>}
            <p className="drawer-description">{item.description || item.notes || 'No description has been added yet.'}</p>
            <div className="genre-row">{item.genres?.map((genre) => <span key={genre}>{genre}</span>)}</div>
            <div className="drawer-lists public-shelf-list">
              <span className="eyebrow">SHELVES</span>
              {memberShelves.length
                ? memberShelves.map((shelf) => <span className="public-shelf-chip" key={shelf.shelf_id}><Check size={13} />{shelf.name}</span>)
                : <small>No public shelf membership.</small>}
            </div>
            {canEdit && <div className="drawer-danger-zone">
              {item.deleted_at ? <button onClick={onRestore}>Restore from Bin</button> : <button onClick={() => onDelete(false)}><Trash2 size={14} />Move to Bin</button>}
              <button className="permanent-delete" onClick={() => onDelete(true)}>Delete permanently</button>
            </div>}
          </div>
        </div>
      </aside>
      {editingShelves && <div className="modal-layer editor-layer"><section className="media-edit-dialog shelf-membership-dialog">
        <button className="close" onClick={() => setEditingShelves(false)} aria-label="Close shelf editor"><X /></button>
        <span className="eyebrow">SHELF MEMBERSHIP</span><h2>Choose shelves</h2>
        <div className="shelf-membership-options">{shelves.map((shelf) => <label key={shelf.shelf_id}><input type="checkbox" checked={selectedShelves.includes(shelf.shelf_id)} onChange={() => setSelectedShelves((current) => current.includes(shelf.shelf_id) ? current.filter((id) => id !== shelf.shelf_id) : [...current, shelf.shelf_id])} />{shelf.name}</label>)}</div>
        {shelfError && <p className="auth-error">{shelfError}</p>}
        <Button disabled={savingShelves} onClick={async () => {
          setSavingShelves(true); setShelfError('');
          try { await onUpdateShelves(item.lists || [], selectedShelves); setEditingShelves(false); }
          catch { setShelfError('The shelf membership could not be saved. Existing shelves were left in place.'); }
          finally { setSavingShelves(false); }
        }}>{savingShelves ? 'Saving…' : 'Save shelves'}</Button>
      </section></div>}
      {editing && <EditMediaDialog item={item} onClose={() => setEditing(false)} onSave={async (changes) => {
        await onUpdate(changes);
        setEditing(false);
      }} />}
    </div>
  );
}

function SearchModal({ data, query, setQuery, onClose, onOpen }) {
  useEscape(onClose);
  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? active(data.media).filter((item) => `${item.title} ${item.creator || ''} ${item.director || ''} ${item.type} ${(item.genres || []).join(' ')}`.toLowerCase().includes(normalizedQuery))
    : [];

  return (
    <div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="search-modal">
        <div className="search-box">
          <Search />
          <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search films, television, books and video games…" />
          <button onClick={onClose}><X /></button>
        </div>
        <div className="search-results">
          {normalizedQuery && results.slice(0, 40).map((item) => (
            <button key={item.item_id} onClick={() => onOpen(item.item_id)}>
              <span className="status-pill">{item.type}</span>
              <span><b>{cleanImportedMediaTitle(item.title)}</b><small>{item.creator || item.director || item.year || item.type}</small></span>
              <ChevronRight />
            </button>
          ))}
          {normalizedQuery && !results.length && <Empty>No results found.</Empty>}
          {!normalizedQuery && <Empty>Start typing to search the collection.</Empty>}
        </div>
      </div>
    </div>
  );
}


function AccountDialog({ account, onClose, onSignedIn, onSignedOut, onManageUsers }) {
  useEscape(onClose);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setError('');
    try {
      onSignedIn(await signInWithPassword(email.trim(), password));
    } catch {
      setError('We could not sign you in with those details.');
    } finally {
      setSubmitting(false);
    }
  };

  const register = async (event) => {
    event.preventDefault();
    setSubmitting(true); setError('');
    try {
      const result = await registerWithPassword({ email: email.trim(), password, username: username.trim().toLowerCase(), displayName: displayName.trim() });
      if (result.session) onSignedIn(await loadAuthenticatedAccount());
      else { setRegistering(false); setPassword(''); setError('Registration received. Check your email if Supabase asks you to confirm it, then wait for approval.'); }
    } catch { setError('We could not create that account. Try a different email or username.'); }
    finally { setSubmitting(false); }
  };

  const leave = async () => {
    setSubmitting(true);
    try {
      await signOut();
      onSignedOut();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="account-dialog" aria-label="Account">
        <button className="close" onClick={onClose} aria-label="Close account"><X /></button>
        {account ? (
          <>
            <span className="eyebrow">SIGNED IN</span>
            <h2>{account.profile?.display_name || account.profile?.username || 'Media Room member'}</h2>
            <p>{account.profile?.role === 'admin' ? 'Administrator account' : account.profile?.deactivated_at ? 'Account deactivated — your library is safely stored.' : account.profile?.approved_at ? 'Approved member' : 'Pending approval'}</p>
            {account.profile?.role === 'admin' && <Button onClick={onManageUsers}>User management</Button>}<Button icon={LogOut} onClick={leave} disabled={submitting}>Sign out</Button>
          </>
        ) : (
          <>
            <span className="eyebrow">ACCOUNT</span>
            <h2>Sign in</h2>
            <p>Use your Media Room email and password.</p>
            <form onSubmit={registering ? register : submit}>
              {registering && <><label>Recognisable name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label><label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} pattern="[a-z0-9_-]{3,32}" required /></label></>}
              <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
              <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={registering ? 'new-password' : 'current-password'} required /></label>
              {registering && <p>Use a recognisable real name for this private group, and do not reuse an important password.</p>}
              {error && <p className="auth-error">{error}</p>}
              <Button type="submit" icon={LogIn} disabled={submitting}>{submitting ? 'Working…' : registering ? 'Create account' : 'Sign in'}</Button>
              <button className="auth-switch" type="button" onClick={() => { setRegistering(!registering); setError(''); }}>{registering ? 'I already have an account' : 'Create an account'}</button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}


function AddMediaDialog({ section, shelves, initialShelfIds = [], onClose, onSave }) {
  useEscape(onClose);
  const [title, setTitle] = useState(''); const [type, setType] = useState(section === 'screen' ? 'film' : section); const [year, setYear] = useState(''); const [shelfIds, setShelfIds] = useState(initialShelfIds); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const destination = shelves.find((shelf) => shelfIds.includes(shelf.shelf_id));
  return <div className="modal-layer editor-layer"><form className="media-edit-dialog add-media-dialog" onSubmit={async (event) => { event.preventDefault(); if (!title.trim()) return; setSaving(true); setError(''); try { await onSave({ title: title.trim(), type, year: year ? Number(year) : null, platforms: [], genres: [] }, shelfIds); } catch { setError('The media item could not be saved. Check the fields and try again.'); setSaving(false); } }}>
    <button className="close" type="button" onClick={onClose} aria-label="Close add item"><X /></button><span className="eyebrow">ADD TO {destination?.name?.toUpperCase() || 'COLLECTION'}</span><h2>Add an item</h2><p className="dialog-intro">Start with the essentials. You can add artwork, notes and full details after saving.</p>
    <div className="media-edit-grid"><label className="full">Title<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Title" required /></label><label>Type<select value={type} onChange={(event) => setType(event.target.value)}>{section === 'screen' ? <><option value="film">Film</option><option value="television">Television</option></> : <option value={section}>{section === 'book' ? 'Book' : 'Video game'}</option>}</select></label><label>Year <span className="optional">optional</span><input type="number" min="1000" max="3000" placeholder="YYYY" value={year} onChange={(event) => setYear(event.target.value)} /></label><fieldset className="full shelf-picker"><legend>Also add to</legend>{shelves.map((shelf) => <label className={shelfIds.includes(shelf.shelf_id) ? 'selected' : ''} key={shelf.shelf_id}><input type="checkbox" checked={shelfIds.includes(shelf.shelf_id)} onChange={() => setShelfIds((ids) => ids.includes(shelf.shelf_id) ? ids.filter((id) => id !== shelf.shelf_id) : [...ids, shelf.shelf_id])} /><span>{shelf.name}</span></label>)}</fieldset></div>
    {error && <p className="auth-error">{error}</p>}<div className="dialog-actions"><button type="button" className="text-button" onClick={onClose}>Cancel</button><Button type="submit" icon={Plus} disabled={saving}>{saving ? 'Adding…' : 'Add item'}</Button></div>
  </form></div>;
}

function EditMediaDialog({ item, onClose, onSave }) {
  useEscape(onClose);
  const [form, setForm] = useState({
    title: item.title || '', year: item.year ?? '', creator: item.creator || '', director: item.director || '',
    description: item.description || '', notes: item.notes || '', poster_url: item.poster_url || '',
    format: item.format || '', platforms: (item.platforms || []).join(', '), genres: (item.genres || []).join(', '),
    runtime: item.runtime ?? '', rating: item.rating ?? '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  const optionalNumber = (value, { integer = false, min, max } = {}) => {
    if (value === '') return null;
    const number = Number(value);
    if (!Number.isFinite(number) || (integer && !Number.isInteger(number)) || (min !== undefined && number < min) || (max !== undefined && number > max)) return undefined;
    return number;
  };
  const list = (value) => [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];

  const submit = async (event) => {
    event.preventDefault();
    const year = optionalNumber(form.year, { integer: true, min: 1000, max: 3000 });
    const runtime = optionalNumber(form.runtime, { integer: true, min: 1 });
    const rating = optionalNumber(form.rating, { min: 0, max: 10 });
    if (year === undefined || runtime === undefined || rating === undefined || !form.title.trim()) {
      setError('Enter a title, a whole year from 1000–3000, a positive whole runtime, and a rating from 0–10.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        title: form.title.trim(), year, creator: form.creator.trim() || null, director: form.director.trim() || null,
        description: form.description.trim() || null, notes: form.notes.trim() || null, poster_url: form.poster_url.trim() || null,
        format: form.format.trim() || null, platforms: list(form.platforms), genres: list(form.genres), runtime, rating,
      });
    } catch {
      setError('The details could not be saved. Nothing on the page was changed.');
    } finally {
      setSaving(false);
    }
  };

  return <div className="modal-layer editor-layer">
    <form className="media-edit-dialog" onSubmit={submit}>
      <button className="close" type="button" onClick={onClose} aria-label="Close editor"><X /></button>
      <span className="eyebrow">MEDIA DETAILS</span><h2>Edit {cleanImportedMediaTitle(item.title)}</h2>
      <div className="media-edit-grid">
        <label>Title<input value={form.title} onChange={set('title')} required /></label>
        <label>Year<input type="number" value={form.year} onChange={set('year')} /></label>
        <label>Creator<input value={form.creator} onChange={set('creator')} /></label>
        <label>Director<input value={form.director} onChange={set('director')} /></label>
        <label>Format<input value={form.format} onChange={set('format')} /></label>
        <label>Platforms (comma separated)<input value={form.platforms} onChange={set('platforms')} /></label>
        <label>Genres (comma separated)<input value={form.genres} onChange={set('genres')} /></label>
        <label>Runtime (minutes)<input type="number" value={form.runtime} onChange={set('runtime')} /></label>
        <label>Rating (0–10)<input type="number" step="0.1" value={form.rating} onChange={set('rating')} /></label>
        <label className="full">Poster URL<input type="url" value={form.poster_url} onChange={set('poster_url')} /></label>
        <label className="full">Description<textarea value={form.description} onChange={set('description')} rows="4" /></label>
        <label className="full">Notes<textarea value={form.notes} onChange={set('notes')} rows="3" /></label>
      </div>
      {error && <p className="auth-error">{error}</p>}
      <Button type="submit" icon={Pencil} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
    </form>
  </div>;
}

function AdminUsers({ accessToken, onClose, onUsersChanged }) {
  useEscape(onClose);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = () => listProfiles(accessToken).then(setUsers).catch(() => setError('Could not load users.'));
  useEffect(() => { load(); }, []);
  const actions = { approve: approveProfile, reject: rejectProfile, deactivate: deactivateProfile, restore: restoreProfile };
  const act = async (type, user) => {
    if (type === 'deactivate' && !window.confirm(`Deactivate ${user.display_name}? Their library will disappear publicly but all data will be retained.`)) return;
    setBusy(user.id); setError('');
    try { await actions[type](accessToken, user.id); await load(); await onUsersChanged?.(); }
    catch { setError('That user could not be updated.'); }
    finally { setBusy(''); }
  };
  return <div className="modal-layer"><section className="media-edit-dialog admin-users-dialog"><button className="close" onClick={onClose}><X /></button><span className="eyebrow">ADMIN</span><h2>User Management</h2><p className="dialog-intro">Approve new members or temporarily hide a member and their library without deleting anything.</p>{error && <p className="auth-error">{error}</p>}<div className="user-list">{users.map((user) => {
    const status = user.deactivated_at ? 'Deactivated' : user.approved_at ? 'Approved' : user.rejected_at ? 'Rejected' : 'Pending';
    return <div className={cls('user-row', user.deactivated_at && 'deactivated')} key={user.id}><span><b>{user.display_name}</b><small>@{user.username}</small></span><span className="user-status">{status}</span>{!user.approved_at && !user.rejected_at && <><Button disabled={busy === user.id} onClick={() => act('approve', user)}>Approve</Button><Button disabled={busy === user.id} onClick={() => act('reject', user)}>Reject</Button></>}{user.approved_at && user.role !== 'admin' && !user.deactivated_at && <Button className="quiet-button" disabled={busy === user.id} onClick={() => act('deactivate', user)}>Deactivate</Button>}{user.deactivated_at && <Button disabled={busy === user.id} onClick={() => act('restore', user)}>Restore library</Button>}</div>;
  })}</div></section></div>;
}
