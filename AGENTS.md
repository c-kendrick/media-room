Three most important rules:
1. Implement the requested changes, then create a new draft pull request for me to review and merge manually. After you send me a draft PR to merge, assume I have merged it if I ask for more features and work on a new draft PR.
2. GitHub authentication may already be valid even if the sandbox cannot access the stored keyring credentials. Check for that possibility before asking me to log in with powershell commands. If authentication is genuinely unavailable, give me the exact commands needed to authenticate.
3. Follow the existing architecture, conventions, and visual design of the project. New UI should be clean, attractive, consistent with existing components, and responsive where relevant. We use a brown-walnut, office-desk type theme.
 
## Implementation standards

For user-triggered mutations, use optimistic UI where practical. Include rollback or recovery behaviour when the server rejects the change or the request fails.

Do not add database changes unless they are necessary for the requested feature.

## Commands requiring my input

When asking me to run a PowerShell command, assume I am starting from a newly opened PowerShell window that:

1. Is not in the repository directory.
2. Is not authenticated with GitHub or Supabase.
3. Has no project tooling currently running.

Provide the correct `cd` command and every prerequisite command needed to reach the required state. Do not omit earlier setup commands because they appeared in a previous message.

## Completion requirements

Before finishing:

1. Implement and verify the requested changes.
2. Create a draft pull request.
3. Send me the draft pull request link.
4. Provide a comprehensive but readable list of the features and changes implemented.
5. If Supabase SQL must be run manually, provide a link to the SQL and clearly explain when it should be executed.
6. If no manual SQL is required, there's no need to state either way.
7. Mention any known limitations, unresolved issues, or steps I still need to perform.

## Glossary
* **Collection:** A user’s overall Media Room collection. A collection contains libraries, which contain shelves and media items.
* **Library:** A subdivision within a collection that contains its own shelves and media items. Examples include Film & TV, Books, Video Games, and user-created libraries.
* **Protected library:** One of the system-created default libraries: Film & TV, Books, or Video Games. Protected libraries must retain their special status and cannot be permanently removed like ordinary custom libraries.
* **Custom library:** A user-created library. It has a library type and may use custom terminology for its items and creators.
* **Library type:** The compatibility category assigned to a library: Film & TV (`screen`), Books (`book`), Video Games (`game`), or Other (`other`). The type determines which media items and shelves are compatible with the library and which metadata or enrichment features are available.
* **Media type:** The type assigned to an individual media item: film, television, book, game, or other. Do not confuse an item’s media type with its containing library’s broader library type.
* **Custom terminology:** A library’s configurable singular item term, plural item term, and creator term. For example, a library may use “Album”, “Albums”, and “Artist” instead of the default “Item”, “Items”, and “Creator”.
* **Shelf:** An ordered group of media items inside one library. A shelf belongs to exactly one library, although it may be moved or copied into another compatible library where permitted.
* **Protected shelf:** A system shelf with restrictions that ordinary shelves do not have. For example, the default Watchlist must remain undeletable and must not be offered as a movable shelf.
* **Main Watchlist:** The Club-specific aggregate watchlist page. It is not a normal library or shelf. It contains the selected Club’s Topmost Watchlist followed by mirrored watchlists contributed by Club members.
* **Topmost (Club) Watchlist:** The first shelf displayed on a Club’s Main Watchlist. It aggregates qualifying media from the Club members’ included watchlists and Priority Stamps.
* **Included watchlist:** A Film & TV watchlist shelf for which the owner has enabled **Include this in Main Watchlist**. This is the original shelf in the owner’s collection.
* **Mirrored watchlist:** The read-only representation of an included watchlist displayed on the Club’s Main Watchlist beneath the Topmost Watchlist. It remains associated with the original shelf and its owner.
* **Priority Stamp:** A user’s explicit priority marker on a media title. Priority Stamps can contribute to Club Main Watchlist and Topmost Watchlist calculations; ordinary Likes do not.
* **Watchlist request:** A persistent request sent to another user asking them either to remove or retain a Priority Stamp, or to move a watched item out of a watchlist. A request does not directly modify the other user’s data.
* **Move shelf:** Transfer the existing shelf into another compatible library in the same collection. Moving does not create a duplicate.
* **Copy shelf:** Create an independent duplicate of a shelf in a compatible destination library. Copies from another user must exclude private or user-specific state such as notes, ratings, ownership, reactions, requests, and Main Watchlist inclusion.
* **Collection owner:** The user who owns the collection and may manage its libraries, shelves, and media.
* **Collection visitor:** A person viewing a collection they do not own. The collection remains read-only except for actions explicitly available to visitors, such as permitted reactions or copying a shelf into their own collection.
* **Secure link:** A long, unguessable, independently revocable link that provides a sanitized, read-only view of a collection.
* **Short link / Open account:** The stable `/u/username` read-only collection link. It works only while the owner has explicitly set their account to Open; closing the account disables the URL without changing it.
* **Static fallback:** The read-only `media-data.json` version of the collection used when Supabase is unavailable or the required database migrations have not been applied. Features requiring authenticated database mutations are unavailable in this mode.

