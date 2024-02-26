# Changelog

Notable and user-facing changes to RTRC are documented in this file, in the [Keep a Changelog](http://keepachangelog.com/en/1.0.0/) format.

## v1.4.1

### Fixed
* init: Fix invalid XHTML shortcut for jQuery 3 migration. 0ffca09
* diff: Hide broken "Browse history interactively" link. https://github.com/Krinkle/mw-gadget-rtrc/issues/98
* diff: Restore "new window" behaviour for core's tool links. https://github.com/Krinkle/mw-gadget-rtrc/issues/99

## v1.4.0

### Enhancements

* init: Reduce chances of sidebar reflow by reserving the space of the "RTRC" portlet link ahead of time.

### Fixed

* init: Load executable `intuition.js` from meta.wikimedia.org instead of Toolforge. https://github.com/Krinkle/mw-gadget-rtrc/commit/59eac8adf3cb0a534f8c0fc5594aa9aabfe162f2
* src: Use native ES5 methods instead of jQuery methods where applicable.
* init: Avoid use of various deprecated features (e.g. `mediawiki.api.messages`, and `$.fn.hover()`).
* cvn: Restore caching for CVN API queries (it was caching the last 1 query instead of the last 1000). https://github.com/Krinkle/mw-gadget-rtrc/commit/e7b4549121eafacd06ecc34002cf2e19a27ff4ac
* feed: Make `updateFeed()` error handling more robust.

## v1.3.4

### Fixed
* init: Remove obsolete `json` dependency.

## v1.3.3

### Fixed
* diff: Use 'close' message for both new pages as well. (Matanya) [#66](https://github.com/Krinkle/mw-gadget-rtrc/issues/66)

### Changed
* Localisation improvements. (Eranroz) [#2](https://github.com/Krinkle/mw-gadget-rtrc/issues/2) [#49](https://github.com/Krinkle/mw-gadget-rtrc/issues/49)

## v1.3.2

### Enhancements
* layout: Optimise sidebar transition with CSS will-change.
* init: Add link to RTRC on Special:RecentChanges.

### Fixed
* feed: Fix bidi issues with page title. (Eranroz) [#49](https://github.com/Krinkle/mw-gadget-rtrc/issues/49)
* init: Migrate dependency "mediawiki.action.history.diff" to "mediawiki.diff.styles". [#67](https://github.com/Krinkle/mw-gadget-rtrc/issues/67)

## v1.3.1

### Fixed
* layout: Various directionality fixes and fixed RTL version of the sidebar. [#65](https://github.com/Krinkle/mw-gadget-rtrc/issues/65)

### Maintenance
* layout: Remove transition support for old WebKit browsers.

## v1.3.0

### Enhancements
* init: Simplify load animation.
* init: Minor performance improvements to make startup faster.
* layout: Sidebar now toggles based on hover instead of click.
* layout: Increase sidebar transition duration to 250ms.

### Fixed
* layout: Fix jiggling bug in sidebar navtoggle.
* ores: Switch from ores.wmflabs.org to ores.wikimedia.org. (Ladsgroup)
* init: Add dependency on module `mediawiki.special.changeslist`, per [Gerrit change 295201](https://gerrit.wikimedia.org/r/c/mediawiki/core/+/295201).

## v1.2.0

### Enhancements
* feed: Start the feed by default.
* feed: If the query fails, show a link to report bugs.
* ores: Update score threshold for new models from 80% to 45%.
* Improve "My patrol log" link to exclude autopatrol actions.

### Fixed
* feed: Cancel pending request when applying new settings.
* settings: Catch exceptions from JSON.parse in `readPermalink()`.
* footer: Point "Documentation" link to Meta-Wiki with `uselang` set to the current user language.
* feed: Faster timeUtil parser with native `Date.parse()`.
* feed: Optimise `getApiRcParams()` and `updateFeed()`.
* feed: Remove duplicate handling of "placeholder" css class.
* settings: Remove obsolete "kickstart" hidden option.

## v1.1.1

### Fixed
* SECURITY settings: Don't permalink MassPatrol. [#59](https://github.com/Krinkle/mw-gadget-rtrc/issues/59)

### Changed
* diff: Scroll to the top of the diff frame instead of the top of the app (Thanks He7d3r).

## v1.1.0

### Enhancements
* diff: Automatically scroll up when loading a diff frame. [#44](https://github.com/Krinkle/mw-gadget-rtrc/issues/44)
* feed: Detect and highlight changes that blanked the page. [#57](https://github.com/Krinkle/mw-gadget-rtrc/issues/57)
* feed: Add HiDPI version of user-alert icon.
* settings: Make "Hide bots" configurable in the interface. [#52](https://github.com/Krinkle/mw-gadget-rtrc/issues/52)
* settings: Add placeholder for format to timestamp input fields.
* settings: Combine "User filter"' and "Filter" sections.
* Add in-process cache for CVN and ORES annotations.
* settings: Re-order settings panels a bit.

### Fixed
* Improve localisation of the interface. [#2](https://github.com/Krinkle/mw-gadget-rtrc/issues/2)
  - All form controls are now localised.
  - Abbreviation codes were removed in favour of localised labels.
  - Diff size numbers are now formatted for the current locale.
* feed: Support enabling CVN and ORES annotations at the same time.
* settings: Enable "Edits" and "New pages" checkboxes by default.
* patrol: Ensure "unpatrolled" filter is enabled when using MassPatrol.
* patrol: Wait for feed to finish before waking up MassPatrol.
* settings: Remove `rel=nofollow` attributes from footer links.
* Remove various unused stylesheet rules.
* feed: Remove hacky parser for "Automatic edit summaries", was specific to Wikimedia Commons.
* feed: Remove `&nbsp;` hack in the legend in favour of padding.

## v1.0.5

### Enhancements
* ores: Add support for `reverted` model. Used if `damaged` is unavailable for the current wiki.

### Fixed
* ores: Don't query ORES for model it doesn't have for the current wiki. [#54](https://github.com/Krinkle/mw-gadget-rtrc/issues/54)

## v1.0.4

### Enhancements
* Add support for `wikipage.diff` hook. [#9](https://github.com/Krinkle/mw-gadget-rtrc/issues/9)

## v1.0.3

### Enhancements
* Add support for showing revision scores from [ORES](https://meta.wikimedia.org/wiki/ORES). (Thanks He7d3r)

### Fixed
* Remove use of deprecated `wgScriptExtension`.

## v1.0.2

### Enhancements
* options: Replace "R" label with "Interval" and localised.
* cvn: Use of CORS/JSON instead of JSON-P for improved cache performance.

### Fixed
* navtoggle: Don't move navtoggle on hover.

## v1.0.1

### Enhancements
* i18n: Implement timeout and fallback for when Intuition in Tool Labs is unavailable.
* navtoggle: Redesign sidebar toggling. Especially to improve load performance.

### Fixed
* init: Remove Modernizr.generatedcontent support test. The check was unreliable intermittently returned the wrong result.

## v1.0.0

### Enhancements
* diff: Change close label from "X" to "Close".
* init: Explicitly recognise error if localisation fails to load.

### Fixed
* Work-around pointer events regression in Chrome 42, [Chromium issue #466996](https://code.google.com/p/chromium/issues/detail?id=466996).
* Diff close button is hard to tap on mobile. [#33](https://github.com/Krinkle/mw-gadget-rtrc/issues/33)

### Maintenance
* Simplify "Modernizr.generatedcontent" implementation.

## v0.9.13

### Enhancements
* Improve cacheability of API requests by disabling use of jQuery.ajax underscore cache buster.

### Fixed
* Fix "Cannot mark as patrolled" that sometimes shows up on wikis that have the Translate extension installed. [#32](https://github.com/Krinkle/mw-gadget-rtrc/issues/32)
* Timezone sometimes off by one hour. [#37](https://github.com/Krinkle/mw-gadget-rtrc/issues/37)
* Remove use of deprecated `jQuery#live()`.
* Remove use of deprecated `mw.user.name()`.
* Remove use of deprecated `jquery.json` module.

### Maintenance
* api: Retrieve rctoken from `action=tokens` instead of deprecated `list=recentchanges`.

## v0.9.12

### Enhancements
* Add "250" and "500" options to the limit setting.
* Keep user names unique in the cvn-api request.
* Diff frame now uses native CSS3 transitions instead of jQuery animations. [#25](https://github.com/Krinkle/mw-gadget-rtrc/issues/25)

### Fixed
* Fix typo "oldid" instead of "oldif" in diffLink in buildRcItem (Thanks Ricordisamoa). [#29](https://github.com/Krinkle/mw-gadget-rtrc/issues/29)
* Diff frame used to be jumpy when quickly browsing through edits. [#25](https://github.com/Krinkle/mw-gadget-rtrc/issues/25)
* Ensure we don't rely on mediawiki.util before #init.

## v0.9.11

### Enhancements
* Re-enable cvnDB. [#28](https://github.com/Krinkle/mw-gadget-rtrc/issues/28)

### Fixed
* Interface no longer hangs when using cvnDB and API is unavailable. Updates will now proceed without cvnDB data if the cvn API is unreachable after 2 seconds. [#28](https://github.com/Krinkle/mw-gadget-rtrc/issues/28)

## v0.9.10

Disable cvnDB until further notice (see #28).

## v0.9.9

### Enhancements
* Show link to contributions page instead of user page for anonymous users (Ricordisamoa). [#22](https://github.com/Krinkle/mw-gadget-rtrc/issues/22)
* Use the new `rc.unpatrolled` property from MediaWiki RecentChanges API. This is new in MediaWiki 1.23, and is more accurate for our purpose. For example, on wikis with New Page Patrol enabled, but Edit Patrol disabled, the `unpatrolled` flag now only reports new page creations as unpatrolled. This matches the way the information is presented on Special:RecentChanges and Special:Watchlist.

### Fixed
* Don't hide the toolbox portlet when sidebar is visible.
* Use mw.util.getUrl instead of mw.util.wikiGetlink (deprecated).

## v0.9.8

### Fixed
* Reduce width of "refresh" number input field in Firefox. [#20](https://github.com/Krinkle/mw-gadget-rtrc/issues/20)
* Fix NaN timestamps due to missing timezone offset.
* Handle ajax errors during refresh, e.g. if server is temporarily unavailable.

### Maintenance
* Converted various internal structures to use proper number types instead of attribute strings.
* Removed obsolete `krInArray` function.
* Add a simplified version of the Modernizr feature test for cssgeneratedcontent.

## v0.9.7

### Enhancements
* Add support for rctag option. [#19](https://github.com/Krinkle/mw-gadget-rtrc/issues/19)
* Update link in footer to point directly at issue tracker and changelog.
* Reduce width of the namespace menu's idle state (will expand when activated).
* Reduce font-size to 13px.

### Fixed
* Fix character escaping issues with some message translations.
* Fix minor misalignment of rows in the changes feed.
* Increase width of timestamp field to make sure value is not cropped.
* Connect to cvn.wmflabs.org directly over HTTPS, instead of via the old proxy at tools.wmflabs.org/cvn/.

## v0.9.6

Enhancements:
* New portlet link in Toolbox to quickly open RTRC. [#10](https://github.com/Krinkle/mw-gadget-rtrc/issues/10)
* New sidebar navigation toggle (hidden by default).
* Migrate to v1.0 of the CVN API (at cvn.wmflabs.org). [#17](https://github.com/Krinkle/mw-gadget-rtrc/issues/17)
* Display parsed edit summary instead of plain wikitext. [#13](https://github.com/Krinkle/mw-gadget-rtrc/issues/13)
* Remove "From top" option (now the default behaviour).

Fixed:
* Only show "my patrol log" link to logged-in users. [#12](https://github.com/Krinkle/mw-gadget-rtrc/issues/12)
* MassPatrol doesn't enforce the user filter requirement. [#15](https://github.com/Krinkle/mw-gadget-rtrc/issues/15)

Maintenance:
* Continued refactors and optimisations for the 2013 rewrite.
* Improve rendering performance by optimising layout and cleaning up CSS.
* Refactor settings normalisation.

## v0.9.5

Enhancements:
* Support loading from `Special:Blankpage/RTRC`.
* Switcher checkbox style.
* Prettier permalinks.
* Use native scrollIntoView instead of location.hash for the kickstart.
* Localization is now powered by Intuition via translatewiki.net.
* Localization is now loaded from Tool Labs instead of Toolserver. [#4](https://github.com/Krinkle/mw-gadget-rtrc/issues/4)

Fixed:
* Message "contributions" should be parsed with magic words. [#8](https://github.com/Krinkle/mw-gadget-rtrc/issues/8)

Maintenance:
* CSS is now part of the repository.
* Set up CI on each commit.
* Continued refactors and usability improvements as part of the 2013 rewrite.

## v0.9.4

Major rewrite of 2013.

## v0.9.3

Initial commit, prior to the 2013 refactor.