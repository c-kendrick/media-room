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
  Film,
  Download,
  Gamepad2,
  GripVertical,
  ListOrdered,
  LogIn,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  RotateCw,
  Search,
  Shuffle,
  SlidersHorizontal,
  Trash2,
  Upload,
  ChevronsDown,
  ChevronsUp,
  UserRound,
  Users,
  X,
} from 'lucide-react';
import { loadMediaSnapshot } from './data.js';
import { loadAuthenticatedAccount, registerWithPassword, signInWithPassword, signOut, updateDisplayName, updatePassword } from './auth.js';
import { loadPublicCollections } from './supabase-data.js';
import { bulkImportMedia, chooseDetailCandidate, choosePosterCandidate, createMediaItem, createShelf, deleteShelf, enrichSectionDetails, enrichSectionPosters, importCollectionBackup, permanentlyDeleteMedia, replaceMediaShelfMemberships, reorderCollections, reorderMainWatchlist, reorderShelfMedia, reorderShelves, searchDetailCandidates, searchPosterCandidates, setInterest, setMediaDeleted, setMediaStarRating, updateCollection, updateMediaItem, updateShelf } from './media-write.js';
import { approveProfile, createClub, deactivateProfile, deleteClub, listClubs, listProfiles, rejectProfile, renameClub, restoreProfile, setUserClubs } from './admin.js';
import { matchesStarRatings, normalizeStarRating, STAR_RATING_STEPS } from './star-rating.js';
import { applyShelfMemberships } from './shelf-membership.js';
import { SECTION_NOTE_COLUMNS, SECTION_NOTE_DEFAULTS } from './section-notes.js';
import { matchesOwnership, OWNERSHIP_FILTER_OPTIONS } from './ownership-filter.js';
import { BACKUP_IMPORT_LIMITS, parseCollectionBackup } from './backup-import.js';
import { collectionSummaryStats } from './collection-stats.js';

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
  const payload = { exported_at: new Date().toISOString(), format: 'media-room/v1', collection: { id: snapshot.collectionId, title: snapshot.collectionTitle, owner_id: snapshot.ownerId, descriptions: snapshot.collectionDescriptions }, shelves: snapshot.mediaShelves, media: snapshot.media };
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

function mediaCardDisplayTags(item) {
  if (item.type === 'book') return item.creator?.trim() ? [item.creator.trim()] : [];
  return mediaDisplayTags(item);
}

function mediaSearchText(item) {
  return [item.title, item.creator, item.director, item.description, item.notes, item.type, item.year, item.status, item.priority, item.format, item.runtime, ...(item.platforms || []), ...(item.genres || [])]
    .filter((value) => value !== null && value !== undefined)
    .join(' ')
    .toLowerCase();
}

function retryLabel(seconds) {
  if (!seconds) return '';
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return minutes ? `${minutes}m ${String(remainder).padStart(2, '0')}s` : `${remainder}s`;
}

