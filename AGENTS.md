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

## Glossary:
1. Topmost (Club) Watchlist: the watchlist shelf that is found in the club or main watchlist at the very top that aggregates from the club-included (mirrored) watchlists
2. Mirrored watchlist: a shelf in a user's collection with the toggle "Include this in Main Watchlist" - this is then mirrored and placed in their club main watchlist underneath the topmost club watchlist. 
