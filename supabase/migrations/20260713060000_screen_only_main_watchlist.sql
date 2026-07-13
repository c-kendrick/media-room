-- Main Watchlist mirrors Film & TV shelves only.

update public.shelves
set show_in_main_watchlist = false,
    main_watchlist_position = null
where section <> 'screen'
  and show_in_main_watchlist;

alter table public.shelves
  drop constraint if exists shelves_main_watchlist_screen_only;

alter table public.shelves
  add constraint shelves_main_watchlist_screen_only
  check (not show_in_main_watchlist or section = 'screen');
