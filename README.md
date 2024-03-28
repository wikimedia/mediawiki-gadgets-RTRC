# Real-Time Recent Changes

* [Documentation](https://meta.wikimedia.org/wiki/RTRC)
* [Issue tracker](https://phabricator.wikimedia.org/tag/gadget-rtrc/)
* [Source code](https://gerrit.wikimedia.org/g/mediawiki/gadgets/RTRC)
* [Code review](https://gerrit.wikimedia.org/r/q/project:mediawiki/gadgets/RTRC)

## Development

* https://www.mediawiki.org/wiki/Quickstart
* https://www.mediawiki.org/wiki/Extension:Gadgets

Define the following gadget via your local `MediaWiki:Gadgets-definition` page,
and copy the two source files to `MediaWiki:Gadget-rtrc.css` and
`MediaWiki:Gadget-rtrc.js`. Commit changes back to Git when done.

```
rtrc[ResourceLoader]|rtrc.css|rtrc.js
```

Alternatively, run `php -S localhost:9296` in this directory and
place the following in your wiki's `MediaWiki:Common.js` or
`Special:Mypage/common.js`. This way you can load it directly from
the working directory.

```js
mw.loader.load('http://localhost:9296/src/rtrc.js');
mw.loader.load('http://localhost:9296/src/rtrc.css', 'text/css');
```

## Deployment

Publish source files to:

* https://www.mediawiki.org/wiki/MediaWiki:Gadget-rtrc.css
* https://www.mediawiki.org/wiki/MediaWiki:Gadget-rtrc.js
