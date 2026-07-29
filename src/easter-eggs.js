const DAY_MS = 24 * 60 * 60 * 1000;

export const FIGHT_CLUB_MESSAGES = Object.freeze([
  'Are you sure you want to break the first rule of Fight Club?',
  'Are you sure you want to break the second rule of Fight Club?',
]);

export const FIGHT_CLUB_ATTEMPT_COOLDOWN_MS = DAY_MS;
export const FIGHT_CLUB_SHOWN_COOLDOWN_MS = 90 * DAY_MS;
export const FIGHT_CLUB_CHANCE = 0.25;

const PROVIDER_IDS = Object.freeze({
  everythingEverywhere: { tmdb: ['545611'] },
  fightClub: { tmdb: ['550'] },
  starWars: { tmdb: ['11', '1891', '1892', '1893', '1894', '1895', '140607', '181808', '181812', '330459', '348350'] },
  theRoom: { tmdb: ['17473'] },
  lordOfTheRings: { tmdb: ['120', '121', '122'] },
  shrek: { tmdb: ['808'] },
  theMatrix: { tmdb: ['603'] },
  forrestGump: { tmdb: ['13'] },
  terminator: { tmdb: ['218', '280', '296', '534', '87101', '290859'] },
});

export function normalizeEasterEggTitle(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/gi, ' ')
    .trim()
    .toLowerCase()
    .replace(/\bpokemon\b/g, 'pokemon')
    .replace(/\s+/g, ' ');
}

function externalIdEntries(item) {
  const ids = item?.external_ids;
  if (!ids || typeof ids !== 'object') return [];
  return Object.entries(ids).flatMap(([provider, value]) => {
    const values = Array.isArray(value) ? value : [value];
    return values.flatMap((entry) => {
      if (entry && typeof entry === 'object') {
        return Object.entries(entry).map(([kind, id]) => [`${provider}-${kind}`, String(id)]);
      }
      return [[provider, String(entry)]];
    });
  });
}

function matchesProviderId(item, providerIds) {
  if (!providerIds) return false;
  return externalIdEntries(item).some(([provider, rawId]) => {
    const providerName = normalizeEasterEggTitle(provider).replace(/\s/g, '');
    return Object.entries(providerIds).some(([expectedProvider, ids]) => {
      if (!providerName.includes(expectedProvider)) return false;
      const candidates = normalizeEasterEggTitle(rawId).split(' ');
      return ids.some((id) => candidates.includes(String(id)));
    });
  });
}

function exactTitle(title) {
  const expected = normalizeEasterEggTitle(title);
  return (item) => normalizeEasterEggTitle(item?.title) === expected;
}

function exactTitles(titles) {
  const expected = new Set(titles.map(normalizeEasterEggTitle));
  return (item) => expected.has(normalizeEasterEggTitle(item?.title));
}

function titleIncludes(phrase) {
  const expected = normalizeEasterEggTitle(phrase);
  return (item) => {
    const title = normalizeEasterEggTitle(item?.title);
    return title === expected
      || title.startsWith(`${expected} `)
      || title.endsWith(` ${expected}`)
      || title.includes(` ${expected} `);
  };
}

function titleStartsWith(phrase) {
  const expected = normalizeEasterEggTitle(phrase);
  return (item) => {
    const title = normalizeEasterEggTitle(item?.title);
    return title === expected || title.startsWith(`${expected} `);
  };
}

const matchesStandaloneStarWarsTitle = exactTitles([
  'A New Hope',
  'The Empire Strikes Back',
  'Empire Strikes Back',
  'Return of the Jedi',
  'The Phantom Menace',
  'Attack of the Clones',
  'Revenge of the Sith',
  'The Force Awakens',
  'The Last Jedi',
  'The Rise of Skywalker',
  'Rogue One',
]);

