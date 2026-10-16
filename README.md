# Bookmark Bindery

A single-page editor for browser bookmark exports (the `bookmarks_*.html` file Chrome, Edge, Firefox and Safari produce). It starts empty: import a file, or drop one onto the page.

- Checks each file before opening it, and refuses files that are cut off, damaged, binary, JSON backups or not bookmark exports, saying why
- Browse the whole library as an expandable tree or one folder at a time
- Rename, edit addresses, move (drag and drop, cut and paste, Move to…), group and delete, with undo
- Find duplicates by address, name or both, and choose which copies to keep
- Remove query strings from addresses
- Export a Netscape-format bookmarks file that Chrome's Bookmark Manager can import

Everything runs in the browser. The page makes no network requests apart from loading Google Fonts, and its Content Security Policy blocks any other connection. Your library is kept only in this browser's local storage, so it reopens on your next visit.

Under **This device** in the sidebar:

- **Remember my file** (on by default): turn it off and Bindery deletes its saved copy and saves nothing until you turn it back on. Your file then lasts only as long as the tab.
- **Forget on this device**: deletes the saved copy, closes your file and clears undo history. Files on your computer aren't touched.

Your browser may keep traces in its own storage files after a delete until they're overwritten. To clear those as well, delete the site's data in your browser settings.

## Hosting

`index.html` is the whole app. On Render it is served as a static site with no build step (publish directory `.`).
