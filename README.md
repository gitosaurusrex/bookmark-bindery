# Bookmark Bindery

**Tidy years of bookmarks in minutes, without them ever leaving your computer.**

Open the bookmarks file your browser exports, see every folder and link at once, clear out duplicates, reorganize with
drag and drop, and export a clean file that Chrome imports straight back. No account, no upload, nothing to install.

**[Open Bookmark Bindery →](https://bookmark-bindery.onrender.com)**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
![No dependencies](https://img.shields.io/badge/dependencies-none-5cb85c)
![Runs in your browser](https://img.shields.io/badge/runs-in%20your%20browser-6f42c1)

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/library-dark.webp">
  <img src="docs/screenshots/library-light.webp" alt="Bookmark Bindery showing a bookmarks library as an expandable tree, with two bookmarks selected and a tray offering Move to, Group, Cut and Delete">
</picture>

## Why Bookmark Bindery

- **See everything.** Browse the whole library as one expandable tree, or one folder at a time. Search titles and
  addresses across every folder as you type, filter the folder list by name, and expand or collapse every folder at
  once.
- **Clear out duplicates safely.** Find copies by address, name or both. Choose which to keep, one by one or with "keep
  the oldest in each group", and check before anything is deleted.
- **Reorganize fast.** Drag and drop, cut and paste, **Move to…**, group a selection into a new folder, sort by name,
  date or site. Or turn on **Keep everything A to Z**: every folder lists its subfolders first, then its bookmarks,
  each A to Z, stays that way as you edit, and exports in that order. There are keyboard shortcuts for all of it.
- **Undo anything.** Every change can be undone, up to 200 steps back.
- **Refuses broken files.** Before opening a file, Bindery checks that it's complete. A file that's cut off, damaged,
  binary, a JSON backup or not a bookmarks export is turned away with a reason, instead of opening with bookmarks quietly
  missing.
- **Private by design.** Everything happens in your browser. The page's security policy blocks it from connecting
  anywhere except Google Fonts (and Bindery Assist, below, when a site sets it up), so your bookmarks can't be sent
  anywhere else.
- **Optional AI help.** Bindery Assist can tidy a cluttered folder into named folders, suggest folder names and clean
  up bookmark titles. It's off until you turn it on, sends only the bookmarks an action is for, and shows every
  suggestion for review before anything changes.
- **Round-trips cleanly.** Exports keep each bookmark's dates, icon and descriptions, and the bookmarks bar stays the
  bookmarks bar.

<table>
  <tr>
    <td width="68%"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/duplicates-dark.webp">
  <img src="docs/screenshots/duplicates-light.webp" alt="Duplicate review: copies grouped by address, each with Keep and Delete buttons and the folder it lives in">
</picture></td>
    <td width="32%"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/screenshots/phone-dark.webp">
  <img src="docs/screenshots/phone-light.webp" alt="Bookmark Bindery on a phone">
</picture></td>
  </tr>
</table>

## How to use it

1. **Export your bookmarks.** In Chrome or Edge, open the Bookmark Manager (Ctrl+Shift+O, or ⌘+Option+B on a Mac),
   click ⋮ and choose **Export bookmarks**. In Firefox, open the Library and choose **Export Bookmarks to HTML**. In
   Safari, choose **File → Export → Bookmarks**.
2. **Open the file** in [Bookmark Bindery](https://bookmark-bindery.onrender.com): click **Import**, or drop it onto
   the page.
3. **Tidy up.** Rename, move, group and delete. Check **Duplicates** and **Empty folders** under **Inspect**. Press
   **?** for every keyboard shortcut.
4. **Export** a new file, then import it in your browser's bookmark manager. In Chrome: Bookmark Manager → ⋮ →
   **Import bookmarks**.

Everything Bindery can do:

- Checks each file before opening it, and refuses files that are cut off, damaged, binary, JSON backups or not bookmark
  exports, saying why
- Browse the whole library as an expandable tree or one folder at a time
- Filter the sidebar's folder list by name (**F**), and expand or collapse all its folders at once
- Keep every folder A to Z, folders first, in the app and in the exported file
- Rename, edit addresses, move (drag and drop, cut and paste, Move to…), group and delete, with undo
- Find duplicates by address, name or both, and choose which copies to keep
- Remove query strings from addresses
- Export a Netscape-format bookmarks file that Chrome's Bookmark Manager can import
- Optional AI help (Bindery Assist): tidy into folders, suggest folder names, clean up titles

## Your bookmarks stay on your computer

Everything runs in the browser. The page makes no network requests apart from loading Google Fonts, and its Content
Security Policy blocks any other connection. The one exception is Bindery Assist, which is off until you turn it on.
Your library is kept only in this browser's local storage, so it reopens on your next visit.

Under **This device** in the sidebar:

- **Remember my file** (on by default): turn it off and Bindery deletes its saved copy and saves nothing until you turn
  it back on. Your file then lasts only as long as the tab.
- **Forget on this device**: deletes the saved copy, closes your file and clears undo history. Files on your computer
  aren't touched.

Your browser may keep traces in its own storage files after a delete until they're overwritten. To clear those as well,
delete the site's data in your browser settings.

## Bindery Assist (optional AI)

Click ✦ in the top bar, or pick an AI action from a right-click menu. The first time, a short welcome sheet explains
each feature and what gets sent. Nothing is sent unless you choose **Turn on Bindery Assist**.

- **Tidy into folders** (a folder's menu): suggests folders for the bookmarks in a cluttered folder, reusing
  subfolders it already has, then opens a review of the whole plan. Every bookmark is listed under the folder it would
  go to. Rename any suggested folder by clicking its name, set single bookmarks to **Move** or **Stay**, or drag them
  (or select them and press **M**) to a different folder. Nothing changes until **Apply**, which is one undo step. You
  can leave the review and come back to it from **Tidy plan** in the sidebar. Large folders are sent in batches of 150,
  up to 750 bookmarks.
- **Suggest a name**: while you rename a folder, including the new one **Group** makes, tap **Suggest names** under
  the name field and then tap a suggestion. Also in a folder's menu.
- **Clean up titles** (a bookmark's menu, a selection, or a whole folder from ✦): shortens titles stuffed with site
  names, “(3)” counts and SEO filler. You choose which to accept.

What's sent: for the bookmarks an action is for, their titles and their addresses cut down to site and path (nothing
after “?” or “#”, nothing for bookmarklets or local files). It goes to a small Cloudflare Worker that asks a Workers AI
model and doesn't store anything. Turn Assist off any time from ✦ → **Turn off Bindery Assist**.

Assist needs a deployed Worker. A copy of Bindery without one shows no AI features at all, and its security policy
still blocks every connection. To set one up, see [worker/README.md](worker/README.md).

## Hosting your own

`index.html` is the whole app, so any static host works: Render, GitHub Pages, Netlify or a plain web server. On Render
it's served as a static site with no build step (publish directory `.`).

## Under the hood (TL;DR)

- One HTML file with vanilla JavaScript and CSS. No framework, no dependencies, no build.
- Files are checked as raw text first, then parsed with the browser's `DOMParser`. Afterwards, the number of folders
  and bookmarks found is compared with the tags in the file, so nothing can go missing silently.
- Every edit snapshots the tree first, which is what makes everything undoable.
- Duplicates are matched on normalized addresses (http/https, `www.` and trailing slashes ignored), names, or both.
- The list only renders the rows on screen, so libraries with thousands of bookmarks stay fast.
- `localStorage` holds your library between visits, and only if you allow it.

For the full tour (file checks, the data model, undo, duplicate rules, export format, storage, rendering and a code
map) read **[docs/technical.md](docs/technical.md)**.

## License

[MIT](LICENSE). Use it, change it, host your own copy, share it. Just keep the copyright notice.