const RULES = Object.freeze({
  everythingEverywhere: {
    providerIds: PROVIDER_IDS.everythingEverywhere,
    fallback: exactTitle('Everything Everywhere All at Once'),
  },
  fightClub: {
    providerIds: PROVIDER_IDS.fightClub,
    fallback: exactTitle('Fight Club'),
  },
  starWars: {
    providerIds: PROVIDER_IDS.starWars,
    fallback: (item) => titleIncludes('Star Wars')(item) || matchesStandaloneStarWarsTitle(item),
  },
  theRoom: {
    providerIds: PROVIDER_IDS.theRoom,
    fallback: exactTitle('The Room'),
  },
  lordOfTheRings: {
    providerIds: PROVIDER_IDS.lordOfTheRings,
    fallback: (item) => titleIncludes('The Lord of the Rings')(item) && !titleIncludes('The Hobbit')(item),
  },
  shrek: {
    providerIds: PROVIDER_IDS.shrek,
    fallback: exactTitle('Shrek'),
  },
  pokemon: {
    fallback: titleIncludes('Pokemon'),
  },
  theMatrix: {
    providerIds: PROVIDER_IDS.theMatrix,
    fallback: exactTitle('The Matrix'),
  },
  indianaJones: {
    fallback: titleIncludes('Indiana Jones'),
  },
  missionImpossible: {
    fallback: titleIncludes('Mission Impossible'),
  },
  saw: {
    fallback: titleStartsWith('Saw'),
  },
  forrestGump: {
    providerIds: PROVIDER_IDS.forrestGump,
    fallback: exactTitle('Forrest Gump'),
  },
  grandTheftAuto: {
    fallback: titleIncludes('Grand Theft Auto'),
  },
  legendOfZelda: {
    fallback: titleIncludes('Legend of Zelda'),
  },
  falloutNewVegas: {
    fallback: titleStartsWith('Fallout New Vegas'),
  },
  skyrim: {
    fallback: (item) => titleStartsWith('Skyrim')(item) || titleStartsWith('The Elder Scrolls V Skyrim')(item),
  },
  minecraft: {
    fallback: titleIncludes('Minecraft'),
  },
  terminator: {
    providerIds: PROVIDER_IDS.terminator,
    fallback: titleIncludes('Terminator'),
    accepts: (item) => item?.type === 'film',
  },
});

export const EASTER_EGG_RULES = RULES;

export function matchesEasterEgg(item, ruleName) {
  const rule = RULES[ruleName];
  if (!rule || (rule.accepts && !rule.accepts(item))) return false;
  return matchesProviderId(item, rule.providerIds) || rule.fallback(item);
}

export function drawerQuoteFor(item, { randomizer = false } = {}) {
  if (!randomizer) return null;
  if (matchesEasterEgg(item, 'starWars')) return 'A surprise to be sure, but a welcome one.';
  if (matchesEasterEgg(item, 'theRoom')) return 'Anyway, how is your sex life?';
  if (matchesEasterEgg(item, 'lordOfTheRings')) return 'You have my sword.';
  if (matchesEasterEgg(item, 'theMatrix')) return 'The choice has already been made.';
  if (matchesEasterEgg(item, 'indianaJones')) return 'It had to be this one.';
  if (matchesEasterEgg(item, 'missionImpossible')) return 'Your mission, should you choose to accept it…';
  if (matchesEasterEgg(item, 'saw')) return 'I want to watch a movie.';
  if (matchesEasterEgg(item, 'pokemon')) return 'I choose you!';
  if (matchesEasterEgg(item, 'forrestGump')) return 'You never know what you’re gonna get.';
  if (matchesEasterEgg(item, 'grandTheftAuto')) return 'Ah shit, here we go again.';
  if (matchesEasterEgg(item, 'legendOfZelda')) return 'It’s dangerous to go alone! Take this.';
  if (matchesEasterEgg(item, 'falloutNewVegas')) return 'The game was rigged from the start.';
  if (matchesEasterEgg(item, 'skyrim')) return 'Hey, you. You’re finally awake.';
  return null;
}

export function heartTransformationFor(item, currentUserId, people = item?.likes || []) {
  if (!currentUserId || !people.some((person) => person.id === currentUserId)) return null;
  if (matchesEasterEgg(item, 'fightClub')) return 'fight-club';
  if (matchesEasterEgg(item, 'everythingEverywhere')) return 'everything-everywhere';
  if (matchesEasterEgg(item, 'lordOfTheRings')) return 'one-ring';
  if (matchesEasterEgg(item, 'shrek')) return 'shrek';
  if (matchesEasterEgg(item, 'pokemon')) return 'pokemon';
  if (matchesEasterEgg(item, 'minecraft')) return 'minecraft';
  return null;
}

