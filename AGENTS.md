# Critical Rules

1. Implement the requested changes, then create a new draft pull request for me to review and merge manually. After providing a draft PR, assume it has been merged before any later request. For every later feature or fix, update the default branch, create a new branch, and open a new draft PR. Do not check the previous PR’s merge status, reuse its branch, push additional commits to it, or continue working from it unless I explicitly state that it has not been merged or ask you to add more work to that PR.
2. GitHub authentication is expected to already work. Do not ask me to authenticate because gh auth status, a credential-helper lookup, keyring access, or another preliminary authentication check fails. Those failures are not evidence that publishing is unavailable. When the task requires publishing, attempt the actual configured Git push and PR-creation workflow first. Only ask me to authenticate if the required push or PR operation itself fails with a genuine authentication or permission error after using the repository’s existing configured access.

## Implementation

* Add database changes only when required.
* Use optimistic UI when practical and safe, with rollback or recovery when a request fails or the server rejects the change.
* Follow the project’s existing architecture, conventions, components, and visual design. Inspect and reuse established UI patterns before creating new ones. New UI must look intentionally designed: clean, attractive, responsive where relevant, and visually consistent with the brown-walnut, office-desk theme. Do not introduce generic default boxes, unstyled browser controls, arbitrary SaaS-style panels, or components that look disconnected from the rest of Media Room.
* Where it suits the interaction, reuse the project’s existing **accent bar** pattern, such as the bars used for requests to move an item out of a watchlist or remove a Priority Stamp. An accent bar is a short horizontal decorative area containing dots, with the ordinary message content displayed separately beneath it. Do not place text on the accent bar because it reduces readability.

## Commands for Me

When I must run PowerShell commands, provide one self-contained, copyable command block that works from a newly opened PowerShell window.

Assume that the window:

* is not currently in the repository directory;
* has no project tooling running;
* may not expose stored GitHub or Supabase credentials through the keyring, even though authentication is likely already valid.

Include the correct repository `cd` command, authentication checks, and every prerequisite command required to reach the necessary state. Do not omit setup commands merely because they appeared in an earlier message.

## Completion

Before finishing:

* implement the requested changes and run the relevant verification, including `npm test`, `npm run build`, and `git diff --check`;
* for user-facing changes, perform targeted browser verification at relevant desktop and mobile widths when browser tooling is available, and clearly state when it is unavailable;
* create a new draft pull request;
* provide the draft PR link;
* provide a concise but complete summary of the implemented changes and verification performed;
* identify any known limitations, unresolved issues, unavailable verification, or manual steps remaining;
* when manual Supabase SQL is required, link to the SQL and clearly explain when it must be executed.

Do not mention manual SQL when none is required.

Do not merge the pull request, deploy the site, apply production Supabase migrations, or make any other production changes unless I explicitly request it.

## Glossary

* **Collection:** A user’s complete Media Room, containing libraries.
* **Library:** Contains shelves and media items. It is either a protected default library or a custom library.
* **Protected library:** Film & TV, Books, or Video Games. It retains system protections and cannot be permanently removed like a custom library.
* **Custom library:** A user-created library with a library type and optional custom terminology.
* **Library type:** The compatibility category assigned to a library: Film & TV (`screen`), Books (`book`), Video Games (`game`), or Other (`other`). It determines compatible content and available metadata or enrichment features.
* **Media type:** The type assigned to an individual item: film, television, book, game, or other. Do not confuse media type with the broader library type.
* **Custom terminology:** A library’s configurable singular item, plural item, and creator terms.
* **Shelf:** An ordered group of media items belonging to one library.
* **Protected shelf:** A system shelf with additional restrictions. The default Watchlist is undeletable and cannot be moved.
* **Main Watchlist:** A Club-specific aggregate page rather than a normal shelf or library. It displays the Topmost Watchlist followed by Club members’ mirrored watchlists.
* **Topmost Watchlist:** Aggregates qualifying items from Club members’ included watchlists according to the applicable Priority Stamp, Virtual Stamp, and Interest rules.
* **Interest:** The number of distinct Club members contributing a Priority Stamp or Virtual Stamp to an item. Each member can contribute no more than one point of Interest to the same item, even when both stamp types apply.
* **Virtual Stamp:** An automatically derived priority marker attributed to each relevant Club member when the same item appears in the included watchlists of more than one member of that Club.
* **Priority Stamp:** A user’s explicit priority marker. A Priority Stamp contributes to Interest but does not add another point when the same user already contributes a Virtual Stamp. Ordinary Likes do not contribute to Interest.
* **Included watchlist:** An eligible Film & TV shelf whose owner has enabled **Include this in Main Watchlist**. It remains the owner’s original shelf rather than becoming a separate Main Watchlist shelf.
* **Mirrored watchlist:** The read-only Club-page representation of an included watchlist. It remains associated with the original shelf and its owner.
* **Watchlist request:** A persistent request asking another user to retain or remove a Priority Stamp, or move a watched item out of a watchlist. It does not directly modify the other user’s data.
* **Move shelf:** Transfers an existing shelf into another compatible library in the same collection without creating a duplicate.
* **Copy shelf:** Creates an independent duplicate in a compatible library. Cross-user copies exclude private or user-specific state, including notes, ratings, ownership, reactions, requests, and Main Watchlist inclusion.
* **Collection owner:** The user who owns and may manage the collection.
* **Collection visitor:** Someone viewing a collection they do not own. The collection is read-only except for explicitly permitted actions such as reactions or copying a shelf.
* **Secure link:** A long, unguessable, independently revocable link providing a sanitised, read-only collection view.
* **Short link / Open account:** The stable `/u/username` read-only link. It works only while the owner has explicitly set the account to Open.
* **Static fallback:** The read-only `media-data.json` collection used when Supabase or required migrations are unavailable. Authenticated database mutations do not work in this mode.
