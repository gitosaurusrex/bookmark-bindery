# How Bookmark Bindery works

This is the engineer's tour: how a file gets in, how it's checked, how edits, undo and duplicate review work, how tags,
separators and browser-specific exports work, how the optional AI help talks to its Worker, what's stored, and how it
gets back out. For what it does and how to use it, see
the [README](../README.md).

- [One file, no build](#one-file-no-build)
- [Privacy by construction](#privacy-by-construction)
- [Opening a file](#opening-a-file)
- [The data model](#the-data-model)
- [The index](#the-index)
- [Views and rows](#views-and-rows)
- [Editing and undo](#editing-and-undo)
- [Duplicate review](#duplicate-review)
- [Removing query strings](#removing-query-strings)
- [The details panel](#the-details-panel)
- [Tags](#tags)
- [Separators](#separators)
- [Firefox and other browsers](#firefox-and-other-browsers)
- [Bindery Assist](#bindery-assist)
- [Exporting](#exporting)
- [Saving in the browser](#saving-in-the-browser)
- [Rendering](#rendering)
- [Keyboard and pointer](#keyboard-and-pointer)
- [Numbers worth knowing](#numbers-worth-knowing)
- [Code map](#code-map)
- [Worker](#worker)
- [Screenshots](#screenshots)

## One file, no build

`index.html` is the whole app: markup, styles and one script in an IIFE, with no framework, no dependencies and no
build step. The other files in the repo root are icons and the web app manifest. Any static host can serve it. On
Render it's a static site with publish directory `.`.

## Privacy by construction

The page's Content Security Policy is the guarantee, not a promise in the copy:

```
default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline' https://fonts.googleapis.com;
font-src https://fonts.gstatic.com; img-src 'self' data: blob:; manifest-src 'self';
connect-src https://bookmark-bindery-ai.azureus.workers.dev; form-action 'none'; base-uri 'none'
```

`connect-src` names one origin, the [Bindery Assist](#bindery-assist) Worker, so fetch, XHR, WebSocket and beacon
requests to anywhere else are blocked. The page only calls it after the person turns Assist on and picks an action.
`scripts/set-ai-endpoint.mjs` sets that origin, and `off` puts back `connect-src 'none'`, after which the page can't
make requests at all. Images are limited to the site itself and `data:`/`blob:` URLs, so favicons stored in a
bookmarks file display, but nothing is loaded from the sites you bookmarked. Icons for new bookmarks arrive as `data:`
URLs from the Worker. Apart from the Worker, the only outside requests are the Google Fonts stylesheet and font files.

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
`<p>` wrappers, `<DD>` descriptions, lists nested in odd places, and `<HR>` separators wherever the parser puts them
(see [Separators](#separators)). Finally the parse is **audited**: the number of folders and links in the tree must
match the number of `<H3>` and `<A>` tags in the text. If any entry fell outside the structure, the file is refused
rather than opened with bookmarks silently missing. Separators aren't counted as links, so they can't hide a missing
bookmark.

After opening, `detectSource()` guesses whether the file came from Firefox, and `firefoxNotice()` says once what
Firefox-only content it has (see [Firefox and other browsers](#firefox-and-other-browsers)).

If the open file has edits that haven't been exported, opening another asks first.

## The data model

The library is a plain tree held in `S.root`:

```js
{ id, type: 'folder', title, attrs, children: [...], root?: true, desc? }
{ id, type: 'link',   title, url,   attrs,                       desc? }
{ id, type: 'sep',    title: '',    attrs }
```

`attrs` keeps **every attribute the browser wrote**, upper-cased: `ADD_DATE`, `LAST_MODIFIED`, `ICON`,
`PERSONAL_TOOLBAR_FOLDER` and anything else, such as Firefox's `TAGS` (comma-separated tags), `SHORTCUTURL` (keyword)
and `UNFILED_BOOKMARKS_FOLDER`. That's how dates, favicons, tags, keywords and the bookmarks-bar flag survive a round
trip. `desc` is the `<DD>` description, shown as a note. `attrs` objects are shared with undo snapshots, so they're
always replaced, never changed in place (`setAttr()`). Ids are session-only (`n1`, `n2`…) and are reassigned when a
saved library is restored.

All other app state (view, selection, cursor, clipboard, open folders, duplicate marks, settings, the folder filter,
Assist consent, any Tidy plan, tag view state, and the file's source and export choice) lives in one object, `S`.

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
- `tagIdx`: tag key (lower-cased) → `{ name, ids, spell }`. `ids` are the tagged bookmarks in document order, `spell`
  counts each spelling, and `name` is the most used spelling.
- `stats`: counts for the header, sidebar and duplicate tabs, plus the empty folders, tags (`tags`, `tagged`) and
  separators (`seps`). A folder is empty if it contains no bookmarks at any depth. Separators are never counted as
  bookmarks.

## Views and rows

`S.view.kind` is one of `tree`, `folder`, `search`, `all`, `dupes`, `empty`, `tags`, `tag` or `tidy`. `buildRows()`
turns the current view into a flat array of rows, which is all the list renders:

- **tree:** depth-first, descending only into folders in `S.open`, with each row's depth for indentation.
- **folder:** the open folder's direct children.
- **search:** every item at any depth whose title, address and tags contain **all** the search words, ignoring case.
  A word starting with `#` instead has to be the start of one of the item's tags.
- **all:** every bookmark.
- **dupes:** a header row per group, in document order, followed by its copies.
- **empty:** the empty folders.
- **tags:** the look-alike groups, then every tag (see [Tags](#tags)).
- **tag:** the bookmarks with one tag (`S.view.key`), in document order.
- **tidy:** a header row per suggested folder, then its bookmarks, then the bookmarks that stay (see
  [Tidy review](#tidy-review)).

The exported order is the stored order, so it always matches the **tree** and **folder** views. The other views group
or filter items their own way.

The tree and folder layouts are the two ways to browse. **T** switches between them, and the choice is remembered.

The sidebar's folder list has its own open folders (`S.expanded`), separate from the tree layout's (`S.open`). Its
header holds three tools that appear when the pointer is over the sidebar (always, on touch screens): **Filter**,
**Expand all** and **Collapse all**. The filter (also **F**) slides open a box above the list. While it holds text,
`renderTree()` shows every folder whose name contains all the words, plus the folders they sit in (dimmed) so each
match keeps its place, all open and with matches highlighted. Enter opens the first match, Esc clears the box and then
closes it, and it closes by itself when it loses focus empty. Expand all and Collapse all close the filter first.

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

Operations: rename (title, and address with Tab), editing in the [details panel](#the-details-panel), new folder,
new bookmark, new separator, move (drag and drop, cut and paste, or **Move to…**), group into a new folder, sort a
folder once (name, newest, oldest, domain, with folders first, section by section), every [tag](#tags) operation, and
delete. Deleting more than one item, counting everything inside folders, asks first and lists what goes.

**Keep everything A to Z** (`S.autoSort`, in the Sort menu) rewrites the tree itself, so the export is sorted too.
`azOrder` puts the bookmarks bar first, then folders, then bookmarks, each compared by name with an `Intl.Collator`
(case-insensitive, numbers in numeric order). `bySections()` applies it between separators, which stay put. While it's
on, `mutate()` runs `sortAll()` after every change, inside the same undo step, so new, renamed, grouped and moved items
land in place. `moveItems()` sorts the affected folders before its "did anything change?" check, so a by-hand reorder is
a no-op with a toast explaining why. Turning it on is always an undo step flagged `autoSortOn`, even when nothing needs
to move (then the file isn't marked edited). Undoing that step turns the setting off and redoing it turns it back on, so
whenever the setting is on, the tree is sorted, and undoing never shows an older, unsorted order while it's on. A file
opened while it's on is sorted as its first undo step, and the one-off sorts are hidden from the Sort menu.

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

## The details panel

The editor is one panel, `#insp`, rendered by `renderInspector()` from `S.insp`:

- `null`: closed.
- `{ mode: 'edit', for }`: shows the single selected bookmark or folder. `renderSelbar()` calls `renderInspector()`, so
  the panel follows the selection. With several items selected (`many`) it edits their tags together, through
`fillMany()`: tags on all of them are solid chips with ×; tags on some are dashed with a count and a **+** that adds
them to the rest; the input adds to all. It also offers Move to…, Group and Delete. A separator shows a short
explanation and Delete. With nothing
  selected it says so and offers New bookmark. After an edit made in the panel (`sticky`), it stays on the item even
  if the edit moved it out of the list, until something else is selected.
- `{ mode: 'new', st }`: the New bookmark form, kept in `st` until **Add bookmark**. Then the panel switches to edit
  mode on the new bookmark.

It docks as a third grid column above 1180 px (`.app.insp-open`), slides in over the list below that, and is a bottom
sheet under 600 px. **E**, double-clicking a bookmark, the row's pencil and **Edit details…** in a menu open it. Inline
renaming (**Enter**/**F2**) is unchanged. **+ Add** in the header (`addMenu()`) offers New bookmark (**B**), New folder
(**N**) and Separator. The panel closes when switching to Tags, and on screens 820 px wide or less when switching views.

**Rendering without losing your place.** The panel's structure is rebuilt only when its key changes: mode, item, type,
and which optional fields show. Otherwise `fillInspector()` updates values in place and skips the field you're typing
in. All listeners are delegated on `#insp`, so rebuilding needs no rebinding. Removing a tag happens on pointerdown (and
cancels it) so the tag input keeps focus.

**Saving.** Each field saves on `change` (leaving it, or Enter; Ctrl/⌘+Enter for the note) through `commitField()`,
each change one `mutate()`: name and address through `renameNode()`, keyword (`SHORTCUTURL`), note (`desc`), tags
(`TAGS`, comma-separated as Firefox writes them), and the folder picker through `moveItems()`. Esc in a field puts its
value back. **Attributes are replaced, never changed in place** (`setAttr()`): `cloneTree()` shares `attrs` objects
with undo snapshots, so changing one in place would also change history.

**Fields.** Name, address (bookmarks) and folder ("Inside" for folders) always show. Tags, keyword and note show when
they have a value, or after **+ Tags**, **+ Keyword** or **+ Note**. Folders only get a note. Tags are trimmed, can't
contain commas, are de-duplicated ignoring case, and suggest from every tag in the library (`allTags()`).
`keywordOwner()` warns when another bookmark has the same keyword, and keywords can't contain spaces. The footer has
Delete. Under the fields: added and changed dates, a folder's contents, and "Also saved in…" when another bookmark has
the same address (`otherCopy()`).

**Folder picker.** A searchable list of every folder (`folderList()`, `folderPath()`). It opens on the current folder,
and for a folder it disables the folder itself and everything inside it.

**New bookmark.** It needs an open, non-empty file, and starts in the folder being viewed, the tree cursor's folder,
or the bookmarks bar.

- `normalizeAddress()` adds `https://` to bare addresses like `example.com/x` and refuses anything that isn't an
  address. Bookmarklets (`javascript:`) are accepted as they are.
- `savedCopy()` warns, without blocking, when the address is already saved (compared with `normUrl()`).
- With Assist on, the address goes to the Worker's `page` endpoint 550 ms after typing stops, or on blur. The page
  can't read other sites itself: its CSP allows no other connections, and most sites forbid cross-site reads anyway.
  The returned name only fills the field if the person hasn't typed one; otherwise it's offered as a link. The icon is
  kept as the bookmark's `ICON` data URL, like browser exports do, and a broken image falls back to the letter tile.
- **Suggest a folder** sends the name and trimmed address with up to 400 folder paths to `place`. The list is built when
  the chip is tapped, so new folders are included. It's in document order with the root left out, and only names are
  sent. Up to three folder chips come back, and the first is selected.
- If Assist isn't on, the panel offers to turn it on and then reads the page. With no Worker configured, it works
  without any of this.
- `addBookmark()` is one `mutate()` that appends to the folder, so it respects A to Z order and can be undone. The new
  bookmark is shown and selected.

**Write a note.** Next to a bookmark's note, **Write one** (or **Rewrite**) sends its full address and name to the
Worker's `describe` endpoint and saves the answer as the note. That's one undo step in edit mode, or fills the field
in new mode.

## Tags

Tags are kept where Firefox keeps them, in each bookmark's `TAGS` attribute, and indexed by `reindex()` as `tagIdx`.
Every change goes through `retag(ids, label, fn)`, one `mutate()` that gives each bookmark `fn(tags, id)`, cleaned and
de-duplicated ignoring case (`cleanTag()`, `mergeTags()`). Tags can't contain commas.

- **Rename and merge** are the same operation: `mergeTagKeys(keys, target)` replaces every spelling of the given tags
  with `target`. Renaming to an existing tag's name merges them. If a tag's view is open, it follows the new key.
  `dropTag()` removes a tag from every bookmark. Rename and merge-into use `promptDialog()`, which suggests existing
  tags.
- **Look-alikes.** `similarTagGroups()` finds three kinds of group, cached until the library or the dismissed set
  changes (`tagVer`):
  - `case`: one tag with several spellings (`Travel`/`travel`). Merging spells it the most used way.
  - `alike`: tags that are equal after `fuzzyTag()` (accents, spaces, `-`, `_`, `.`, `/` removed; `ies` → `y`; a final
    `s` dropped unless it's `ss`), or one edit apart (`oneEdit()`) when both are five letters or more with no digits.
    Groups are joined with union-find. The typo check is skipped above 3,000 tags.
  - `ai`: groups from **Find similar**, which sends the 600 most used tag names to the Worker's `tagsim` endpoint and
    keeps the answer in `S.tagAI` for the session.

  Each group merges into its most used tag, or any tag from its ⋯ menu. "They're different" adds the group's
  signature to `S.tagIgnore` for the session.
- **Views.** `tags` rows are section headers, look-alike rows (`r.sim`, skipped by the cursor) and one row per tag
  (`tag:<key>`). Tag rows take the cursor but not the selection tray. **Enter**/**→** opens a tag, **F2** renames,
  **Del** removes, and editing keys do nothing. The `tag` view lists its bookmarks as normal rows, so everything else
  works there, and **←** goes back.
- **Moving between browsers.** `chooseFolderDialog()` is a folder picker with extra form fields.
  - `tagToFolder()` makes a folder from one tag, with copies (`reassignIds(cloneTree(n))`) or by moving the bookmarks,
    and can remove the tag.
  - `allTagsToFolders()` makes one folder holding a folder per tag, with copies.
  - `foldersToTags()` tags every bookmark below a chosen folder with the names of the folders on its path.
  - `tagsToTitles()` appends `#tag` (spaces become hyphens) to titles that don't already contain it.

  Each is one undo step and changes the library. The export choice can do the same to the exported file only.

## Separators

Firefox writes separators as `<HR>`. `<DT>` is never closed in this format, so after a bookmark the HTML parser puts the
`<HR>` *inside* that bookmark's `<DT>`. `readDT()` handles that case and `readDL()` handles `<HR>` directly in a list,
both creating `{ type: 'sep' }` nodes in the right place. `exportHTML()` writes them back as `<HR>`, so export →
import → export is stable.

`isSep()` keeps separators out of everything that means bookmarks: counts, All bookmarks, duplicates, tags, Tidy,
search, and what Bindery Assist is sent. They render as a dashed "Separator" row (`.is-sep`). They can be selected,
dragged, moved, cut and deleted, but not renamed. `describe()` names them in confirmations. `bySections()` sorts the
items between separators and leaves the separators in place, for one-off sorts and A to Z. `addSeparator()` (**+ Add →
Separator**) inserts one after the selected item, or at the end of the open folder (the top level in the tree).

## Firefox and other browsers

`firefoxOnly()` counts what only Firefox understands: tagged bookmarks and tags, keywords (`SHORTCUTURL`), separators,
and `place:` items (`isPlace()`, Firefox's own queries such as Most Visited, marked "Firefox only" in the list).

- **Source.** `detectSource()` calls a file `firefox` when its root is titled "Bookmarks Menu", or anything in it has
  `UNFILED_BOOKMARKS_FOLDER`, `TAGS`, `SHORTCUTURL`, `ICON_URI` or `LAST_CHARSET`, or is a separator or a `place:`
  item. Otherwise it's `other`.
- **Notice.** After `importFile()`, `firefoxNotice()` lists what was found and where it lives, once per open. Restoring
  a saved library doesn't show it again.
- **Export choice.** `doExport()` asks only when `firefoxOnly().any`, and only while `S.exportPrefs.ask` is true (or
  **Choose another browser** asks again). `exportChoice()` returns `{ target: 'firefox' | 'other', tagsAs: 'none' |
  'folders' | 'titles', dropPlace, ask }`. The defaults are the source, nothing, true and true.
- **The exported file.** `exportRootFor(prefs)` returns the library as-is for Firefox. For other browsers it works on
  a `cloneTree()` copy: separators are removed; `place:` items are removed if `dropPlace`; tags are added to titles, or
  a "Tags" folder of copies is added at the top level. The library itself is never changed.
- **Remembered.** `S.source` and `S.exportPrefs` are saved with the library and restored with it. A newly opened file
  starts again from its own source.
- The message after exporting gives Firefox's or Chrome's import steps to match (`TARGETS`).

## Bindery Assist

Optional AI help, served by the Cloudflare Worker in `worker/` (see [worker/README.md](../worker/README.md)). The page
reads the Worker's address from `<meta name="bindery-ai">`. Empty means off, and then no AI button or menu item
renders.

- **Consent.** `S.ai` is `null` (never asked), `'on'` or `'off'`, saved in `bindery.ui.v1`, so it's per browser and
  survives **Forget on this device**. Every entry point goes through `withAI(run)`, which shows the welcome sheet
  (`aiOnboarding()`) unless Assist is on. "Not now" leaves it unset, so the sheet comes back next time. Opened from
  ✦ → **About Bindery Assist** while on, the same sheet offers **Turn off Bindery Assist**. The sheet's buttons stay
  pinned to its bottom edge, and on phones it rises from the bottom of the screen. While Assist is on, the ✦ button is
  a solid gradient.
- **What's sent.** `aiItem()` sends a title and `sendableUrl()`: host and path only, with no query string or
  fragment, and nothing for non-web addresses. Subfolders are sent as `"Name (folder)"` when naming a folder. The only
    exceptions are a bookmark's full address (for `page` and `describe`), folder paths (for `place`) and tag names (for
  `tagsim`). Separators are never sent, and `place:` items send no address.
- **Calling.** `aiFetch()` makes one request and turns failures into readable messages: busy (429), too much
  (400/413), no answer (other statuses) or unreachable. `aiWaiting()` is the waiting sheet around it: Cancel, Esc,
  closing the sheet or a 45-second timeout per request aborts. `aiCall()` is the two together for single requests.
- **Checking.** The Worker validates replies, and the page checks again against the current tree: bookmark numbers
  must point at items still in the folder, each used once.
- **Name chips.** Renaming a folder that has something in it (in a list row or the folder title) shows a **Suggest
  names** chip under the field, when Assist is on. Tapping it calls `askChips()`, which fetches without a sheet and
  swaps in up to three name chips. While a request is out, the chip shows "Thinking…" with an opaque background and a
  border that cycles between purple and blue (`chipThink`). Tapping a name puts it in the field and commits the edit.
  Chips keep the field focused (pointerdown is cancelled), work with Tab and Enter, and the request is aborted if the
  edit ends first. Nothing is sent just because a name field opened. "Suggest a name" in a menu starts the same inline
  edit and asks straight away, or falls back to a picker dialog when the folder isn't on screen.
- <a id="tidy-review"></a>**Tidy review.** `aiTidy()` needs at least 4 bookmarks directly in the folder. It asks in
  batches of 150 (up to 750 bookmarks), passing the existing subfolders and the names suggested so far as `existing`,
  so later batches reuse them. Same-named folders merge, and a name matching an existing subfolder means "move into
  it". The Worker drops suggested new folders that would hold a single bookmark. The result is a plan,
  `S.tidy = { folder, groups: [{ key, name, into }], to: Map(id → group key, '' to stay), off: Set }`, shown as view
  `tidy`. `buildRows()` turns it into a header row per group plus one row per bookmark, so the review uses the same
  virtualized list, selection and keyboard handling as everything else. `tidyGroups()` also reconciles the plan with
  the library on every render: bookmarks that left the folder drop out, new ones stay, empty groups go. That's why the
  plan can survive leaving the view, undo and edits elsewhere. Renaming a group to another group's name merges them.
  Drag and drop onto a header or row assigns to that group (`tidyDropAt`). In this view **K**/**D** set Move/Stay and
  **M** opens Send to. Editing keys are ignored. **Apply** runs one `mutate()` that creates or reuses folders and
  moves the bookmarks. **Discard** drops the plan. Deleting the folder, or opening another file, discards it too. The
  plan lives only in memory, so a reload loses it. Only bookmarks directly in the folder are considered; subfolders
  and their contents stay put.
- **Find similar tags** is described under [Tags](#tags).
- **Clean up titles** sends up to 100 bookmarks (bookmarklets are skipped) and opens `aiReview()`, a checklist where
  every suggestion starts ticked. Everything accepted goes through `mutate()`, so each action is one undo step and
  respects A to Z order.

## Exporting

`exportHTML()` writes a standard Netscape bookmarks file: the doctype and "DO NOT EDIT" comment browsers expect, a UTF-8
meta tag, then `<DL><p>` lists with four-space indentation. Every saved attribute and description is written back,
escaped, and separators are written as `<HR>`. When the library has Firefox-only content, the tree written is
`exportRootFor()` of the browser chosen (see [Firefox and other browsers](#firefox-and-other-browsers)). The file is
named the way Chrome names exports, `bookmarks_<month>_<day>_<yy>.html`, and downloaded through a `blob:` link. Inside
Claude's artifact viewer, where downloads work differently, it uses the host's downloads API instead. A successful
export clears the "unsaved edits" state.

## Saving in the browser

- `bindery.session.v1` holds `{ v: 1, root, fileName, dirty, source, exportPrefs }`, written 600 ms after the last
  change. If the JSON is
  over about 4.5 million characters, or the browser refuses (quota, private mode), nothing is saved and the sidebar
  says so.
- `bindery.ui.v1` holds settings: duplicate mode, layout, **Remember my file**, **Keep everything A to Z** and
  whether Bindery Assist is on. **Forget on this device** leaves these alone.
- Undo history, Tidy plans, dismissed look-alike tags and Assist's similar-tag groups are never saved. They last as long
  as the tab.
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
- **/** or Ctrl/⌘ + **K** searches (a word starting with `#` matches tags). **F** filters the sidebar's folder list.
  **T** switches layout. Alt + **↑** goes up a folder.
- **E** opens the details panel. **Enter** or **F2** renames in place. **N** makes a folder, **B** a bookmark. **M**
  moves, **G** groups.
- Ctrl/⌘ + **X** and **V** cut and paste. **Del** deletes. Ctrl/⌘ + **Z** undoes, with Shift (or Ctrl + **Y**) to redo.
- **K** and **D** keep or mark copies in duplicate review. In a Tidy review they set Move and Stay, and **M** opens Send
  to; editing keys are ignored there.
- In Tags, **Enter**/**→** opens a tag, **F2** renames it and **Del** removes it. **←** goes back from a tag's view.
- **Esc** in a panel field puts the value back. Otherwise it clears the cut, then the selection, then the search, then
  closes the panel.

Drag and drop (HTML5 drag events, so it may not work with touch) works within the list and onto the sidebar tree: drop
onto a folder to move into it, or between rows to reorder, with auto-scroll near the edges and hover-to-open on closed
tree folders. A move into a folder's own subfolder is refused. In a Tidy review, dropping onto a header or row sends
bookmarks to that suggested folder. Alt-click on a folder's arrow opens or closes every folder inside it. Right-click
opens every action for a row.

## Numbers worth knowing

| What | Value |
| --- | --- |
| Row height | 46 px |
| Extra rows rendered above and below the screen | 6 |
| Undo history | 200 steps |
| Save delay after a change | 600 ms |
| Largest library saved in the browser | about 4.5 million characters of JSON |
| Layout breakpoints | 1000, 820 and 600 px |
| Assist request timeout (page side) | 45 s |
| Assist rate limit (Worker) | 20 requests a minute per IP address, per Cloudflare location |
| Tidy | at least 4 bookmarks; 150 per request, up to 750 per run; up to 12 folders per answer |
| Suggest names | up to 60 items sent, 3 names back |
| Clean up titles | up to 100 bookmarks |
| Suggest a folder | up to 400 folder paths, 3 folders back |
| Reading a page | 8 s, first 400 KB of HTML; icons up to 48 KB |
| Writing a note | the page's own description and its first 2,500 characters of text; notes up to 300 characters |
| Details panel | docked above 1180 px wide (372 px), a drawer below that, a bottom sheet under 600 px |
| Typing pause before reading a page | 550 ms |
| Find similar tags | up to 600 tag names sent, up to 60 groups back |
| Look-alike typo check | tags of 5+ letters without digits, in libraries of up to 3,000 tags |

## Code map

The script in `index.html` is in labelled sections, in this order:

```
icons                      inline SVG strings
state                      S, the index, the tag index, undo and redo stacks, element handles
small helpers              URL and name normalization, A to Z order and sections, dates, paths
parse & export             file checks, parsing (separators too), the audit, exportHTML
index                      reindex (with tags), empty folders
rows for the current view  buildRows for each view
mutations & history        mutate, undo, redo, move, rename, group, sort, A to Z, delete, cut and paste
views & selection          setView, search, selection
tree layout                tree view, open folders, expand and collapse all
duplicate review           modes, keeper rules, marks
rendering                  rows (separators too), sidebar tree, header, empty states, selection and mark trays
folder filter & tools      the sidebar's filter and its expand/collapse buttons
inline editing             rename in place, name chips' host
menus                      context menus, Sort, Add and Assist menus
dialogs                    confirm, Move to…, shortcuts
new bookmark helpers       default folder, folder list and paths, address checks
bookmark editor            the details panel: both modes, several items, folder picker, tags, keyword, note, + Add
bindery assist             consent sheet, aiFetch, waiting sheet, review checklist, Clean up titles
folder name suggestions    name chips, Suggest a name
tidy review                aiTidy, the plan, its rows, menus, drop targets, Apply and Discard
tags                       retag, rename and merge, look-alike groups, Find similar, the Tags rows and menus
moving tags                folder picker dialog, tag ↔ folder conversions, tags in titles, Convert menu
browsers                   Firefox-only content, source detection, import notice, export choice, exportRootFor
toasts
import / export            importFile, showProblem, loadRoot, doExport
persistence                localStorage, Remember my file, Forget on this device
drag & drop                drop targets, reorder lines, autoscroll
pointer events, keyboard   event wiring
static chrome, boot        button icons, then restore or start blank
```

## Worker

`worker/` holds the Bindery Assist Worker (`src/index.js`), its `wrangler.toml` and tests (`node --test
worker/test/*.mjs`). It has no dependencies. Seven `POST` endpoints: `tidy`, `name`, `titles`, `place` and `tagsim` ask
a Workers AI model for JSON (JSON mode, with a plain-text fallback) and validate the answer; `page` reads a page's name
and icon without AI; and `describe` reads a page and asks the model for a short note, falling back to the page's own
description. It only answers origins in `ALLOWED_ORIGINS`, caps request size, is rate limited, and stores nothing. See
[worker/README.md](../worker/README.md) for endpoints, limits, deployment and pointing a copy of Bindery at it. The
official site's Worker runs at `https://bookmark-bindery-ai.azureus.workers.dev`.

## Screenshots

`node scripts/screenshots.mjs` regenerates `docs/screenshots/`. It serves the repo locally, opens the made-up library in
`scripts/demo-bookmarks.html`, and captures the library, duplicate review, the details panel, the Tags view and the
export dialog (after tagging a few bookmarks through the app, with some look-alike tags), the Bindery Assist welcome
sheet and a phone view in light and dark with Playwright, saving WebP. The welcome sheet only appears when `index.html`
points at a Worker; nothing is sent to take it. It needs Node and Playwright with Chromium, and nothing else.
