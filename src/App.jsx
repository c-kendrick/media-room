import React, { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  Cloud,
  Command,
  Film,
  Gamepad2,
  LogIn,
  LogOut,
  Menu,
  RotateCw,
  Search,
  Shuffle,
  SlidersHorizontal,
  Trophy,
  UserRound,
  X,
} from 'lucide-react';
import { loadMediaSnapshot } from './data.js';
import { loadAuthenticatedAccount, signInWithPassword, signOut } from './auth.js';

function cls(...values) {
  return values.filter(Boolean).join(' ');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function active(rows) {
  return (rows || []).filter((row) => !row.deleted_at);
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

function chunk(values, size) {
  const pages = [];
  for (let index = 0; index < values.length; index += size) {
    pages.push(values.slice(index, index + size));
  }
  return pages;
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
        {description && <p>{description}</p>}
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

  const refresh = async ({ fresh = false, notify = false } = {}) => {
    if (fresh) setRefreshing(true);
    try {
      const snapshot = await loadMediaSnapshot({ fresh });
      setData(snapshot);
      setError('');
      if (notify) setToast('Public media data refreshed.');
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

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

  if (loading) {
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
          <button className="active" onClick={() => { setMobileNav(false); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
            <Clapperboard size={17} />Media
          </button>
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

        <main>
          <MediaView data={data} notify={setToast} openMedia={setSelectedMediaId} />
        </main>
        <footer>Published from Kit’s Local Media Room.</footer>
      </div>

      {selectedMedia && (
        <MediaDrawer
          item={selectedMedia}
          shelves={mediaShelvesForSection(data, mediaSection(selectedMedia))}
          onClose={() => setSelectedMediaId(null)}
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
            setToast('Signed in securely.');
          }}
          onSignedOut={() => {
            setAccount(null);
            setAccountOpen(false);
            setToast('Signed out.');
          }}
        />
      )}

      {toast && <div className="toast"><Check size={16} />{toast}</div>}
    </div>
  );
}

function MediaView({ data, notify, openMedia }) {
  const [section, setSection] = useState('screen');
  const [query, setQuery] = useState('');
  const [listFilters, setListFilters] = useState([]);
  const [formatFilters, setFormatFilters] = useState([]);
  const [genreFilters, setGenreFilters] = useState([]);
  const [typeFilters, setTypeFilters] = useState([]);

  const shelves = mediaShelvesForSection(data, section);
  const items = active(data.media).filter((item) => mediaSection(item) === section);
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
      && matchesAny(genreFilters, item.genres || []);
  });
  const randomPool = contentFiltered.filter((item) => matchesAny(listFilters, item.lists || []));
  const visibleShelves = shelves.filter((shelf) => !listFilters.length || listFilters.includes(shelf.shelf_id));

  const sectionLabel = section === 'screen' ? 'Film & TV' : section === 'book' ? 'Books' : 'Video Games';
  const singularLabel = section === 'screen' ? 'film or TV show' : section === 'book' ? 'book' : 'video game';

  const switchSection = (next) => {
    setSection(next);
    setQuery('');
    setListFilters([]);
    setFormatFilters([]);
    setGenreFilters([]);
    setTypeFilters([]);
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
  };

  return (
    <div className="page media-page">
      <PageHero
        eyebrow="SCREEN, SHELF & STORY"
        title="The media room"
        description="Kit’s full watchlist, physical collection, books and games, built to browse, not merely store."
        icon={Clapperboard}
        stats={[
          [items.filter((item) => ['watchlist', 'reading_list'].some((list) => item.lists?.includes(list))).length, 'to watch/read'],
          [items.filter((item) => ['collection', 'library', 'top_shelf', 'xbox', 'rpg', 'action_adventure', 'building_puzzle', 'strategy', 'vr'].some((list) => item.lists?.includes(list))).length, 'owned'],
        ]}
      />

      <div className="media-command public-media-command">
        <div className="media-tabs">
          <button className={section === 'screen' ? 'active' : ''} onClick={() => switchSection('screen')}><Film />Film & TV</button>
          <button className={section === 'book' ? 'active' : ''} onClick={() => switchSection('book')}><BookOpen />Books</button>
          <button className={section === 'game' ? 'active' : ''} onClick={() => switchSection('game')}><Gamepad2 />Video Games</button>
        </div>

        <div className={cls('media-filters', section === 'screen' && 'has-type')}>
          <label className="media-search"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${sectionLabel.toLowerCase()}…`} /></label>
          <MultiSelect label="All lists" values={listFilters} options={shelves.map((shelf) => [shelf.shelf_id, shelf.name])} onChange={setListFilters} />
          {section === 'screen' && <MultiSelect label="Film & TV" values={typeFilters} options={sectionTypes} onChange={setTypeFilters} />}
          <MultiSelect label={section === 'game' ? 'All platforms' : 'All formats'} values={formatFilters} options={formats.map((value) => [value, value])} onChange={setFormatFilters} />
          <MultiSelect label="All genres" values={genreFilters} options={genres.map((value) => [value, value])} onChange={setGenreFilters} />
        </div>

        <div className="media-action-row public-actions">
          <Button className="random-pick" icon={Shuffle} onClick={pickRandom}>Pick a {singularLabel}</Button>
          {(listFilters.length || formatFilters.length || genreFilters.length || typeFilters.length || query) && (
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
          return <MediaShelf key={shelf.shelf_id} shelf={shelf} items={shelfItems} onOpen={openMedia} />;
        })}
      </div>

      {!randomPool.length && <Empty>No media matches those filters.</Empty>}
    </div>
  );
}

function MediaShelf({ shelf, items, onOpen }) {
  const trackRef = useRef(null);
  const pages = chunk(items, 14);
  const scrollPage = (direction) => {
    const track = trackRef.current;
    if (!track) return;
    track.scrollBy({ left: direction * Math.max(520, track.clientWidth - 24), behavior: 'smooth' });
  };

  return (
    <section className="media-shelf">
      <div className="shelf-head">
        <div className="shelf-title">
          <h2><Trophy size={21} />{shelf.name}<span>{items.length}</span></h2>
        </div>
        <div>
          <button aria-label={`Scroll ${shelf.name} left`} onClick={() => scrollPage(-1)}><ChevronLeft /></button>
          <button aria-label={`Scroll ${shelf.name} right`} onClick={() => scrollPage(1)}><ChevronRight /></button>
        </div>
      </div>
      <div className="poster-track" ref={trackRef}>
        {pages.map((page, pageIndex) => (
          <div className="poster-page" key={pageIndex}>
            {page.map((item) => <MediaCard key={item.item_id} item={item} onClick={() => onOpen(item.item_id)} />)}
          </div>
        ))}
        {!items.length && <div className="empty-poster">No items on this shelf yet.</div>}
      </div>
    </section>
  );
}

function MediaCard({ item, onClick }) {
  const tags = mediaDisplayTags(item);
  const title = cleanImportedMediaTitle(item.title);
  return (
    <button className="media-card" title="Open item" onClick={onClick}>
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
      </span>
    </button>
  );
}

function MediaDrawer({ item, shelves, onClose }) {
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
            </div>
            <p className="creator">{item.director || item.creator}</p>
            <p className="drawer-description">{item.description || item.notes || 'No description has been added yet.'}</p>
            <div className="genre-row">{item.genres?.map((genre) => <span key={genre}>{genre}</span>)}</div>
            <div className="drawer-lists public-shelf-list">
              <span className="eyebrow">SHELVES</span>
              {memberShelves.length
                ? memberShelves.map((shelf) => <span className="public-shelf-chip" key={shelf.shelf_id}><Check size={13} />{shelf.name}</span>)
                : <small>No public shelf membership.</small>}
            </div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function SearchModal({ data, query, setQuery, onClose, onOpen }) {
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


function AccountDialog({ account, onClose, onSignedIn, onSignedOut }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
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
            <p>{account.profile?.role === 'admin' ? 'Administrator account' : account.profile?.approved_at ? 'Approved member' : 'Pending approval'}</p>
            <Button icon={LogOut} onClick={leave} disabled={submitting}>Sign out</Button>
          </>
        ) : (
          <>
            <span className="eyebrow">ACCOUNT</span>
            <h2>Sign in</h2>
            <p>Use your Media Room email and password.</p>
            <form onSubmit={submit}>
              <label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
              <label>Password<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
              {error && <p className="auth-error">{error}</p>}
              <Button type="submit" icon={LogIn} disabled={submitting}>{submitting ? 'Signing in…' : 'Sign in'}</Button>
            </form>
          </>
        )}
      </section>
    </div>
  );
}
