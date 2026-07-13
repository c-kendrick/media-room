alter table public.collections
  add column if not exists book_description text not null default 'Books! (You can edit this)',
  add column if not exists game_description text not null default 'Video Games goes brrr. (You can edit this)';

alter table public.collections
  alter column description set default $note$You can edit this to say whatever you like. It will also be put in the Main Watchlist. The intention is to allow you to emphasise what movies you really want to watch.

You can also priority stamp each movie by clicking it to open the movie. You can place whatever shelf you want in the Main Watchlist.$note$;

update public.collections
set description = $note$You can edit this to say whatever you like. It will also be put in the Main Watchlist. The intention is to allow you to emphasise what movies you really want to watch.

You can also priority stamp each movie by clicking it to open the movie. You can place whatever shelf you want in the Main Watchlist.$note$
where description is null
   or btrim(description) = ''
   or description = 'A living collection of films, television, books and games.';

update public.collections
set book_description = 'Books! (You can edit this)'
where btrim(book_description) = '';

update public.collections
set game_description = 'Video Games goes brrr. (You can edit this)'
where btrim(game_description) = '';
