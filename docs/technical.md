# How Bookmark Bindery works

This is the engineer's tour: how a file gets in, how it's checked, how edits, undo and duplicate review work, what's
stored, and how it gets back out. For what it does and how to use it, see the [README](../README.md).

- [One file, no build](#one-file-no-build)
- [Privacy by construction](#privacy-by-construction)
- [Opening a file](#opening-a-file)
- [The data model](#the-data-model)
- [The index](#the-index)
- [Views and rows](#views-and-rows)
- [Editing and undo](#editing-and-undo)
- [Duplicate review](#duplicate-review)
- [Removing query strings](#removing-query-strings)
- [Exporting](#exporting)
- [Saving in the browser](#saving-in-the-browser)
- [Rendering](#rendering)
- [Keyboard and pointer](#keyboard-and-pointer)
- [Numbers worth knowing](#numbers-worth-knowing)
- [Code map](#code-map)
- [Screenshots](#screenshots)

## One file, no build

`index.html` is the whole app: markup, styles and one script in an IIFE, with no framework, no dependencies and no
build step. The other files in the repo root are icons and the web app manifest. Any static host can serve it. On
Render it's a static site with publish directory `.`.

## Privacy by construction

The page's Content Security Policy is the guarantee, not a promise in the copy:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; img-src 'self' data: blob:; manifest-src 'self'; connect-src 'none';
form-action 'none'; base-uri 'none'
```

`connect-src 'none'` means the page can't make fetch, XHR, WebSocket or beacon requests at all. Images are limited to
the site itself and `data:`/`blob:` URLs, so favicons stored in a bookmarks file display, but nothing is loaded from the
sites you bookmarked. The only outside requests are the Google Fonts stylesheet and font files.

## Opening a file

Files arrive from the **Import** button (a hidden `<input type="file">`) or by dropping one anywhere on the page.
`importFile()` reads the text and `parseBookmarks()` decides whether to open it. Every refusal is a `FileProblem` with
a title and a plain explanation, shown in a dialog. Nothing already open is touched.

Checks on the raw text, before parsing:

| Problem | How it's spotted |
| --- | --- |
| Empty | Nothing but whitespace (and a BOM). |
| Binary or damaged | A NUL byte, or more replacement characters (`�`) than 8 or 0.5% of the text. |
| JSON backup | Starts with `{` or `[`. The message explains how to export HTML from Chrome, Edge or Firefox. |
| Not a bookmarks export | No `NETSCAPE-Bookmark-file-1` doctype, and no `<DL>` list with `<A>` or `<H3>` entries. |
| No bookmark list | The doctype is there but there's no `<DL>`. |
| Cut off | Fewer `</DL>` than `<DL>`: a folder never closes, so the file stopped partway through saving or copying. |
| Damaged structure | More `</DL>` than `<DL>`. |

Then `DOMParser` builds a document. `readDL()` and `readDT()` walk it into a tree, tolerating the format's quirks:
`<p>` wrappers, `<DD>` descriptions and lists nested in odd places. Finally the parse is **audited**: the number of
folders and links in the tree must match the number of `<H3>` and `<A>` tags in the text. If any entry fell outside
the structure, the file is refused rather than opened with bookmarks silently missing.

If the open file has edits that haven't been exported, opening another asks first.

## The data model

The library is a plain tree held in `S.root`:

```js
{ id, type: 'folder', title, attrs, children: [...], root?: true, desc? }
{ id, type: 'link',   title, url,   attrs,                       desc? }
```

`attrs` keeps **every attribute the browser wrote**, upper-cased: `ADD_DATE`, `LAST_MODIFIED`, `ICON`,
`PERSONAL_TOOLBAR_FOLDER` and anything else. That's how dates, favicons and the bookmarks-bar flag survive a round
trip. Ids are session-only (`n1`, `n2`…) and are reassigned when a saved library is restored.

All other app state (view, selection, cursor, clipboard, open folders, duplicate marks, settings) lives in one object,
`S`.

## The index

`reindex()` walks the tree after every change and rebuilds:

- `idx`: id → `{ node, parent, depth, ord, links, folders }`. `ord` is document order, used for sorting selections
  and duplicate groups. `links` and `folders` are totals for each folder, shown in the sidebar and rows.
- `dupeMaps`: three maps from a key to the ids that share it, keeping only keys with more than one id:
  - **url:** `normUrl()`. The host is lower-cased with `www.` dropped, the scheme ignored for http and https, and
    trailing slashes removed from the path. The query and fragment are kept. Non-web URLs are compared as written.
    Bookmarklets (`javascript:`) are never duplicates by address.
  - **name:** the title, NFKC-normalized, trimmed, with runs of spaces collapsed, lower-cased.
  - **both:** name and address together.
- `stats`: counts for the header, sidebar and duplicate tabs, plus the empty folders. A folder is empty if it contains
  no bookmarks at any depth.

## Views and rows

`S.view.kind` is one of `tree`, `folder`, `search`, `all`, `dupes` or `empty`. `buildRows()` turns the current view
into a flat array of rows, which is all the list renders:

- **tree:** depth-first, descending only into folders in `S.open`, with each row's depth for indentation.
- **folder:** the open folder's direct children.
- **search:** every item at any depth whose title plus address contains **all** the search words, ignoring case.
- **all:** every bookmark.
- **dupes:** a header row per group, in document order, followed by its copies.
- **empty:** the empty folders.

The tree and folder layouts are the two ways to browse. **T** switches between them, and the choice is remembered.

## Editing and undo

Every change goes through `mutate(label, fn)`:

1. Snapshot the tree with `cloneTree()`.
2. Run `fn`. Returning `false` cancels with no history entry.
3. Push `{ root: snapshot, label }` on the undo stack (capped at **200**) and clear redo.
4. `afterChange()`: reindex, rebuild rows, drop selections and marks for anything that no longer exists, fall back
   to the nearest surviving folder if the open one was deleted, render, and schedule a save.

Undo and redo swap whole trees, so every operation is undoable the same way and labels like "Undid grouping of 3
items" come for free. Snapshots copy only structure and strings, which is cheap even for libraries of thousands of
bookmarks.

Operations: rename (title, and address with Tab), new folder, move (drag and drop, cut and paste, or **Move to…**),
group into a new folder, sort a folder (name, newest, oldest, domain, with folders first), and delete. Deleting more than
one item, counting everything inside folders, asks first and lists what goes.

## Duplicate review

The **Duplicates** view groups copies by the chosen key (Address, Name or Both). Nothing is deleted while you review.
Each copy is marked **Keep** or **Delete** (`S.marks`), by clicking, by **K** and **D** on the selection, or in bulk:

- **Mark extras** keeps one copy per group and marks the rest. The keeper is the **oldest** copy (by `ADD_DATE`, with
  undated copies last), the **newest**, or the **first in your folders** (document order).
- Each group's menu keeps only its oldest or newest copy, or every copy.

**Review and delete** confirms, then deletes all marked copies in one `mutate`, so a single undo brings them back.

## Removing query strings

`splitQuery()` takes everything from `?` up to `#` (a fragment, if any, is kept). **Remove query string** shows the
before and after, warns that some sites need their query string, and applies it as an undoable edit.

## Exporting

`exportHTML()` writes a standard Netscape bookmarks file: the doctype and "DO NOT EDIT" comment browsers expect, a UTF-8
meta tag, then `<DL><p>` lists with four-space indentation. Every saved attribute and description is written back,
escaped. The file is named the way Chrome names exports, `bookmarks_<month>_<day>_<yy>.html`, and downloaded through a
`blob:` link. Inside Claude's artifact viewer, where downloads work differently, it uses the host's downloads API
instead. A successful export clears the "unsaved edits" state.

## Saving in the browser

- `bindery.session.v1` holds `{ v: 1, root, fileName, dirty }`, written 600 ms after the last change. If the JSON is
  over about 4.5 million characters, or the browser refuses (quota, private mode), nothing is saved and the sidebar
  says so.
- `bindery.ui.v1` holds settings: duplicate mode, layout, and **Remember my file**.
- With **Remember my file** off, the session key is deleted and never written. **Forget on this device** deletes it,
  closes the file and clears undo history.
- On load, `restore()` reopens the saved library with fresh ids and says so in a toast.
- If edits haven't been exported *and* couldn't be saved, closing the tab asks for confirmation.

Nothing is ever written anywhere but `localStorage`. The device note in the sidebar says when the file is saved, and
the README explains that browsers can keep traces in their own storage files until they're overwritten.

## Rendering

All rendering is string templates into `innerHTML`, with every piece of user content passed through `esc()`. Bookmark
icons come from the file's `ICON` data URLs when present, and otherwise are a letter on a color hashed from the host
name.

The list is **virtualized**: rows are a fixed 46 px, absolutely positioned inside a spacer as tall as the whole list,
and only the rows on screen plus six above and below are in the DOM. Scrolling re-renders that window, so a folder or
search with thousands of results stays smooth. A row being edited is kept in place across re-renders so typing isn't
interrupted.

Colors are CSS variables, with a dark palette under `prefers-color-scheme: dark` and overrides for `data-theme`. Layout
steps down at 1000 px (the folder path column goes), 820 px (the sidebar becomes a drawer) and 600 px (dates and inline
actions give way to the ⋯ menu). Animations stop for anyone who prefers reduced motion.

## Keyboard and pointer

Press **?** or open **Keyboard shortcuts** in the sidebar for the full list. Highlights:

- **↑ ↓** move, with Shift to extend the selection. **→ ←** open and close folders.
- **/** searches. **T** switches layout.
- **Enter** or **F2** renames. **N** makes a folder, **M** moves, **G** groups.
- Ctrl/⌘ + **X** and **V** cut and paste. **Del** deletes. Ctrl/⌘ + **Z** undoes, with Shift to redo.
- **K** and **D** keep or mark copies in duplicate review.

Drag and drop works within the list and onto the sidebar tree: drop onto a folder to move into it, or between rows to
reorder, with auto-scroll near the edges and hover-to-open on closed tree folders. A move into a folder's own subfolder
is refused. Alt-click on a folder's arrow opens or closes every folder inside it. Right-click opens every action for a
row.

## Numbers worth knowing

| What | Value |
| --- | --- |
| Row height | 46 px |
| Extra rows rendered above and below the screen | 6 |
| Undo history | 200 steps |
| Save delay after a change | 600 ms |
| Largest library saved in the browser | about 4.5 million characters of JSON |
| Layout breakpoints | 1000, 820 and 600 px |

## Code map

The script in `index.html` is in labelled sections, in this order:

```
icons                 inline SVG strings
state                 S, the index, undo and redo stacks, element handles
small helpers         URL and name normalization, dates, paths
parse & export        file checks, parsing, the audit, exportHTML
index                 reindex, empty folders
rows                  buildRows for each view
mutations & history   mutate, undo, redo, move, rename, group, sort, delete, cut and paste
views & selection     setView, tree layout, search, selection
duplicate review      modes, keeper rules, marks
rendering             rows, sidebar tree, header, empty states, selection tray
inline editing        rename in place
menus, dialogs        context menus, confirm, Move to…, shortcuts
toasts
import / export       importFile, showProblem, loadRoot, doExport
persistence           localStorage, Remember my file, Forget on this device
drag & drop           drop targets, reorder lines, autoscroll
pointer, keyboard     event wiring
boot                  restore or start blank
```

## Screenshots

`node scripts/screenshots.mjs` regenerates `docs/screenshots/`. It serves the repo locally, opens the made-up library
in `scripts/demo-bookmarks.html`, and captures the library, duplicate review and a phone view in light and dark with
Playwright, saving WebP. It needs Node and Playwright with Chromium, and nothing else.