const ADMIN_MAIN_CLUB_KEY = 'kits-media-admin-main-club';

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
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
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
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedMediaId, setSelectedMediaId] = useState(null);
  const [account, setAccount] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [accountOpen, setAccountOpen] = useState(false);
  const [viewAsMember, setViewAsMember] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminClubs, setAdminClubs] = useState([]);
  const [adminMainClubId, setAdminMainClubId] = useState(() => window.localStorage.getItem(ADMIN_MAIN_CLUB_KEY) || '');
  const [confirmation, setConfirmation] = useState(null);
  const [collections, setCollections] = useState([]);
  const [draggedCollectionId, setDraggedCollectionId] = useState(null);
  const [collectionsLoading, setCollectionsLoading] = useState(true);
  const [collectionId, setCollectionId] = useState(null);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [landingApplied, setLandingApplied] = useState(false);
  const snapshotCache = useRef(new Map());
  const latestRequest = useRef(0);
  const userSelectedCollection = useRef(false);
  const accessToken = account?.session?.access_token;
  const selectedAdminMainClub = adminClubs.find((club) => club.id === adminMainClubId);
  const adminMemberClubs = adminClubs.filter((club) => club.member_ids.includes(account?.profile?.id));
  const memberViewOwnerIds = new Set(adminMemberClubs.flatMap((club) => club.member_ids));
  if (account?.profile?.id) memberViewOwnerIds.add(account.profile.id);
  const displayedCollections = account?.profile?.role === 'admin' && viewAsMember
    ? collections.filter((collection) => collection.slug === 'kits-collection' || memberViewOwnerIds.has(collection.owner_id))
    : collections;
  const mainWatchlistOwnerIds = account?.profile?.role === 'admin'
    ? viewAsMember
      ? [...memberViewOwnerIds]
      : selectedAdminMainClub?.member_ids
    : undefined;
  const mainWatchlistScopeKey = mainWatchlistOwnerIds ? [...mainWatchlistOwnerIds].sort().join(',') : 'all';

  const cacheSnapshot = (snapshot, requestedCollectionId = null) => {
    if (snapshot?.collectionId) snapshotCache.current.set(snapshot.collectionId, snapshot);
    if (!requestedCollectionId) snapshotCache.current.set('default', snapshot);
  };

  const refresh = async ({ fresh = false, notify = false, targetCollectionId = collectionId } = {}) => {
    const request = ++latestRequest.current;
    if (fresh) setRefreshing(true);
    try {
      const snapshot = await loadMediaSnapshot({ fresh, collectionId: targetCollectionId, accessToken, mainWatchlistOwnerIds });
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
  }, [collectionId, accessToken, mainWatchlistScopeKey]);

  useEffect(() => {
    setCollectionsLoading(true);
    loadPublicCollections({ fresh: true, accessToken })
      .then((nextCollections) => {
        setCollections(nextCollections);
        if (data?.collectionId && data.collectionId !== MAIN_WATCHLIST_ID && !nextCollections.some((collection) => collection.id === data.collectionId)) {
          const kit = nextCollections.find((collection) => collection.slug === 'kits-collection');
          if (kit) selectCollection(kit.id, { userInitiated: false });
        }
      })
      .catch(() => setCollections([]))
      .finally(() => setCollectionsLoading(false));
  }, [accessToken]);

  useEffect(() => {
    if (account?.profile?.role !== 'admin' || !accessToken) {
      setAdminClubs([]);
      return;
    }
    listClubs(accessToken).then((clubs) => {
      setAdminClubs(clubs || []);
      if (adminMainClubId && !(clubs || []).some((club) => club.id === adminMainClubId)) {
        window.localStorage.removeItem(ADMIN_MAIN_CLUB_KEY);
        setAdminMainClubId('');
      }
    }).catch(() => setAdminClubs([]));
  }, [accessToken, account?.profile?.role]);

  useEffect(() => {
    if (!data?.collectionId || !collections.length) return undefined;
    let cancelled = false;
    const prefetch = async () => {
      for (const collection of displayedCollections) {
        if (cancelled || snapshotCache.current.has(collection.id)) continue;
        try {
          const snapshot = await loadMediaSnapshot({ collectionId: collection.id, accessToken });
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
  }, [collections, data?.collectionId, accessToken, viewAsMember, adminClubs]);

  useEffect(() => {
    if (!viewAsMember || account?.profile?.role !== 'admin' || !data?.collectionId || data.collectionId === MAIN_WATCHLIST_ID) return;
    if (displayedCollections.some((collection) => collection.id === data.collectionId)) return;
    const kit = displayedCollections.find((collection) => collection.slug === 'kits-collection');
    if (kit) selectCollection(kit.id, { userInitiated: false });
  }, [viewAsMember, adminClubs, collections, data?.collectionId]);

  useEffect(() => {
    if (authLoading || !collections.length || landingApplied || userSelectedCollection.current) return;
    const landingCollection = account?.profile?.approved_at && !account.profile.deactivated_at
      ? collections.find((collection) => collection.owner_id === account.profile.id)
      : collections.find((collection) => collection.slug === 'kits-collection');
    if (!landingCollection) return;
    setLandingApplied(true);
    selectCollection(landingCollection.id, { userInitiated: false });
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
  const isAdminAccount = account?.profile?.role === 'admin';
  const isAdmin = isAdminAccount && !viewAsMember;
  const saveStarRating = async (databaseId, starRating) => {
    const previousData = data;
    const applyRating = (currentData, changes) => ({
      ...currentData,
      media: currentData.media.map((item) => item.database_id === databaseId ? { ...item, ...changes } : item),
    });
    const optimisticData = applyRating(data, { star_rating: starRating, updated_at: new Date().toISOString() });
    setData(optimisticData);
    cacheSnapshot(optimisticData, data.collectionId);
    try {
      const updated = await setMediaStarRating(account.session.access_token, databaseId, starRating);
      const confirmedData = applyRating(optimisticData, { star_rating: updated.star_rating, updated_at: updated.updated_at });
      setData((currentData) => currentData?.collectionId === data.collectionId ? confirmedData : currentData);
      cacheSnapshot(confirmedData, data.collectionId);
      snapshotCache.current.delete(MAIN_WATCHLIST_ID);
      setToast(starRating ? `${starRating} star${starRating === 1 ? '' : 's'} saved.` : 'Star rating cleared.');
    } catch (error) {
      setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData);
      cacheSnapshot(previousData, previousData.collectionId);
      setToast('Star rating could not be saved.');
      throw error;
    }
  };
  const generatedAt = data.generatedAt ? new Date(data.generatedAt) : null;
  const dropCollection = async (targetCollectionId) => {
    if (!isAdmin || !draggedCollectionId || draggedCollectionId === targetCollectionId) return;
    const previous = [...collections];
    const ordered = [...collections];
    const from = ordered.findIndex((collection) => collection.id === draggedCollectionId);
    const to = ordered.findIndex((collection) => collection.id === targetCollectionId);
    if (from < 0 || to < 0) return;
    ordered.splice(to, 0, ordered.splice(from, 1)[0]);
    setCollections(ordered);
    setDraggedCollectionId(null);
    try {
      await reorderCollections(account.session.access_token, ordered.map((collection) => collection.id));
      setToast('Collection order saved.');
    } catch {
      setCollections(previous);
      setToast('Collection order could not be saved.');
    }
  };

  return (
    <div className={cls('app-shell media-only-shell public-media-shell', navCollapsed && 'nav-collapsed')}>
      <div className="paper-texture" />
      <aside className={cls('sidebar', mobileNav && 'open')}>
        <button className="brand" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
          <span className="brand-mark">KM</span>
          <span><strong>Kit’s Media<br />Room</strong></span>
        </button>
        <nav>
          {data?.storage === 'supabase' && <button className={data.mainWatchlist ? 'active' : ''} onClick={() => selectCollection(MAIN_WATCHLIST_ID)}>
            <ListOrdered size={17} />Main Watchlist
          </button>}
          <small className="collection-nav-label">COLLECTIONS</small>
          {data?.storage === 'supabase' && displayedCollections.map((collection) => <button key={collection.id} draggable={isAdmin} className={collection.id === (collectionId || data?.collectionId) ? 'active' : ''} onClick={() => selectCollection(collection.id)} onDragStart={(event) => { if (!isAdmin) return; event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', collection.id); setDraggedCollectionId(collection.id); }} onDragEnd={() => setDraggedCollectionId(null)} onDragOver={(event) => { if (isAdmin && draggedCollectionId) event.preventDefault(); }} onDrop={(event) => { event.preventDefault(); dropCollection(collection.id); }}>
            <UserRound size={17} />{collection.title}
          </button>)}
        </nav>
        <div className="sidebar-bottom">
          <div className="drive-state">
            <span>
              <strong>Public collection</strong>
              <small>{generatedAt ? `Published ${generatedAt.toLocaleDateString('en-AU')}` : 'Static snapshot'}</small>
            </span>
          </div>
        </div>
      </aside>

      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Close menu" />}

      <div className="workspace">
        <header className="topbar">
          <button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button>
          <button className="nav-toggle" onClick={() => setNavCollapsed((current) => !current)} aria-label={navCollapsed ? 'Open navigation' : 'Close navigation'} title={navCollapsed ? 'Open navigation' : 'Close navigation'}>{navCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
          <button className="search-trigger" onClick={() => setSearchOpen(true)}>
            <Search size={17} /><span>Search the collection…</span><kbd>Ctrl K</kbd>
          </button>
          <div className="top-actions">
            <span className="today"><CalendarDays size={14} />{new Intl.DateTimeFormat('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span>
            {authLoading ? <span className="account-state">Checking account…</span> : (
              <Button className="account-button" icon={account ? UserRound : LogIn} onClick={() => setAccountOpen(true)}>
                {account ? `${account.profile?.display_name || account.profile?.username}${viewAsMember ? ' · Member view' : ''}` : 'Sign in'}
              </Button>
            )}
          </div>
        </header>

        {error && <div className="error-banner">The public collection could not refresh: {error}</div>}

        <main className={cls(collectionLoading && 'collection-loading')} aria-busy={collectionLoading}>
          <MediaView key={data.collectionId} data={data} notify={setToast} openMedia={setSelectedMediaId} canEdit={canEditCollection} isAdmin={isAdmin} accessToken={account?.session?.access_token} currentUserId={account?.profile?.id} refresh={refresh} requestConfirmation={setConfirmation} onExport={() => exportCollection(data)} onStarRatingChange={saveStarRating} onDescriptionChange={async (section, description) => {
            const previousData = data;
            const optimisticData = {
              ...data,
              collectionDescription: section === 'screen' ? description : data.collectionDescription,
              collectionDescriptions: { ...data.collectionDescriptions, [section]: description },
            };
            setData(optimisticData);
            cacheSnapshot(optimisticData, data.collectionId);
            try {
              await updateCollection(account.session.access_token, data.collectionId, { [SECTION_NOTE_COLUMNS[section]]: description });
              if (section === 'screen') snapshotCache.current.delete(MAIN_WATCHLIST_ID);
              setToast('Collection introduction saved.');
            } catch (error) {
              setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData);
              cacheSnapshot(previousData, previousData.collectionId);
              setToast('Collection introduction could not be saved.');
              throw error;
            }
          }} />
        </main>
        <footer><span>Published from Kit’s Local Media Room.</span><span className="provider-credits">Poster data from <a href="https://www.themoviedb.org/" target="_blank" rel="noreferrer">TMDB</a>, <a href="https://books.google.com/" target="_blank" rel="noreferrer">Google Books</a>, <a href="https://openlibrary.org/" target="_blank" rel="noreferrer">Open Library</a> and <a href="https://www.steamgriddb.com/" target="_blank" rel="noreferrer">SteamGridDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</span></footer>
      </div>

      {selectedMedia && (
        <MediaDrawer
          item={selectedMedia}
          shelves={data.mainWatchlist ? data.mediaShelves : mediaShelvesForSection(data, mediaSection(selectedMedia))}
          onClose={() => setSelectedMediaId(null)}
          canEdit={canEditCollection}
          onStarRatingChange={(starRating) => saveStarRating(selectedMedia.database_id, starRating)}
          canReviewPoster={Boolean((canEditCollection || isAdmin) && !data.mainWatchlist)}
          onFindPosters={() => searchPosterCandidates(account.session.access_token, selectedMedia.database_id)}
          onChoosePoster={async (posterUrl) => {
            const previousData = data;
            const optimisticData = {
              ...data,
              media: data.media.map((item) => item.database_id === selectedMedia.database_id
                ? { ...item, poster_url: posterUrl, updated_at: new Date().toISOString() }
                : item),
            };
            setData(optimisticData);
            cacheSnapshot(optimisticData, data.collectionId);
            snapshotCache.current.delete(MAIN_WATCHLIST_ID);
            try {
              await choosePosterCandidate(account.session.access_token, selectedMedia.database_id, posterUrl);
              await refresh({ fresh: true });
              setToast('Poster saved.');
            } catch (error) {
              setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData);
              cacheSnapshot(previousData, previousData.collectionId);
              setToast('That poster could not be saved. Previous artwork restored.');
              throw error;
            }
          }}
          onFindDetails={() => searchDetailCandidates(account.session.access_token, selectedMedia.database_id)}
          onChooseDetails={async (candidate) => { const result = await chooseDetailCandidate(account.session.access_token, selectedMedia.database_id, candidate); await refresh({ fresh: true }); setToast(`${Object.keys(result?.applied || {}).length} new details saved.`); }}
          onUpdate={async (changes, messages = {}) => {
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
              setToast(messages.success || 'Media details saved.');
            } catch (error) {
              setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData);
              cacheSnapshot(previousData, previousData.collectionId);
              setToast(messages.failure || 'Media details could not be saved.');
              throw error;
            }
          }}
          onUpdateShelves={async (currentShelfIds, selectedShelfIds) => {
            const previousData = data;
            const optimisticData = applyShelfMemberships(data, selectedMedia.database_id, selectedShelfIds);
            setData(optimisticData);
            cacheSnapshot(optimisticData, data.collectionId);
            snapshotCache.current.delete(MAIN_WATCHLIST_ID);
            try {
              await replaceMediaShelfMemberships(account.session.access_token, selectedMedia.database_id, currentShelfIds, selectedShelfIds);
              setToast('Shelf membership saved.');
              await refresh({ fresh: true });
            } catch (error) {
              setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData);
              cacheSnapshot(previousData, previousData.collectionId);
              setToast('Shelf membership could not be saved. Previous shelves restored.');
              throw error;
            }
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
          onDelete={() => setConfirmation({ title: 'Move item to Bin?', message: `${cleanImportedMediaTitle(selectedMedia.title)} can be restored later from the Bin.`, confirmLabel: 'Move to Bin', tone: 'danger', optimistic: true, onConfirm: async () => { const previousData = data; const deletedAt = new Date().toISOString(); const optimisticData = { ...data, media: data.media.map((item) => item.database_id === selectedMedia.database_id ? { ...item, deleted_at: deletedAt } : item) }; setData(optimisticData); cacheSnapshot(optimisticData, data.collectionId); setSelectedMediaId(null); try { await setMediaDeleted(account.session.access_token, selectedMedia.database_id, true); snapshotCache.current.delete(MAIN_WATCHLIST_ID); setToast('Media moved to Bin.'); } catch (error) { setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData); cacheSnapshot(previousData, previousData.collectionId); setToast('The item could not be moved to Bin.'); throw error; } } })}
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
            snapshotCache.current.clear();
            setAccount(nextAccount);
            setViewAsMember(false);
            setAccountOpen(false);
            setLandingApplied(false);
            userSelectedCollection.current = false;
            setToast('Signed in securely.');
          }}
          onSignedOut={() => {
            snapshotCache.current.clear();
            setAccount(null);
            setViewAsMember(false);
            setAccountOpen(false);
            setLandingApplied(false);
            userSelectedCollection.current = false;
            setToast('Signed out.');
          }}
          onManageUsers={() => { setAccountOpen(false); setAdminOpen(true); }}
          viewAsMember={viewAsMember}
          onViewAsMemberChange={setViewAsMember}
          onAccountUpdated={async (profile) => { setAccount((current) => ({ ...current, profile })); const nextCollections = await loadPublicCollections({ fresh: true, accessToken }); setCollections(nextCollections); snapshotCache.current.clear(); await refresh({ fresh: true, targetCollectionId: data.collectionId }); setToast('Account settings saved.'); }}
        />
      )}

      {adminOpen && <AdminUsers accessToken={accessToken} clubs={adminClubs} onClubsChange={setAdminClubs} mainWatchlistClubId={adminMainClubId} onMainWatchlistClubChange={(clubId) => {
        if (clubId) window.localStorage.setItem(ADMIN_MAIN_CLUB_KEY, clubId);
        else window.localStorage.removeItem(ADMIN_MAIN_CLUB_KEY);
        snapshotCache.current.delete(MAIN_WATCHLIST_ID);
        setAdminMainClubId(clubId);
      }} requestConfirmation={setConfirmation} onClose={() => setAdminOpen(false)} onUsersChanged={async () => {
        const nextCollections = await loadPublicCollections({ fresh: true, accessToken });
        setCollections(nextCollections);
        snapshotCache.current.clear();
        if (data.collectionId === MAIN_WATCHLIST_ID) {
          await refresh({ fresh: true, targetCollectionId: MAIN_WATCHLIST_ID });
        } else if (!nextCollections.some((collection) => collection.id === data.collectionId)) {
          const kit = nextCollections.find((collection) => collection.slug === 'kits-collection');
          if (kit) selectCollection(kit.id, { userInitiated: false });
        }
      }} />}
      {confirmation && <ConfirmDialog {...confirmation} onClose={() => setConfirmation(null)} />}
      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  );
}

function NoteDrawer({ title, value, onClose }) {
  useEscape(onClose);
  return createPortal(<div className="drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><aside className="collection-note-drawer"><button className="close" onClick={onClose} aria-label="Close note"><X /></button><span className="eyebrow">COLLECTION NOTE</span><h2>{title}</h2><div className="collection-note-full">{value}</div></aside></div>, document.body);
}

function StarRating({ value, editable = false, onChange, label = 'Star rating' }) {
  const rating = normalizeStarRating(value);
  const [preview, setPreview] = useState(null);
  const [saving, setSaving] = useState(false);
  const visibleRating = preview ?? rating ?? 0;
  useEffect(() => { setPreview(null); }, [value]);

  if (!editable) {
    return <span className="star-rating is-read-only" role="img" aria-label={`${label}: ${rating ? `${rating} out of 5` : 'not rated'}`}>
      {STAR_RATING_STEPS.map((step) => <span className={cls('star-half', step <= visibleRating && 'is-filled')} data-side={Number.isInteger(step) ? 'right' : 'left'} key={step} />)}
    </span>;
  }

  return <span className={cls('star-rating is-editable', saving && 'is-saving')} role="group" aria-label={label} onMouseLeave={() => setPreview(null)} onClick={(event) => event.stopPropagation()}>
    {STAR_RATING_STEPS.map((step) => <button
      type="button"
      className={cls('star-half', step <= visibleRating && 'is-filled')}
      data-side={Number.isInteger(step) ? 'right' : 'left'}
      aria-label={`${step} out of 5 stars`}
      aria-pressed={rating === step}
      title={`${step} out of 5`}
      disabled={saving}
      draggable="false"
      key={step}
      onMouseEnter={() => setPreview(step)}
      onFocus={() => setPreview(step)}
      onBlur={() => setPreview(null)}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={async (event) => {
        event.stopPropagation();
        const next = rating === step ? null : step;
        setPreview(next);
        setSaving(true);
        try { await onChange(next); } catch { setPreview(null); } finally { setSaving(false); }
      }}
    />)}
  </span>;
}

function EditableDescription({ value, canEdit, onSave, fallback = '', title = 'Collection note' }) {
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

function MediaView({ data, notify, openMedia, canEdit, isAdmin, accessToken, currentUserId, refresh, requestConfirmation, onExport, onStarRatingChange, onDescriptionChange }) {
  const [section, setSection] = useState('screen');
  const [query, setQuery] = useState('');
  const [listFilters, setListFilters] = useState([]);
  const [formatFilters, setFormatFilters] = useState([]);
  const [genreFilters, setGenreFilters] = useState([]);
  const [typeFilters, setTypeFilters] = useState([]);
  const [ratingFilters, setRatingFilters] = useState([]);
  const [ownershipFilters, setOwnershipFilters] = useState([]);
  const [stampFilters, setStampFilters] = useState([]);
  const [creatingShelf, setCreatingShelf] = useState(false);
  const [addingMedia, setAddingMedia] = useState(false);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);
  const [enrichingPosters, setEnrichingPosters] = useState(false);
  const [enrichingDetails, setEnrichingDetails] = useState(false);
  const [posterRetryAfter, setPosterRetryAfter] = useState(0);
  const [detailsRetryAfter, setDetailsRetryAfter] = useState(0);
  const [importingBackup, setImportingBackup] = useState(false);
  const [binOpen, setBinOpen] = useState(false);
  const [shelfEditor, setShelfEditor] = useState(null);
  const [addToShelfIds, setAddToShelfIds] = useState([]);
  const [draggedShelfId, setDraggedShelfId] = useState(null);
  const [optimisticShelfIds, setOptimisticShelfIds] = useState([]);
  const [optimisticShelfDetails, setOptimisticShelfDetails] = useState({});
  const [optimisticDeletedShelfIds, setOptimisticDeletedShelfIds] = useState([]);
  const [optimisticMediaItems, setOptimisticMediaItems] = useState([]);
  const [optimisticMainShelfIds, setOptimisticMainShelfIds] = useState([]);
  const backupInputRef = useRef(null);

  useEffect(() => {
    if (!posterRetryAfter && !detailsRetryAfter) return undefined;
    const timer = window.setInterval(() => {
      setPosterRetryAfter((seconds) => Math.max(0, seconds - 1));
      setDetailsRetryAfter((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [posterRetryAfter > 0, detailsRetryAfter > 0]);

  const sourceShelves = mediaShelvesForSection(data, section).filter((shelf) => !optimisticDeletedShelfIds.includes(shelf.shelf_id));
  useEffect(() => { setOptimisticShelfIds(sourceShelves.map((shelf) => shelf.shelf_id)); }, [data.collectionId, data.mediaShelves, section]);
  useEffect(() => { setOptimisticShelfDetails({}); }, [data.collectionId, data.mediaShelves, section]);
  useEffect(() => { setOptimisticMainShelfIds(data.mediaShelves.filter((shelf) => shelf.section === 'screen' && shelf.showInMainWatchlist).map((shelf) => shelf.shelf_id)); }, [data.collectionId, data.mediaShelves]);
  const shelfIndex = new Map(optimisticShelfIds.map((id, index) => [id, index]));
  const shelves = sourceShelves.map((shelf) => ({ ...shelf, ...(optimisticShelfDetails[shelf.shelf_id] || {}) })).sort((a, b) => (shelfIndex.get(a.shelf_id) ?? Number.MAX_SAFE_INTEGER) - (shelfIndex.get(b.shelf_id) ?? Number.MAX_SAFE_INTEGER));
  const items = [...active(data.media), ...optimisticMediaItems].filter((item) => data.mainWatchlist || mediaSection(item) === section);
  const deletedMedia = (data.media || []).filter((item) => item.deleted_at);
  const deletedShelves = (data.mediaShelves || []).filter((shelf) => shelf.deleted_at);
  const binCount = deletedMedia.length + deletedShelves.length;
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
    const searchable = mediaSearchText(item);
    return (!queryLower || searchable.includes(queryLower))
      && matchesAny(typeFilters, [item.type])
      && matchesStarRatings(item.star_rating, ratingFilters)
      && matchesOwnership(item.owned, ownershipFilters)
      && matchesAny(formatFilters, mediaDisplayTags(item))
      && matchesAny(genreFilters, item.genres || [])
      && (!data.mainWatchlist || !stampFilters.length || stampFilters.some((count) => (
        count === '1'
          ? (item.interests?.length || 0) === 1
          : count === String(Math.min(item.demandCount || 0, 4))
      )));
  });
  const randomPool = contentFiltered.filter((item) => matchesAny(listFilters, item.lists || []));
  const searchResults = queryLower
    ? [...new Map(randomPool.map((item) => [item.database_id || item.item_id, item])).values()]
    : [];
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
  const reorderableShelves = shelves.filter((shelf) => !shelf.virtual);
  const canCurateMain = Boolean(!data.mainWatchlist && section === 'screen' && (canEdit || isAdmin));
  const sectionDescription = data.collectionDescriptions?.[section]
    ?? (section === 'screen' ? data.collectionDescription : '');
  const collectionStats = collectionSummaryStats(items, shelves, section);
  const queueLabel = section === 'book' ? 'to read' : section === 'game' ? 'to play' : 'to watch';

  const switchSection = (next) => {
    setSection(next);
    setQuery('');
    setListFilters([]);
    setFormatFilters([]);
    setGenreFilters([]);
    setTypeFilters([]);
    setRatingFilters([]);
    setOwnershipFilters([]);
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
    setRatingFilters([]);
    setOwnershipFilters([]);
    setStampFilters([]);
  };

  const saveShelfOrder = async (ordered, previous) => {
    setOptimisticShelfIds(ordered);
    try {
      if (data.mainWatchlist) await reorderMainWatchlist(accessToken, ordered.filter((shelfId) => shelfId !== 'main-priority-watchlist'));
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

  const enrichCurrentSection = async () => {
    setEnrichingPosters(true);
    try {
      const result = await enrichSectionPosters(accessToken, data.collectionId, section);
      await refresh({ fresh: true });
      notify(`${result?.enriched || 0} posters added${result?.unmatched ? `; ${result.unmatched} left for review` : ''}${result?.warnings?.length ? ` (${result.warnings.join(', ')})` : ''}.`);
    } catch (error) {
      if (error?.retryAfter) setPosterRetryAfter(error.retryAfter);
      notify(error?.message || 'Poster enrichment could not run. Check the provider secrets and Edge Function deployment.');
    } finally {
      setEnrichingPosters(false);
    }
  };

  const enrichDetailsInCurrentSection = async () => {
    setEnrichingDetails(true);
    try {
      const result = await enrichSectionDetails(accessToken, data.collectionId, section);
      await refresh({ fresh: true });
      notify(`${result?.enriched || 0} items enriched${result?.reviewed ? ` from ${result.reviewed} reviewed` : ''}${result?.warnings?.length ? ` (${result.warnings.join(', ')})` : ''}.`);
    } catch (error) {
      if (error?.retryAfter) setDetailsRetryAfter(error.retryAfter);
      notify(error?.message || 'Detail enrichment could not run. Check the provider secrets and Edge Function deployment.');
    } finally {
      setEnrichingDetails(false);
    }
  };

  const importBackupFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > BACKUP_IMPORT_LIMITS.bytes) {
      notify('That backup is larger than the 25 MB import limit.');
      return;
    }

    try {
      const { backup, shelfCount, mediaCount } = parseCollectionBackup(await file.text());
      if (!window.confirm(`Import ${mediaCount} media items and ${shelfCount} shelves into ${data.collectionTitle}? Matching records will be updated. Current records not included in the backup will remain untouched.`)) return;
      setImportingBackup(true);
      const result = await importCollectionBackup(accessToken, data.collectionId, backup);
      if (result?.ok === false) throw new Error(result.error || 'The backup could not be imported.');
      await refresh({ fresh: true });
      notify(`Backup imported: ${result?.media ?? mediaCount} media items and ${result?.shelves ?? shelfCount} shelves merged.`);
    } catch (error) {
      notify(error?.message ? `Backup import failed: ${error.message}` : 'Backup import failed for an unknown reason.');
    } finally {
      setImportingBackup(false);
    }
  };

  return (
    <div className="page media-page">
      <PageHero
        title={data.collectionTitle || 'The media room'}
        description={data.mainWatchlist
          ? 'Every selected shelf, mirrored live from its owner’s collection.'
          : <EditableDescription value={sectionDescription} fallback={SECTION_NOTE_DEFAULTS[section]} canEdit={canEdit} onSave={(description) => onDescriptionChange(section, description)} title={`${data.collectionTitle || 'Collection'} ${sectionLabel} note`} />}
        icon={Clapperboard}
        stats={[
          [data.mainWatchlist ? items.length : collectionStats.queued, queueLabel],
          [data.mainWatchlist ? shelves.filter((shelf) => !shelf.virtual).length : collectionStats.owned, data.mainWatchlist ? 'mirrored shelves' : 'owned'],
        ]}
      />

      <div className="media-command public-media-command">
        {!data.mainWatchlist && <div className="media-tabs">
          <button className={section === 'screen' ? 'active' : ''} onClick={() => switchSection('screen')}><Film />Film & TV</button>
          <button className={section === 'book' ? 'active' : ''} onClick={() => switchSection('book')}><BookOpen />Books</button>
          <button className={section === 'game' ? 'active' : ''} onClick={() => switchSection('game')}><Gamepad2 />Video Games</button>
        </div>}

        <div className={cls('media-filters', section === 'screen' && 'has-type')}>
          <label className="media-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${sectionLabel.toLowerCase()}…`} /></label>
          <MultiSelect label="All lists" values={listFilters} options={shelves.map((shelf) => [shelf.shelf_id, data.mainWatchlist ? <span className="owned-list-option"><small>{shelf.ownerName}</small><b>{shelf.name}</b></span> : shelf.name])} onChange={setListFilters} />
          {section === 'screen' && !data.mainWatchlist && <MultiSelect label="Film & TV" values={typeFilters} options={sectionTypes} onChange={setTypeFilters} />}
          {data.mainWatchlist && <MultiSelect label="Interest" values={stampFilters} options={['1', '2', '3', '4'].map((count) => [count, count === '1' ? '1 Stamp' : count === '4' ? '4+ People' : `${count} People`])} onChange={setStampFilters} />}
          <MultiSelect label="Rating" values={ratingFilters} options={STAR_RATING_STEPS.map((rating) => [String(rating), `${rating} ${rating === 1 ? 'star' : 'stars'}`])} onChange={setRatingFilters} />
          <MultiSelect label="Ownership" values={ownershipFilters} options={OWNERSHIP_FILTER_OPTIONS} onChange={setOwnershipFilters} />
          <MultiSelect label={section === 'game' ? 'All platforms' : 'All formats'} values={formatFilters} options={formats.map((value) => [value, value])} onChange={setFormatFilters} />
          <MultiSelect label="All genres" values={genreFilters} options={genres.map((value) => [value, value])} onChange={setGenreFilters} />
        </div>

        <div className="media-action-row public-actions">
          <Button className="random-pick" icon={Shuffle} onClick={pickRandom}>{data.mainWatchlist ? 'Pick an item' : `Pick a ${singularLabel}`}</Button>
          {(listFilters.length || ratingFilters.length || ownershipFilters.length || formatFilters.length || genreFilters.length || typeFilters.length || stampFilters.length || query) && (
            <button className="clear-media-filters" type="button" onClick={clearFilters}><SlidersHorizontal size={14} />Clear filters</button>
          )}
        </div>
      </div>

      {queryLower && <SearchResultsSection items={searchResults} onOpen={openMedia} canRate={canEdit} onRate={onStarRatingChange} />}

      <div className={cls('dynamic-shelves', queryLower && 'has-search-results')}>
        {visibleShelves.map((shelf) => {
          const shelfItems = sortShelfItems(
            contentFiltered.filter((item) => item.lists?.includes(shelf.shelf_id)),
            shelf.shelf_id,
            data.media,
          );
          if (!shelfItems.length && queryLower) return null;
          const showOwnerIntro = data.mainWatchlist && ownerIntroShelfIds.has(shelf.shelf_id);
          return <React.Fragment key={shelf.shelf_id}>{showOwnerIntro && <section className="main-owner-intro"><h2>{shelf.ownerName}</h2><EditableDescription value={shelf.ownerNote} fallback={SECTION_NOTE_DEFAULTS.screen} canEdit={false} title={`${shelf.ownerName}’s note`} /></section>}<MediaShelf shelf={{ ...shelf, ownerName: data.mainWatchlist ? null : shelf.ownerName, showInMainWatchlist: optimisticMainShelfIds.includes(shelf.shelf_id) }} items={shelfItems} onOpen={openMedia} canEdit={canEdit && !shelf.virtual} canRate={canEdit} onRate={onStarRatingChange} canReorderShelf={canReorderShelves && !shelf.virtual} canCurateMain={canCurateMain} canRemoveMirror={Boolean(data.mainWatchlist && isAdmin && !shelf.virtual)} onRemoveMirror={() => requestConfirmation({ title: 'Remove shelf from Main Watchlist?', message: `${shelf.name} will remain untouched in its owner’s collection.`, confirmLabel: 'Remove from Main', onConfirm: async () => { await updateShelf(accessToken, shelf.shelf_id, { show_in_main_watchlist: false }); await refresh({ fresh: true }); notify(`${shelf.name} removed from Main Watchlist.`); } })} onToggleMain={() => toggleMainWatchlistShelf({ ...shelf, showInMainWatchlist: optimisticMainShelfIds.includes(shelf.shelf_id) })} canMoveUp={!shelf.virtual && reorderableShelves.findIndex((row) => row.shelf_id === shelf.shelf_id) > 0} canMoveDown={!shelf.virtual && reorderableShelves.findIndex((row) => row.shelf_id === shelf.shelf_id) < reorderableShelves.length - 1} onMoveShelf={async (direction) => { const previous = shelves.map((row) => row.shelf_id); const ordered = [...previous]; const from = ordered.indexOf(shelf.shelf_id); const to = from + direction; if (to < 0 || to >= ordered.length) return; [ordered[from], ordered[to]] = [ordered[to], ordered[from]]; await saveShelfOrder(ordered, previous); }} onAdd={() => { setAddToShelfIds([shelf.shelf_id]); setAddingMedia(true); }} shelfDragging={draggedShelfId === shelf.shelf_id} onShelfDragStart={(event) => { event.dataTransfer.setData('text/plain', shelf.shelf_id); event.dataTransfer.effectAllowed = 'move'; setDraggedShelfId(shelf.shelf_id); }} onShelfDragEnd={() => setDraggedShelfId(null)} onShelfDrop={async () => { if (!draggedShelfId || draggedShelfId === shelf.shelf_id) return; const previous = shelves.map((row) => row.shelf_id); const ordered = [...previous]; const from = ordered.indexOf(draggedShelfId); const to = ordered.indexOf(shelf.shelf_id); ordered.splice(to, 0, ordered.splice(from, 1)[0]); setDraggedShelfId(null); try { await saveShelfOrder(ordered, previous); } catch {} }} onReorder={async (ordered) => { try { await reorderShelfMedia(accessToken, shelf.shelf_id, ordered); await refresh({ fresh: true }); notify('Item order saved.'); } catch (error) { notify('Item order could not be saved.'); throw error; } }} onRename={() => setShelfEditor(shelf)} onDelete={() => requestConfirmation({ title: `Move ${shelf.name} to Bin?`, message: 'The shelf can be restored later and its media items will remain in the collection.', confirmLabel: 'Move to Bin', tone: 'danger', optimistic: true, onConfirm: async () => { setOptimisticDeletedShelfIds((ids) => [...ids, shelf.shelf_id]); try { await updateShelf(accessToken, shelf.shelf_id, { deleted_at: new Date().toISOString() }); await refresh({ fresh: true }); notify(`${shelf.name} moved to Bin.`); } catch (error) { setOptimisticDeletedShelfIds((ids) => ids.filter((id) => id !== shelf.shelf_id)); notify('The shelf could not be moved to Bin.'); throw error; } } })} /></React.Fragment>;
        })}
      </div>

      {!randomPool.length && <Empty>No media matches those filters.</Empty>}
      {!data.mainWatchlist && (canEdit || isAdmin) && <section className="collection-tools">
        <div><span className="eyebrow">COLLECTION TOOLS</span><p>{canEdit ? 'Manage this section without cluttering the shelves.' : 'Administrative backup and artwork tools.'}</p></div>
        {canEdit && <Button className="quiet-button create-shelf-button" icon={Plus} onClick={() => setCreatingShelf(true)}>Create Shelf</Button>}
        <div className="collection-tool-actions">
          <Button className="quiet-button" icon={RotateCw} disabled={enrichingPosters || posterRetryAfter > 0} onClick={enrichCurrentSection}>{enrichingPosters ? 'Finding posters…' : posterRetryAfter ? `Find posters in ${retryLabel(posterRetryAfter)}` : 'Find posters'}</Button>
          <Button className="quiet-button" icon={Search} disabled={enrichingDetails || detailsRetryAfter > 0} onClick={enrichDetailsInCurrentSection}>{enrichingDetails ? 'Enriching details…' : detailsRetryAfter ? `Enrich details in ${retryLabel(detailsRetryAfter)}` : 'Enrich details'}</Button>
          <Button className="quiet-button" icon={Download} onClick={onExport}>Export backup</Button>
          {canEdit && <><input ref={backupInputRef} hidden type="file" accept=".json,application/json" onChange={importBackupFile} /><Button className="quiet-button" icon={Upload} disabled={importingBackup} onClick={() => backupInputRef.current?.click()}>{importingBackup ? 'Importing backup…' : 'Import backup'}</Button></>}
          {canEdit && <Button className="quiet-button bin-button" icon={Trash2} onClick={() => setBinOpen(true)}>Bin{binCount ? ` (${binCount})` : ''}</Button>}
          {canEdit && <Button className="quiet-button" icon={Plus} onClick={() => setBulkImportOpen(true)}>Bulk Import {section === 'screen' ? 'Film & TV' : section === 'book' ? 'Books' : 'Video Games'}</Button>}
        </div>
      </section>}
      {creatingShelf && <CreateShelfDialog section={section} onClose={() => setCreatingShelf(false)} onSave={async (values) => { setCreatingShelf(false); try { await createShelf(accessToken, { collection_id: data.collectionId, section, ...values, position: (shelves.at(-1)?.position || 0) + 1000 }); await refresh({ fresh: true }); notify('Shelf created.'); } catch { notify('That shelf could not be created. Names must be unique within this section.'); } }} />}
      {addingMedia && <AddMediaDialog section={section} shelves={shelves} initialShelfIds={addToShelfIds} onClose={() => { setAddingMedia(false); setAddToShelfIds([]); }} onSave={(item, shelfIds, priorityWatch) => { const temporaryId = `optimistic-${Date.now()}`; const temporaryItem = { ...item, item_id: temporaryId, database_id: temporaryId, lists: shelfIds, list_positions: Object.fromEntries(shelfIds.map((id, index) => [id, (index + 1) * 1000])), interests: [], optimistic: true, created_at: new Date().toISOString() }; setOptimisticMediaItems((rows) => [...rows, temporaryItem]); setAddingMedia(false); setAddToShelfIds([]); createMediaItem(accessToken, { ...item, collection_id: data.collectionId }).then(async (created) => { await replaceMediaShelfMemberships(accessToken, created[0].id, [], shelfIds); if (priorityWatch && currentUserId) await setInterest(accessToken, currentUserId, created[0].id, true); await refresh({ fresh: true }); setOptimisticMediaItems((rows) => rows.filter((row) => row.database_id !== temporaryId)); notify('Media added.'); }).catch(() => { setOptimisticMediaItems((rows) => rows.filter((row) => row.database_id !== temporaryId)); notify('The media item could not be saved.'); }); }} />}
      {binOpen && <CollectionBinDrawer media={deletedMedia} shelves={deletedShelves} onClose={() => setBinOpen(false)} onError={notify} onOpenMedia={(itemId) => { setBinOpen(false); openMedia(itemId); }} onRestoreMedia={async (item) => { await setMediaDeleted(accessToken, item.database_id, false); await refresh({ fresh: true }); notify(`${item.title} restored from Bin.`); }} onDeleteMedia={(item) => requestConfirmation({ title: `Permanently delete ${item.title}?`, message: 'This cannot be undone.', confirmLabel: 'Delete Permanently', tone: 'danger', optimistic: true, onConfirm: async () => { const previousData = data; const optimisticData = { ...data, media: data.media.filter((row) => row.database_id !== item.database_id) }; setData(optimisticData); cacheSnapshot(optimisticData, data.collectionId); try { await permanentlyDeleteMedia(accessToken, item.database_id); snapshotCache.current.delete(MAIN_WATCHLIST_ID); notify(`${item.title} permanently deleted.`); } catch (error) { setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData); cacheSnapshot(previousData, previousData.collectionId); notify(`${item.title} could not be deleted. It has been restored to the Bin.`); throw error; } } })} onRestoreShelf={async (shelf) => { await updateShelf(accessToken, shelf.shelf_id, { deleted_at: null }); await refresh({ fresh: true }); notify(`${shelf.name} restored from Bin.`); }} onDeleteShelf={(shelf) => requestConfirmation({ title: `Permanently delete ${shelf.name}?`, message: 'The shelf cannot be restored after this. Its media items will remain in the collection.', confirmLabel: 'Delete Permanently', tone: 'danger', optimistic: true, onConfirm: async () => { const previousData = data; const optimisticData = { ...data, mediaShelves: data.mediaShelves.filter((row) => row.shelf_id !== shelf.shelf_id) }; setData(optimisticData); cacheSnapshot(optimisticData, data.collectionId); try { await deleteShelf(accessToken, shelf.shelf_id); snapshotCache.current.delete(MAIN_WATCHLIST_ID); notify(`${shelf.name} permanently deleted.`); } catch (error) { setData((currentData) => currentData?.collectionId === previousData.collectionId ? previousData : currentData); cacheSnapshot(previousData, previousData.collectionId); notify(`${shelf.name} could not be deleted. It has been restored to the Bin.`); throw error; } } })} />}
      {shelfEditor && <ShelfEditDialog shelf={shelfEditor} onClose={() => setShelfEditor(null)} onSave={(changes) => { const shelfId = shelfEditor.shelf_id; setOptimisticShelfDetails((current) => ({ ...current, [shelfId]: { ...(current[shelfId] || {}), ...changes, queueList: changes.is_queue_list ?? shelfEditor.queueList } })); updateShelf(accessToken, shelfId, changes).then(async () => { await refresh({ fresh: true }); notify('Shelf saved.'); }).catch(() => { setOptimisticShelfDetails((current) => { const next = { ...current }; delete next[shelfId]; return next; }); notify('The shelf could not be saved. Previous details restored.'); }); }} />}
      {bulkImportOpen && <BulkImportDialog section={section} shelves={shelves} onClose={() => setBulkImportOpen(false)} onImport={async (shelfId, rows) => { const result = await bulkImportMedia(accessToken, data.collectionId, shelfId, section, rows); setBulkImportOpen(false); await refresh({ fresh: true }); notify(`${result?.imported || 0} imported${result?.skipped ? `; ${result.skipped} duplicates skipped` : ''}.`); }} />}
    </div>
  );
}

function SearchResultsSection({ items, onOpen, canRate, onRate }) {
  return <section className="media-search-results" aria-live="polite">
    <div className="search-results-heading">
      <span><span className="eyebrow">CURRENT SEARCH</span><h2>Search Results <b>{items.length}</b></h2></span>
    </div>
    {items.length > 0
      ? <div className="search-results-grid">{items.map((item) => <MediaCard key={item.database_id || item.item_id} item={item} onClick={() => !item.optimistic && onOpen(item.item_id)} canRate={canRate && !item.optimistic} onRate={(starRating) => onRate(item.database_id, starRating)} />)}</div>
      : <Empty>No media matches those filters.</Empty>}
  </section>;
}

function MediaShelf({ shelf, items, onOpen, canEdit, canRate, onRate, canReorderShelf, canCurateMain, canRemoveMirror, onRemoveMirror, onToggleMain, canMoveUp, canMoveDown, onMoveShelf, onAdd, shelfDragging, onShelfDragStart, onShelfDragEnd, onShelfDrop, onReorder, onRename, onDelete }) {
  const trackRef = useRef(null);
  const [draggedId, setDraggedId] = useState(null);
  const [displayItems, setDisplayItems] = useState(items);
  const [arranging, setArranging] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const serverOrderKey = items.map((item) => `${item.database_id}:${item.updated_at || ''}:${item.star_rating ?? ''}:${item.list_positions?.[shelf.shelf_id] ?? ''}:${(item.interests || []).map((person) => person.id || person.username).sort().join(',')}`).join('|');
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
          <span className="shelf-heading-copy">{shelf.ownerName && <small>{shelf.ownerName}</small>}<h2>{shelf.name}<span>{items.length}</span></h2>{shelf.subtitle && <p className="shelf-subtitle">{shelf.subtitle}</p>}</span>
        </div>
        <div className="shelf-actions">
          <span className="shelf-action-group shelf-content-actions">{canRemoveMirror && <button className="remove-main-mirror" onClick={onRemoveMirror} title="Remove this mirror; the original shelf stays unchanged"><X size={14} /><span>Remove from Main</span></button>}{canEdit && items.length > 1 && <button className="shelf-control-button arrange-button" aria-label={`Arrange items in ${shelf.name}`} title="Arrange Shelf" onClick={() => setArranging(true)}><ListOrdered size={15} /><span>Arrange Shelf</span></button>}{canCurateMain && <button className={cls('shelf-control-button main-watchlist-toggle', shelf.showInMainWatchlist && 'active')} aria-pressed={shelf.showInMainWatchlist} aria-label={`${shelf.showInMainWatchlist ? 'Remove' : 'Add'} ${shelf.name} ${shelf.showInMainWatchlist ? 'from' : 'to'} Main Watchlist`} title={shelf.showInMainWatchlist ? 'Click to remove from Main Watchlist' : 'Show in Main Watchlist'} onClick={onToggleMain}><span className="main-watchlist-copy"><small>{shelf.showInMainWatchlist ? 'Included in' : 'Include this shelf in'}</small><strong>Main Watchlist</strong></span></button>}{canEdit && <Button className="shelf-control-button shelf-add-button" icon={Plus} onClick={onAdd}>Add Item</Button>}</span>
          <span className="shelf-action-group shelf-order-actions">{canReorderShelf && <button aria-label={`Move ${shelf.name} up`} title="Move shelf up" disabled={!canMoveUp} onClick={() => onMoveShelf(-1)}><ArrowUp size={15} /></button>}{canReorderShelf && <button aria-label={`Move ${shelf.name} down`} title="Move shelf down" disabled={!canMoveDown} onClick={() => onMoveShelf(1)}><ArrowDown size={15} /></button>}</span>
          <span className="shelf-action-group shelf-edit-actions">{canEdit && <button aria-label={`Edit ${shelf.name}`} title="Edit shelf" onClick={onRename}><Pencil size={15} /></button>}{canEdit && !shelf.required && <button className="delete-shelf" aria-label={`Delete ${shelf.name}`} title="Move shelf to Bin" onClick={onDelete}><X size={15} /></button>}</span>
          <span className="shelf-action-group shelf-page-actions"><button aria-label={`Scroll ${shelf.name} left`} disabled={currentPage <= 0 || pageCount <= 1} onClick={() => scrollPage(-1)}><ChevronLeft /></button>{pageCount > 1 && <small>{currentPage + 1} / {pageCount}</small>}<button aria-label={`Scroll ${shelf.name} right`} disabled={currentPage >= pageCount - 1 || pageCount <= 1} onClick={() => scrollPage(1)}><ChevronRight /></button></span>
        </div>
      </div>
      <div className="poster-track" ref={trackRef} onScroll={(event) => { const page = event.currentTarget.querySelector('.poster-page'); const width = (page?.offsetWidth || event.currentTarget.clientWidth) + 24; if (width > 0) setCurrentPage(Math.max(0, Math.min(Math.round(event.currentTarget.scrollLeft / width), Math.max(pageCount - 1, 0)))); }}>
        {displayPages.map((pageRows, pageIndex) => <div className="poster-page" key={pageIndex}>
          {pageRows.flat().map((item) => <MediaCard key={item.item_id} item={item} onClick={() => !item.optimistic && onOpen(item.item_id)} canRate={canRate && !item.optimistic} onRate={(starRating) => onRate(item.database_id, starRating)} draggable={canEdit && !item.optimistic} dragging={draggedId === item.database_id} onDragStart={(event) => { event.dataTransfer.setData('text/plain', item.database_id); event.dataTransfer.effectAllowed = 'move'; setDraggedId(item.database_id); }} onDragEnd={() => setDraggedId(null)} onDrop={async () => { if (!draggedId || draggedId === item.database_id) return; const previous = [...displayItems]; const next = [...displayItems]; const from = next.findIndex((entry) => entry.database_id === draggedId); const to = next.findIndex((entry) => entry.database_id === item.database_id); next.splice(to, 0, next.splice(from, 1)[0]); setDisplayItems(next); setDraggedId(null); try { await onReorder(next.map((entry) => entry.database_id)); } catch { setDisplayItems(previous); } }} />)}
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

function CollectionBinDrawer({ media, shelves, onClose, onError, onOpenMedia, onRestoreMedia, onDeleteMedia, onRestoreShelf, onDeleteShelf }) {
  const [busyId, setBusyId] = useState(null);
  useEscape(onClose);
  const run = async (id, action) => {
    setBusyId(id);
    try { await action(); } catch (error) { onError(error?.message ? `Bin update failed: ${error.message}` : 'That Bin item could not be updated.'); } finally { setBusyId(null); }
  };
  const sectionName = (section) => section === 'screen' ? 'Film & TV' : section === 'book' ? 'Books' : 'Video Games';

  return createPortal(<div className="drawer-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <aside className="collection-bin-drawer">
      <button className="close" onClick={onClose} aria-label="Close Bin"><X /></button>
      <span className="eyebrow">COLLECTION BIN</span>
      <h2>Recently removed</h2>
      <p className="bin-intro">Restore anything you want to keep, or permanently delete it here when you are certain.</p>
      {!media.length && !shelves.length && <div className="bin-empty"><Trash2 size={20} /><span>The Bin is empty.</span></div>}
      {media.length > 0 && <section className="bin-group"><header><span>MEDIA</span><small>{media.length}</small></header><div className="bin-list">
        {media.map((item) => <article className="bin-row-card" key={item.database_id}>
          <button className="bin-item-main" onClick={() => onOpenMedia(item.item_id)}>{item.poster_url ? <img src={item.poster_url} alt="" /> : <span className="bin-poster-fallback"><Clapperboard size={14} /></span>}<span><strong>{cleanImportedMediaTitle(item.title)}</strong><small>{sectionName(mediaSection(item))}{item.year ? ` · ${item.year}` : ''}</small></span></button>
          <div className="bin-row-actions"><button disabled={busyId === item.database_id} onClick={() => run(item.database_id, () => onRestoreMedia(item))}><RotateCw size={13} />Restore</button><button className="permanent" disabled={busyId === item.database_id} onClick={() => run(item.database_id, () => onDeleteMedia(item))}><Trash2 size={13} />Delete forever</button></div>
        </article>)}
      </div></section>}
      {shelves.length > 0 && <section className="bin-group"><header><span>SHELVES</span><small>{shelves.length}</small></header><div className="bin-list">
        {shelves.map((shelf) => <article className="bin-row-card shelf" key={shelf.shelf_id}><div className="bin-item-main"><span className="bin-shelf-mark"><ListOrdered size={15} /></span><span><strong>{shelf.name}</strong><small>{sectionName(shelf.section)}</small></span></div><div className="bin-row-actions"><button disabled={busyId === shelf.shelf_id} onClick={() => run(shelf.shelf_id, () => onRestoreShelf(shelf))}><RotateCw size={13} />Restore</button><button className="permanent" disabled={busyId === shelf.shelf_id} onClick={() => run(shelf.shelf_id, () => onDeleteShelf(shelf))}><Trash2 size={13} />Delete forever</button></div></article>)}
      </div></section>}
    </aside>
  </div>, document.body);
}

function MediaCard({ item, onClick, canRate, onRate, draggable, dragging, onDragStart, onDragEnd, onDrop }) {
  const tags = mediaCardDisplayTags(item);
  const title = cleanImportedMediaTitle(item.title);
  return (
    <article className={cls('media-card', dragging && 'is-dragging', item.optimistic && 'is-optimistic')} onClick={onClick} draggable={draggable} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={(event) => draggable && event.preventDefault()} onDrop={(event) => { event.preventDefault(); onDrop?.(); }}>
      <button className="media-card-open" type="button" title="Open item">
        {item.poster_url
          ? <img src={item.poster_url} alt={`${title} poster`} loading="lazy" />
          : <span className="poster-fallback"><Clapperboard /><span>{title}</span></span>}
        <span className="media-card-title">{title}</span>
      </button>
      <StarRating value={item.star_rating} editable={canRate} onChange={onRate} label={`${title} rating`} />
      <button className="media-card-meta media-card-open-meta" type="button" title="Open item">
        {tags.length > 0 && (
          <span className="media-format-list">
            {tags.map((tag) => <span className={cls('media-format-tag', mediaTagTone(tag, item.type === 'game'))} key={tag}>{tag}</span>)}
          </span>
        )}
        {tags.length > 0 && item.year && <span className="media-meta-dash">—</span>}
        {item.year && <span className="media-year">{item.year}</span>}
        {item.interests?.map((person) => <span className="card-interest" title={person.display_name || person.username} key={person.id || person.username}>— {String(person.display_name || person.username).slice(0, 1).toUpperCase()}</span>)}
        {item.owned && <span className="media-owned-tag">Owned</span>}
      </button>
    </article>
  );
}

function MediaDrawer({ item, shelves, onClose, canEdit, onStarRatingChange, canReviewPoster, onFindPosters, onChoosePoster, onFindDetails, onChooseDetails, onUpdate, onUpdateShelves, canInterest, interested, onInterest, onDelete, onRestore }) {
  const [editing, setEditing] = useState(false);
  const [optimisticShelves, setOptimisticShelves] = useState(item.lists || []);
  const optimisticShelvesRef = useRef(item.lists || []);
  const [optimisticInterest, setOptimisticInterest] = useState(interested);
  const [optimisticOwned, setOptimisticOwned] = useState(Boolean(item.owned));
  const [posterCandidates, setPosterCandidates] = useState(null);
  const [posterReviewBusy, setPosterReviewBusy] = useState(false);
  const [posterReviewError, setPosterReviewError] = useState('');
  const [posterReviewOpen, setPosterReviewOpen] = useState(false);
  const [detailReviewOpen, setDetailReviewOpen] = useState(false);
  useEffect(() => { setOptimisticInterest(interested); }, [interested, item.database_id]);
  useEffect(() => { setOptimisticOwned(Boolean(item.owned)); }, [item.owned, item.database_id]);
  useEffect(() => { optimisticShelvesRef.current = item.lists || []; setOptimisticShelves(item.lists || []); }, [item.lists, item.database_id]);
  const tags = mediaDisplayTags(item);
  const title = cleanImportedMediaTitle(item.title);
  const toggleShelf = (shelfId) => {
    const previousShelves = [...optimisticShelvesRef.current];
    const nextShelves = previousShelves.includes(shelfId)
      ? previousShelves.filter((id) => id !== shelfId)
      : [...previousShelves, shelfId];
    optimisticShelvesRef.current = nextShelves;
    setOptimisticShelves(nextShelves);
    onUpdateShelves(previousShelves, nextShelves).catch(() => {
      if (optimisticShelvesRef.current === nextShelves) {
        optimisticShelvesRef.current = previousShelves;
        setOptimisticShelves(previousShelves);
      }
    });
  };

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
            <StarRating value={item.star_rating} editable={canEdit} onChange={onStarRatingChange} label={`${title} rating`} />
            <div className="drawer-meta-tags">
              {tags.length > 0 && (
                <span className="drawer-format-list">
                  {tags.map((tag) => <span className={cls('drawer-format-tag', mediaTagTone(tag, item.type === 'game'))} key={tag}>{tag}</span>)}
                </span>
              )}
              {tags.length > 0 && item.year && <span className="media-meta-dash">—</span>}
              {item.year && <span className="drawer-year">{item.year}</span>}
              {item.interests?.map((person) => <span className="interest-initial" title={person.display_name || person.username} key={person.id || person.username}>— {String(person.display_name || person.username).slice(0, 1).toUpperCase()}</span>)}
            </div>
            <p className="creator">{item.director || item.creator}</p>
            <div className="drawer-status-actions">
              {canInterest && <button className={cls('priority-watch', optimisticInterest && 'active')} onClick={async () => { const previous = optimisticInterest; const next = !previous; setOptimisticInterest(next); try { await onInterest(next); } catch { setOptimisticInterest(previous); } }}><span>{optimisticInterest ? '✓' : '+'}</span>{optimisticInterest ? 'Priority Watch' : 'Mark Priority Watch'}</button>}
              {canEdit && <button className={cls('owned-toggle', optimisticOwned && 'active')} onClick={async () => { const previous = optimisticOwned; const next = !previous; setOptimisticOwned(next); try { await onUpdate({ owned: next }, { success: next ? 'Marked as owned.' : 'Owned tag removed.', failure: 'Owned status could not be saved.' }); } catch { setOptimisticOwned(previous); } }}><span>{optimisticOwned ? <Check size={12} /> : '+'}</span>{optimisticOwned ? 'Owned' : 'Mark as Owned'}</button>}
            </div>
            {canEdit && <div className="drawer-owner-actions">
              <Button className="drawer-edit-button primary" icon={Pencil} onClick={() => setEditing(true)}>Edit details</Button>
            </div>}
            <p className="drawer-description">{item.description || item.notes || 'No description has been added yet.'}</p>
            <div className="genre-row">{item.genres?.map((genre) => <span key={genre}>{genre}</span>)}</div>
            <div className="drawer-lists public-shelf-list">
              <span className="eyebrow">SHELVES</span>
              {(canEdit ? shelves : shelves.filter((shelf) => optimisticShelves.includes(shelf.shelf_id))).length
                ? (canEdit ? shelves : shelves.filter((shelf) => optimisticShelves.includes(shelf.shelf_id))).map((shelf) => canEdit
                  ? <button type="button" className={cls('public-shelf-chip', optimisticShelves.includes(shelf.shelf_id) && 'active')} aria-pressed={optimisticShelves.includes(shelf.shelf_id)} onClick={() => toggleShelf(shelf.shelf_id)} key={shelf.shelf_id}>{optimisticShelves.includes(shelf.shelf_id) ? <Check size={13} /> : <Plus size={13} />}{shelf.name}</button>
                  : <span className="public-shelf-chip active" key={shelf.shelf_id}><Check size={13} />{shelf.name}</span>)
                : <small>No public shelf membership.</small>}
            </div>
            {canEdit && <div className="drawer-danger-zone">
              {!item.poster_url && canReviewPoster && <button onClick={() => setPosterReviewOpen(true)}><Search size={14} />Enrich poster</button>}
              {canReviewPoster && <button onClick={() => setDetailReviewOpen(true)}><Search size={14} />Enrich details</button>}
              {item.deleted_at ? <button onClick={onRestore}>Restore from Bin</button> : <button onClick={onDelete}><Trash2 size={14} />Move to Bin</button>}
            </div>}
          </div>
        </div>
      </aside>
      {editing && <EditMediaDialog item={item} onClose={() => setEditing(false)} onSave={async (changes) => {
        await onUpdate(changes);
        setEditing(false);
      }} />}
      {posterReviewOpen && <PosterEnrichmentDialog item={item} candidates={posterCandidates} busy={posterReviewBusy} error={posterReviewError} onClose={() => setPosterReviewOpen(false)} onLoad={async () => { setPosterReviewBusy(true); setPosterReviewError(''); try { const result = await onFindPosters(); setPosterCandidates(result?.candidates || []); } catch (error) { setPosterReviewError(error?.message || 'Provider candidates could not be loaded.'); } finally { setPosterReviewBusy(false); } }} onChoose={(candidate) => { setPosterReviewOpen(false); setPosterReviewBusy(false); setPosterReviewError(''); onChoosePoster(candidate.poster_url).catch(() => null); }} />}
      {detailReviewOpen && <DetailEnrichmentDialog item={item} onClose={() => setDetailReviewOpen(false)} onLoad={onFindDetails} onChoose={async (candidate) => { await onChooseDetails(candidate); setDetailReviewOpen(false); }} />}
    </div>
  );
}

function PosterEnrichmentDialog({ item, candidates, busy, error, onClose, onLoad, onChoose }) {
  useEscape(onClose);
  useEffect(() => { if (candidates === null && !busy) onLoad(); }, []);
  return <div className="modal-layer editor-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="media-edit-dialog enrichment-dialog">
    <button className="close" onClick={onClose} aria-label="Close poster enrichment"><X /></button><span className="eyebrow">ENRICH POSTER</span><h2>{cleanImportedMediaTitle(item.title)}</h2>
    <p className="dialog-intro">Choose the correct artwork. Nothing is saved until you select an option.</p>
    {busy && candidates === null && <p className="enrichment-loading">Finding poster options…</p>}
    {candidates?.length > 0 && <div className="poster-candidate-grid">{candidates.map((candidate) => <button key={`${candidate.provider}-${candidate.id}`} disabled={busy} onClick={() => onChoose(candidate)}><img src={candidate.poster_url} alt="" /><span>{candidate.title}{candidate.year ? ` (${candidate.year})` : ''}</span><small>{candidate.provider}</small></button>)}</div>}
    {candidates?.length === 0 && !busy && <Empty>No poster options were found.</Empty>}{error && <p className="auth-error">{error}</p>}
    <div className="dialog-actions"><button className="text-button" onClick={onClose}>Discard</button></div>
  </section></div>;
}

function DetailEnrichmentDialog({ item, onClose, onLoad, onChoose }) {
  useEscape(onClose);
  const [candidates, setCandidates] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { onLoad().then((result) => setCandidates(result?.candidates || [])).catch((loadError) => setError(loadError?.message || 'Detail options could not be loaded.')).finally(() => setBusy(false)); }, []);
  const fields = selected?.details ? Object.entries(selected.details).filter(([, value]) => value !== null && value !== '' && (!Array.isArray(value) || value.length)) : [];
  return <div className="modal-layer editor-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="media-edit-dialog enrichment-dialog">
    <button className="close" onClick={onClose} aria-label="Close detail enrichment"><X /></button><span className="eyebrow">ENRICH DETAILS</span><h2>{cleanImportedMediaTitle(item.title)}</h2><p className="dialog-intro">Pick the matching result. Saving fills blank fields only; your existing details are never replaced.</p>
    {busy && <p className="enrichment-loading">Finding matching details…</p>}
    {candidates?.length > 0 && <div className="detail-candidate-list">{candidates.map((candidate) => <button className={selected === candidate ? 'selected' : ''} key={`${candidate.provider}-${candidate.id}`} onClick={() => setSelected(candidate)}><span><b>{candidate.title}</b><small>{candidate.year || 'Year unknown'} · {candidate.provider}</small></span><Check size={15} /></button>)}</div>}
    {candidates?.length === 0 && !busy && <Empty>No detail options were found.</Empty>}
    {selected && <div className="detail-preview">{fields.map(([name, value]) => <div key={name}><small>{name.replaceAll('_', ' ')}</small><span>{Array.isArray(value) ? value.join(', ') : String(value)}</span></div>)}</div>}
    {error && <p className="auth-error">{error}</p>}
    <div className="dialog-actions"><button className="text-button" onClick={onClose}>Discard</button><Button icon={Check} disabled={!selected || busy} onClick={async () => { setBusy(true); setError(''); try { await onChoose(selected); } catch { setError('Those details could not be saved.'); setBusy(false); } }}>{busy && selected ? 'Saving…' : 'Save New Details'}</Button></div>
  </section></div>;
}

function SearchModal({ data, query, setQuery, onClose, onOpen }) {
  useEscape(onClose);
  const normalizedQuery = query.trim().toLowerCase();
  const results = normalizedQuery
    ? active(data.media).filter((item) => mediaSearchText(item).includes(normalizedQuery))
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


function ConfirmDialog({ title, message, confirmLabel = 'Confirm', tone = 'default', optimistic = false, onConfirm, onClose }) {
  useEscape(onClose);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return <div className="modal-layer confirm-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="media-edit-dialog confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
    <button className="close" onClick={onClose} aria-label="Close confirmation"><X /></button>
    <span className="eyebrow">PLEASE CONFIRM</span><h2 id="confirm-title">{title}</h2><p className="dialog-intro">{message}</p>
    {error && <p className="auth-error">{error}</p>}
    <div className="dialog-actions"><button className="text-button" onClick={onClose} disabled={busy}>Cancel</button><Button className={tone === 'danger' ? 'confirm-danger' : ''} disabled={busy} onClick={async () => { if (optimistic) { onClose(); Promise.resolve(onConfirm()).catch(() => null); return; } setBusy(true); setError(''); try { await onConfirm(); onClose(); } catch { setError('That change could not be completed. Please try again.'); setBusy(false); } }}>{busy ? 'Working…' : confirmLabel}</Button></div>
  </section></div>;
}

function ShelfEditDialog({ shelf, onClose, onSave }) {
  useEscape(onClose);
  const [name, setName] = useState(shelf.name);
  const [subtitle, setSubtitle] = useState(shelf.subtitle || '');
  const [queueList, setQueueList] = useState(Boolean(shelf.queueList));
  const queueCopy = shelf.section === 'book' ? ['Reading List', 'Items on this shelf count toward “to read”.'] : shelf.section === 'game' ? ['Backlog / To Play shelf', 'Items on this shelf count toward “to play”.'] : ['Watchlist / To Watch shelf', 'Items on this shelf count toward “to watch”.'];
  return <div className="modal-layer editor-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="media-edit-dialog shelf-edit-dialog" onSubmit={(event) => { event.preventDefault(); const cleanedName = name.trim(); const cleanedSubtitle = subtitle.trim(); if ((!shelf.required && !cleanedName) || cleanedSubtitle.length > 180) return; onSave({ ...(shelf.required ? {} : { name: cleanedName }), subtitle: cleanedSubtitle || null, is_queue_list: queueList }); onClose(); }}>
    <button className="close" type="button" onClick={onClose} aria-label="Close shelf editor"><X /></button>
    <span className="eyebrow">EDIT SHELF</span><h2>{shelf.name}</h2>
    {!shelf.required && <label>Shelf name<input autoFocus value={name} maxLength="100" onChange={(event) => setName(event.target.value)} required /></label>}
    <label>Subtitle <span className="field-hint">Optional</span><input autoFocus={shelf.required} value={subtitle} maxLength="180" onChange={(event) => setSubtitle(event.target.value)} placeholder="Add a short note beneath this shelf title" /></label>
    <label className="reading-list-designation"><input type="checkbox" checked={queueList} onChange={(event) => setQueueList(event.target.checked)} /><span><b>{queueCopy[0]}</b><small>{queueCopy[1]}</small></span></label>
    <small className="character-count">{subtitle.length} / 180</small>
    <div className="dialog-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><Button type="submit" icon={Pencil} disabled={!shelf.required && !name.trim()}>Save Shelf</Button></div>
  </form></div>;
}

function CreateShelfDialog({ section, onClose, onSave }) {
  useEscape(onClose);
  const [name, setName] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [queueList, setQueueList] = useState(false);
  const [mainWatchlist, setMainWatchlist] = useState(false);
  const queueCopy = section === 'book' ? ['Reading List', 'Count this shelf toward “to read”.'] : section === 'game' ? ['Backlog / To Play shelf', 'Count this shelf toward “to play”.'] : ['Watchlist / To Watch shelf', 'Count this shelf toward “to watch”.'];
  return <div className="modal-layer editor-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="media-edit-dialog shelf-edit-dialog create-shelf-dialog" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; onSave({ name: name.trim(), subtitle: subtitle.trim() || null, is_queue_list: queueList, ...(section === 'screen' ? { show_in_main_watchlist: mainWatchlist } : {}) }); }}>
    <button className="close" type="button" onClick={onClose} aria-label="Close create shelf"><X /></button>
    <span className="eyebrow">NEW SHELF</span><h2>Create a Shelf</h2>
    <label>Shelf name<input autoFocus value={name} maxLength="100" onChange={(event) => setName(event.target.value)} required /></label>
    <label>Subtitle <span className="field-hint">Optional</span><input value={subtitle} maxLength="180" onChange={(event) => setSubtitle(event.target.value)} placeholder="Add a short note beneath this shelf title" /></label>
    <label className="reading-list-designation"><input type="checkbox" checked={queueList} onChange={(event) => setQueueList(event.target.checked)} /><span><b>{queueCopy[0]}</b><small>{queueCopy[1]}</small></span></label>
    {section === 'screen' && <label className="reading-list-designation"><input type="checkbox" checked={mainWatchlist} onChange={(event) => setMainWatchlist(event.target.checked)} /><span><b>Include in Main Watchlist</b><small>Mirror this shelf publicly in the shared Main Watchlist.</small></span></label>}
    <small className="character-count">{subtitle.length} / 180</small>
    <div className="dialog-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><Button type="submit" icon={Plus} disabled={!name.trim()}>Create Shelf</Button></div>
  </form></div>;
}

function AccountDialog({ account, onClose, onSignedIn, onSignedOut, onManageUsers, viewAsMember, onViewAsMemberChange, onAccountUpdated }) {
  useEscape(onClose);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nextDisplayName, setNextDisplayName] = useState(account?.profile?.display_name || '');
  const [nextPassword, setNextPassword] = useState('');

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
            {account.profile?.role === 'admin' && <label className="admin-view-toggle"><input type="checkbox" checked={viewAsMember} onChange={(event) => onViewAsMemberChange(event.target.checked)} /><span><b>View as non-Admin</b><small>You will still be the owner of your own collection.</small></span></label>}
            <button className="account-settings-toggle" type="button" onClick={() => { setSettingsOpen((current) => !current); setError(''); }}>{settingsOpen ? 'Hide account settings' : 'Display name & password'}</button>
            {settingsOpen && <form className="account-settings" onSubmit={async (event) => { event.preventDefault(); setSubmitting(true); setError(''); try { let profile = account.profile; if (nextDisplayName.trim() !== account.profile.display_name) profile = await updateDisplayName(account.session.access_token, nextDisplayName.trim()); if (nextPassword) { if (nextPassword.length < 8) throw new Error('short-password'); await updatePassword(account.session.access_token, nextPassword); setNextPassword(''); } await onAccountUpdated(profile); } catch (settingsError) { setError(settingsError?.message === 'short-password' ? 'Use at least 8 characters for the new password.' : 'Those account settings could not be saved. Apply the latest Supabase migration and try again.'); } finally { setSubmitting(false); } }}>
              <label>Display name<input value={nextDisplayName} minLength="2" maxLength="80" onChange={(event) => setNextDisplayName(event.target.value)} required /></label>
              <label>New password <span className="field-hint">Optional</span><input type="password" value={nextPassword} minLength="8" autoComplete="new-password" onChange={(event) => setNextPassword(event.target.value)} placeholder="Leave blank to keep your password" /></label>
              <Button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save Account Settings'}</Button>
            </form>}
            {error && <p className="auth-error">{error}</p>}
            <div className="account-actions">{account.profile?.role === 'admin' && <Button onClick={onManageUsers}>User Management</Button>}<Button icon={LogOut} onClick={leave} disabled={submitting}>Sign Out</Button></div>
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


function mediaForm(item = {}, fallbackType = 'film') {
  return {
    title: item.title || '', type: item.type || fallbackType, year: item.year ?? '', creator: item.creator || '', director: item.director || '',
    description: item.description || '', notes: item.notes || '', poster_url: item.poster_url || '',
    format: item.format || '', platforms: (item.platforms || []).join(', '), genres: (item.genres || []).join(', '),
    runtime: item.runtime ?? '', owned: Boolean(item.owned),
  };
}

function mediaFormPayload(form) {
  const optionalNumber = (value, { min, max } = {}) => {
    if (value === '') return null;
    const number = Number(value);
    if (!Number.isInteger(number) || (min !== undefined && number < min) || (max !== undefined && number > max)) return undefined;
    return number;
  };
  const year = optionalNumber(form.year, { min: 1000, max: 3000 });
  const runtime = optionalNumber(form.runtime, { min: 1 });
  if (!form.title.trim() || year === undefined || runtime === undefined) return null;
  const list = (value) => [...new Set(value.split(',').map((part) => part.trim()).filter(Boolean))];
  return {
    title: form.title.trim(), type: form.type, year, creator: form.creator.trim() || null, director: form.director.trim() || null,
    description: form.description.trim() || null, notes: form.notes.trim() || null, poster_url: form.poster_url.trim() || null,
    format: form.format.trim() || null, platforms: list(form.platforms), genres: list(form.genres), runtime, owned: form.owned,
  };
}

function MediaDetailFields({ form, setForm, section, compact = false }) {
  const set = (name) => (event) => setForm((current) => ({ ...current, [name]: event.target.value }));
  return <div className="media-edit-grid optional-detail-grid">
    {section === 'screen' && <label>Type<select value={form.type} onChange={set('type')}><option value="film">Film</option><option value="television">Television</option></select></label>}
    <label>Year<input type="number" min="1000" max="3000" placeholder="YYYY" value={form.year} onChange={set('year')} /></label>
    {section === 'book' && <label>Author<input value={form.creator} onChange={set('creator')} /></label>}
    {section === 'game' && <label>Developer and/or Publisher<input value={form.creator} onChange={set('creator')} /></label>}
    {section === 'screen' && <label>Director<input value={form.director} onChange={set('director')} /></label>}
    {section === 'game'
      ? <label>Platforms (comma separated)<input value={form.platforms} onChange={set('platforms')} placeholder="PC, PlayStation 5…" /></label>
      : <label>Format<input value={form.format} onChange={set('format')} placeholder={section === 'book' ? 'Hardback, paperback…' : 'DVD, Blu-ray, 4K…'} /></label>}
    <label>Genres (comma separated)<input value={form.genres} onChange={set('genres')} placeholder="Drama, mystery…" /></label>
    {section === 'screen' && <label>Runtime (minutes)<input type="number" min="1" value={form.runtime} onChange={set('runtime')} /></label>}
    <label className="full">Poster URL<input type="url" value={form.poster_url} onChange={set('poster_url')} placeholder="https://…" /></label>
    <label className="full">Description<textarea value={form.description} onChange={set('description')} rows={compact ? 2 : 4} /></label>
    <label className="full">Notes<textarea value={form.notes} onChange={set('notes')} rows={compact ? 2 : 3} /></label>
  </div>;
}

function AddMediaDialog({ section, shelves, initialShelfIds = [], onClose, onSave }) {
  useEscape(onClose);
  const [form, setForm] = useState(() => mediaForm({}, section === 'screen' ? 'film' : section));
  const [priorityWatch, setPriorityWatch] = useState(false);
  const [shelfIds, setShelfIds] = useState(initialShelfIds);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const destination = shelves.find((shelf) => shelfIds.includes(shelf.shelf_id));
  const namePlaceholder = section === 'screen' ? 'Name of film or show' : section === 'book' ? 'Name of book' : 'Name of video game';
  const submit = async (event) => {
    event.preventDefault();
    const item = mediaFormPayload(form);
    if (!item) { setError('Enter a name. If supplied, year must be 1000–3000 and runtime must be a positive whole number.'); return; }
    setSaving(true); setError('');
    try { await onSave(item, shelfIds, priorityWatch); }
    catch { setError('The media item could not be saved. Check the fields and try again.'); setSaving(false); }
  };
  return <div className="modal-layer editor-layer add-media-layer"><form className="media-edit-dialog add-media-dialog" onSubmit={submit}>
    <button className="close" type="button" onClick={onClose} aria-label="Close add item"><X /></button>
    <span className="eyebrow">ADD TO {destination?.name?.toUpperCase() || 'COLLECTION'}</span><h2>Add an Item</h2><p className="dialog-intro">Only the name is required. Add as much or as little detail as you like.</p>
    <label className="required-media-title">Name <span>Required</span><input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} placeholder={namePlaceholder} required /></label>
    <section className="optional-media-section">
      <header><span className="eyebrow">OPTIONAL</span><p>Everything below can be left blank.</p></header>
      <MediaDetailFields form={form} setForm={setForm} section={section} compact />
      <div className="add-status-options">
        <button type="button" className={cls('add-status-option owned', form.owned && 'active')} aria-pressed={form.owned} onClick={() => setForm((current) => ({ ...current, owned: !current.owned }))}><span>{form.owned ? <Check size={12} /> : <Plus size={12} />}</span><strong>{form.owned ? 'Owned' : 'Mark as Owned'}</strong></button>
        {section === 'screen' && <button type="button" className={cls('add-status-option priority', priorityWatch && 'active')} aria-pressed={priorityWatch} onClick={() => setPriorityWatch((current) => !current)}><span>{priorityWatch ? <Check size={12} /> : <Plus size={12} />}</span><strong>{priorityWatch ? 'Priority Watch' : 'Mark Priority Watch'}</strong></button>}
      </div>
      <fieldset className="shelf-picker"><legend>Also add to</legend>{shelves.map((shelf) => <label className={shelfIds.includes(shelf.shelf_id) ? 'selected' : ''} key={shelf.shelf_id}><input type="checkbox" checked={shelfIds.includes(shelf.shelf_id)} onChange={() => setShelfIds((ids) => ids.includes(shelf.shelf_id) ? ids.filter((id) => id !== shelf.shelf_id) : [...ids, shelf.shelf_id])} /><span>{shelf.name}</span></label>)}</fieldset>
    </section>
    {error && <p className="auth-error">{error}</p>}<div className="dialog-actions"><button type="button" className="text-button" onClick={onClose}>Cancel</button><Button type="submit" icon={Plus} disabled={saving}>{saving ? 'Adding…' : 'Add Item'}</Button></div>
  </form></div>;
}

function BulkImportDialog({ section, shelves, onClose, onImport }) {
  useEscape(onClose);
  const [text, setText] = useState('');
  const [shelfId, setShelfId] = useState(shelves[0]?.shelf_id || '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const sectionLabel = section === 'screen' ? 'Film & TV' : section === 'book' ? 'Books' : 'Video Games';
  const example = section === 'screen' ? 'Film | Arrival | 2016\nTV | Severance | 2022' : section === 'book' ? 'The Left Hand of Darkness | 1969' : 'Disco Elysium | 2019';
  const parsed = text.split(/\r?\n/).map((line, index) => ({ line: line.trim(), number: index + 1 })).filter((row) => row.line).map((row) => {
    const parts = row.line.split('|').map((part) => part.trim());
    const typeToken = section === 'screen' ? String(parts.shift() || '').toLowerCase() : section;
    const type = typeToken === 'tv' ? 'television' : typeToken;
    const title = parts.shift() || '';
    const yearText = parts.shift() || '';
    const year = yearText ? Number(yearText) : null;
    const validType = section === 'screen' ? type === 'film' || type === 'television' : type === section;
    const validYear = year === null || (Number.isInteger(year) && year >= 1000 && year <= 3000);
    return { ...row, item: { type, title, year }, valid: validType && Boolean(title) && validYear && parts.length === 0 };
  });
  const invalidRows = parsed.filter((row) => !row.valid);
  const items = parsed.filter((row) => row.valid).map((row) => row.item);

  return <div className="modal-layer editor-layer"><form className="media-edit-dialog bulk-import-dialog" onSubmit={async (event) => { event.preventDefault(); if (!shelfId || !items.length || invalidRows.length) return; setSaving(true); setError(''); try { await onImport(shelfId, items); } catch { setError('Nothing was imported. Check the format, apply the latest Supabase migration, and try again.'); setSaving(false); } }}>
    <button className="close" type="button" onClick={onClose} aria-label="Close bulk import"><X /></button><span className="eyebrow">OWNER-ONLY IMPORT</span><h2>Bulk Import {sectionLabel}</h2><p className="dialog-intro">This batch can contain only {sectionLabel.toLowerCase()} entries and will be added to one shelf. Matching title-and-year duplicates are skipped.</p>
    <label className="bulk-import-destination">Destination shelf<select value={shelfId} onChange={(event) => setShelfId(event.target.value)}>{shelves.map((shelf) => <option key={shelf.shelf_id} value={shelf.shelf_id}>{shelf.name}</option>)}</select></label>
    <label className="bulk-import-input">One item per line<textarea autoFocus rows="10" value={text} onChange={(event) => setText(event.target.value)} placeholder={example} /></label>
    <p className="bulk-import-format">{section === 'screen' ? 'Format: Film or TV | Title | Year (year optional)' : 'Format: Title | Year (year optional)'}</p>
    {invalidRows.length > 0 && <p className="auth-error">Check line{invalidRows.length === 1 ? '' : 's'} {invalidRows.map((row) => row.number).join(', ')}. This batch has not been imported.</p>}{error && <p className="auth-error">{error}</p>}
    <div className="dialog-actions"><button type="button" className="text-button" onClick={onClose}>Cancel</button><Button type="submit" icon={Plus} disabled={saving || !items.length || invalidRows.length > 0 || !shelfId}>{saving ? 'Importing…' : `Bulk Import ${items.length || ''} ${sectionLabel}`}</Button></div>
  </form></div>;
}

function EditMediaDialog({ item, onClose, onSave }) {
  useEscape(onClose);
  const [form, setForm] = useState(() => mediaForm(item, item.type));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    const changes = mediaFormPayload(form);
    if (!changes) {
      setError('Enter a title, a whole year from 1000–3000, and a positive whole runtime.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(changes);
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
        <label className="full">Name<input value={form.title} onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))} required /></label>
      </div>
      <MediaDetailFields form={form} setForm={setForm} section={mediaSection(item)} />
      {error && <p className="auth-error">{error}</p>}
      <div className="dialog-actions edit-media-actions"><button type="button" className="text-button" onClick={onClose}>Cancel</button><Button type="submit" icon={Check} disabled={saving}>{saving ? 'Saving…' : 'Save Changes'}</Button></div>
    </form>
  </div>;
}

function ClubEditorDialog({ club, onClose, onSave }) {
  useEscape(onClose);
  const [name, setName] = useState(club?.name || '');
  return <div className="modal-layer editor-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="media-edit-dialog club-editor-dialog" onSubmit={(event) => { event.preventDefault(); if (!name.trim()) return; onSave(name.trim()); onClose(); }}>
    <button className="close" type="button" onClick={onClose} aria-label="Close club editor"><X /></button>
    <span className="eyebrow">ADMIN ONLY</span><h2>{club ? 'Rename Club' : 'Create a Club'}</h2>
    <label>Club name<input autoFocus value={name} maxLength="80" onChange={(event) => setName(event.target.value)} required /></label>
    <div className="dialog-actions"><button className="text-button" type="button" onClick={onClose}>Cancel</button><Button type="submit" icon={club ? Pencil : Plus} disabled={!name.trim()}>{club ? 'Save Club' : 'Create Club'}</Button></div>
  </form></div>;
}

function ClubMembershipDialog({ user, clubs, onClose, onSave }) {
  useEscape(onClose);
  const [selected, setSelected] = useState(() => clubs.filter((club) => club.member_ids.includes(user.id)).map((club) => club.id));
  const toggle = (clubId) => setSelected((current) => current.includes(clubId) ? current.filter((id) => id !== clubId) : [...current, clubId]);
  return <div className="modal-layer editor-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="media-edit-dialog club-membership-dialog">
    <button className="close" onClick={onClose} aria-label="Close club membership"><X /></button>
    <span className="eyebrow">ADMIN ONLY</span><h2>{user.display_name}</h2>
    <p className="dialog-intro">Choose which private circles can share collections with this member.</p>
    <div className="club-membership-list">{clubs.map((club) => <label key={club.id}><input type="checkbox" checked={selected.includes(club.id)} onChange={() => toggle(club.id)} /><span><b>{club.name}</b><small>{club.member_ids.length} member{club.member_ids.length === 1 ? '' : 's'}</small></span></label>)}{!clubs.length && <Empty>Create a club first.</Empty>}</div>
    <div className="dialog-actions"><button className="text-button" onClick={onClose}>Cancel</button><Button icon={Check} onClick={() => { onSave(selected); onClose(); }}>Save Clubs</Button></div>
  </section></div>;
}

function AdminUsers({ accessToken, clubs, onClubsChange, mainWatchlistClubId, onMainWatchlistClubChange, requestConfirmation, onClose, onUsersChanged }) {
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [clubEditor, setClubEditor] = useState(null);
  const [membershipUser, setMembershipUser] = useState(null);
  useEscape(onClose, !clubEditor && !membershipUser);
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
  const saveClub = (name) => {
    const existing = clubEditor?.id ? clubEditor : null;
    const previous = [...clubs];
    if (existing) {
      onClubsChange(clubs.map((club) => club.id === existing.id ? { ...club, name } : club));
      renameClub(accessToken, existing.id, name).then(() => onUsersChanged?.()).catch(() => { onClubsChange(previous); setError('That club name could not be saved.'); });
      return;
    }
    const temporaryId = `optimistic-club-${Date.now()}`;
    onClubsChange([...clubs, { id: temporaryId, name, member_ids: [], optimistic: true }]);
    createClub(accessToken, name).then((created) => { onClubsChange([...previous, created]); }).catch(() => { onClubsChange(previous); setError('That club could not be created. Try a different name.'); });
  };
  const saveMemberships = (user, clubIds) => {
    const previous = clubs.map((club) => ({ ...club, member_ids: [...club.member_ids] }));
    const next = clubs.map((club) => ({ ...club, member_ids: clubIds.includes(club.id) ? unique([...club.member_ids, user.id]) : club.member_ids.filter((id) => id !== user.id) }));
    onClubsChange(next);
    setUserClubs(accessToken, user.id, clubIds).then(() => onUsersChanged?.()).catch(() => { onClubsChange(previous); setError(`${user.display_name}’s clubs could not be saved.`); });
  };
  const removeClub = (club) => requestConfirmation({ title: `Delete ${club.name}?`, message: 'Members will keep their collections, but this private circle will be removed.', confirmLabel: 'Delete Club', tone: 'danger', optimistic: true, onConfirm: async () => {
    const previous = [...clubs];
    onClubsChange(clubs.filter((row) => row.id !== club.id));
    if (mainWatchlistClubId === club.id) onMainWatchlistClubChange('');
    try { await deleteClub(accessToken, club.id); await onUsersChanged?.(); }
    catch (deleteError) { onClubsChange(previous); setError(`${club.name} could not be deleted.`); throw deleteError; }
  } });
  return <div className="modal-layer"><section className="media-edit-dialog admin-users-dialog"><button className="close" onClick={onClose}><X /></button><span className="eyebrow">ADMIN</span><h2>User Management</h2><p className="dialog-intro">Approve members, manage private clubs and choose your Main Watchlist view.</p>{error && <p className="auth-error">{error}</p>}
    <section className="admin-club-panel"><div className="admin-club-heading"><span><b>Clubs</b><small>Private sharing circles</small></span><Button className="quiet-button" icon={Plus} onClick={() => setClubEditor({})}>New Club</Button></div>
      <label className="admin-main-club-view"><span><b>Main Watchlist View</b><small>Only changes what you see on this device.</small></span><select value={mainWatchlistClubId} onChange={(event) => onMainWatchlistClubChange(event.target.value)}><option value="">All clubs</option>{clubs.filter((club) => !club.optimistic).map((club) => <option value={club.id} key={club.id}>{club.name}</option>)}</select></label>
      <div className="club-chip-list">{clubs.map((club) => <span className={cls('admin-club-chip', club.optimistic && 'is-optimistic')} key={club.id}><Users size={13} /><b>{club.name}</b><small>{club.member_ids.length}</small>{!club.optimistic && <><button onClick={() => setClubEditor(club)} aria-label={`Rename ${club.name}`}><Pencil size={12} /></button><button onClick={() => removeClub(club)} aria-label={`Delete ${club.name}`}><X size={12} /></button></>}</span>)}{!clubs.length && <small className="no-clubs">No clubs yet.</small>}</div>
    </section>
    <div className="user-list">{users.map((user) => {
    const status = user.deactivated_at ? 'Deactivated' : user.approved_at ? 'Approved' : user.rejected_at ? 'Rejected' : 'Pending';
    const clubCount = clubs.filter((club) => club.member_ids.includes(user.id)).length;
    return <div className={cls('user-row', user.deactivated_at && 'deactivated')} key={user.id}><span><b>{user.display_name}</b><small>@{user.username}</small></span><span className="user-status">{status}</span>{user.approved_at && !user.deactivated_at && <Button className="quiet-button user-clubs-button" icon={Users} onClick={() => setMembershipUser(user)}>Clubs{clubCount ? ` · ${clubCount}` : ''}</Button>}{!user.approved_at && !user.rejected_at && <><Button disabled={busy === user.id} onClick={() => act('approve', user)}>Approve</Button><Button disabled={busy === user.id} onClick={() => act('reject', user)}>Reject</Button></>}{user.approved_at && user.role !== 'admin' && !user.deactivated_at && <Button className="quiet-button" disabled={busy === user.id} onClick={() => act('deactivate', user)}>Deactivate</Button>}{user.deactivated_at && <Button disabled={busy === user.id} onClick={() => act('restore', user)}>Restore library</Button>}</div>;
  })}</div></section>{clubEditor && <ClubEditorDialog club={clubEditor.id ? clubEditor : null} onClose={() => setClubEditor(null)} onSave={saveClub} />}{membershipUser && <ClubMembershipDialog user={membershipUser} clubs={clubs.filter((club) => !club.optimistic)} onClose={() => setMembershipUser(null)} onSave={(clubIds) => saveMemberships(membershipUser, clubIds)} />}</div>;
}
