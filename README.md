# Bookmark Bindery

A single-page editor for browser bookmark exports (the `bookmarks_*.html` file Chrome, Edge, Firefox and Safari produce).

- Browse the whole library as an expandable tree or one folder at a time
- Rename, edit addresses, move (drag and drop, cut and paste, Move to…), group and delete, with undo
- Find duplicates by address, name or both, and choose which copies to keep
- Remove query strings from addresses
- Export a Netscape-format bookmarks file that Chrome's Bookmark Manager can import

Everything runs in the browser. The page makes no network requests apart from loading Google Fonts, and its Content Security Policy blocks any other connection. Your library is kept only in this browser's local storage.

## Hosting

`index.html` is the whole app. On Render it is served as a static site with no build step (publish directory `.`).