export function successfulBinToast(item, baseMessage = 'Media moved to Bin.') {
  return matchesEasterEgg(item, 'terminator') ? `${baseMessage} Hasta la vista.` : baseMessage;
}

export function isWatchlistShelf(shelf) {
  return Boolean(
    shelf
    && (shelf.showInMainWatchlist || normalizeEasterEggTitle(shelf.name).includes('watchlist')),
  );
}

export function buildEverythingEverywhereSequence(items, selectedItem, {
  reducedMotion = false,
  random = Math.random,
  flashCount = 6,
} = {}) {
  if (!selectedItem) return [];
  if (!matchesEasterEgg(selectedItem, 'everythingEverywhere') || reducedMotion) return [selectedItem];
  const candidates = (items || [])
    .filter((item) => ['film', 'television'].includes(item?.type))
    .filter((item) => item.item_id !== selectedItem.item_id);
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return [...shuffled.slice(0, flashCount), selectedItem];
}

export async function preloadRandomizerItems(items, ImageClass = globalThis.Image) {
  if (!ImageClass) return items;
  await Promise.all((items || []).map((item) => {
    if (!item?.poster_url) return Promise.resolve();
    return new Promise((resolve) => {
      const image = new ImageClass();
      image.onload = resolve;
      image.onerror = resolve;
      image.src = item.poster_url;
      if (image.complete) resolve();
    });
  }));
  return items;
}

export async function playDrawerSequence(items, selectItem, {
  delay = 115,
  wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  for (let index = 0; index < items.length; index += 1) {
    selectItem(items[index]);
    if (index < items.length - 1) await wait(delay);
  }
  return items.at(-1) || null;
}

function fightClubStorageKey(userId) {
  return `media-room:fight-club:${userId}`;
}

export function claimFightClubSequence({
  storage,
  userId,
  now = Date.now(),
  random = Math.random,
  chance = FIGHT_CLUB_CHANCE,
} = {}) {
  if (!storage || !userId) return false;
  const key = fightClubStorageKey(userId);
  let state = {};
  try { state = JSON.parse(storage.getItem(key) || '{}') || {}; } catch { state = {}; }
  if (state.lastShown && now - Number(state.lastShown) < FIGHT_CLUB_SHOWN_COOLDOWN_MS) return false;
  if (state.lastAttempt && now - Number(state.lastAttempt) < FIGHT_CLUB_ATTEMPT_COOLDOWN_MS) return false;
  const selected = random() < chance;
  try {
    storage.setItem(key, JSON.stringify({
      ...state,
      lastAttempt: now,
      ...(selected ? { lastShown: now } : {}),
    }));
  } catch {
    return false;
  }
  return selected;
}

export function createFightClubSequenceController({
  onDialogChange,
  schedule = setTimeout,
  cancelSchedule = clearTimeout,
} = {}) {
  let active = false;
  let currentStep = null;
  const timers = new Set();
  const later = (work, delay) => {
    const timer = schedule(() => {
      timers.delete(timer);
      work();
    }, delay);
    timers.add(timer);
  };
  return {
    trigger({ item, storage, userId, now, random, bypassCooldown = false } = {}) {
      if (
        active
        || !matchesEasterEgg(item, 'fightClub')
        || (!bypassCooldown && !claimFightClubSequence({ storage, userId, now, random }))
      ) return false;
      active = true;
      later(() => {
        currentStep = 0;
        onDialogChange?.({ step: 1, message: FIGHT_CLUB_MESSAGES[0] });
      }, 0);
      return true;
    },
    confirm() {
      if (!active || currentStep === null) return false;
      const confirmedStep = currentStep;
      currentStep = null;
      onDialogChange?.(null);
      if (confirmedStep === 0) {
        later(() => {
          currentStep = 1;
          onDialogChange?.({ step: 2, message: FIGHT_CLUB_MESSAGES[1] });
        }, 1000);
      } else {
        active = false;
      }
      return true;
    },
    cancel() {
      for (const timer of timers) cancelSchedule(timer);
      timers.clear();
      currentStep = null;
      active = false;
      onDialogChange?.(null);
    },
    isActive() {
      return active;
    },
  };
}

export async function persistThenScheduleEasterEgg(action, scheduleEasterEgg) {
  const result = await action();
  scheduleEasterEgg?.();
  return result;
}
