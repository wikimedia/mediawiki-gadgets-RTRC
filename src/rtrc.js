/**
 * Real-Time Recent Changes
 * https://github.com/Krinkle/mw-gadget-rtrc
 *
 * @license http://krinkle.mit-license.org/
 * @author Timo Tijhof, 2010–2016
 */
/*global alert */
(function ($, mw) {
	'use strict';

	/**
	 * Configuration
	 * -------------------------------------------------
	 */
	var
	appVersion = 'v1.1.1',
	conf = mw.config.get([
		'skin',
		'wgAction',
		'wgCanonicalSpecialPageName',
		'wgPageName',
		'wgServer',
		'wgTitle',
		'wgUserLanguage',
		'wgDBname',
		'wgScriptPath'
	]),
	// Can't use mw.util.wikiScript until after #init
	apiUrl = conf.wgScriptPath + '/api.php',
	cvnApiUrl = '//cvn.wmflabs.org/api.php',
	oresApiUrl = '//ores.wmflabs.org/scores/' + conf.wgDBname + '/',
	oresModel = false,
	intuitionLoadUrl = '//tools.wmflabs.org/intuition/load.php?env=mw',
	docUrl = '//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes?uselang=' + conf.wgUserLanguage,
	// 32x32px
	ajaxLoaderUrl = '//upload.wikimedia.org/wikipedia/commons/d/de/Ajax-loader.gif',
	annotationsCache = {
		patrolled: {},
		cvn: {},
		ores: {}
	},
	// See annotationsCacheUp()
	annotationsCacheSize = 0,

	/**
	 * Info from the wiki
	 * -------------------------------------------------
	 */
	userHasPatrolRight = false,
	rcTags = [],
	wikiTimeOffset,

	/**
	 * State
	 * -------------------------------------------------
	 */
	updateFeedTimeout,

	rcPrevDayHeading,
	skippedRCIDs = [],
	monthNames,

	prevFeedHtml,
	updateReq,

	/**
	 * Feed options
	 * -------------------------------------------------
	 */
	defOpt = {
		rc: {
			// Timestamp
			start: undefined,
			// Timestamp
			end: undefined,
			// Direction "older" (descending) or "newer" (ascending)
			dir: 'older',
			// Array of namespace ids
			namespace: undefined,
			// User name
			user: undefined,
			// Tag ID
			tag: undefined,
			// Filters
			hideliu: false,
			hidebots: true,
			unpatrolled: false,
			limit: 25,
			// Type filters are "show matches only"
			typeEdit: true,
			typeNew: true
		},

		app: {
			refresh: 5,
			cvnDB: false,
			ores: false,
			massPatrol: false,
			autoDiff: false
		}
	},
	aliasOpt = {
		// Back-compat for v1.0.4 and earlier
		showAnonOnly: 'hideliu',
		showUnpatrolledOnly: 'unpatrolled'
	},
	opt = $(true, {}, defOpt),

	timeUtil,
	message,
	msg,
	navSupported = conf.skin === 'vector',
	rAF = window.requestAnimationFrame || setTimeout,

	currentDiff,
	currentDiffRcid,
	$wrapper, $body, $feed,
	$RCOptionsSubmit;

	/**
	 * Utility functions
	 * -------------------------------------------------
	 */

	// Prepends a leading zero if value is under 10
	function leadingZero(i) {
		if (i < 10) {
			i = '0' + i;
		}
		return i;
	}

	timeUtil = {
		// Create new Date instance from MediaWiki API timestamp string
		newDateFromApi: function (s) {
			// Possible number/integer to string
			var t = Date.UTC(
				// "2010-04-25T23:24:02Z" => 2010, 3, 25, 23, 24, 2
				parseInt(s.slice(0, 4), 10), // Year
				parseInt(s.slice(5, 7), 10) - 1, // Month
				parseInt(s.slice(8, 10), 10), // Day
				parseInt(s.slice(11, 13), 10), // Hour
				parseInt(s.slice(14, 16), 10), // Minutes
				parseInt(s.slice(17, 19), 10) // Seconds
			);
			return new Date(t);
		},

		/**
		 * Apply user offset.
		 *
		 * Only use this if you're extracting individual values
		 * from the object (e.g. getUTCDay or getUTCMinutes).
		 * The full timestamp will incorrectly claim "GMT".
		 */
		applyUserOffset: function (d) {
			var parts,
				offset = mw.user.options.get('timecorrection');

			// This preference has no default value, it is null for users that don't
			// override the site's default timeoffset.
			if (offset) {
				parts = offset.split('|');
				if (parts[0] === 'System') {
					// Ignore offset value, as system may have started or stopped
					// DST since the preferences were saved.
					offset = wikiTimeOffset;
				} else {
					offset = Number(parts[1]);
				}
			} else {
				offset = wikiTimeOffset;
			}
			// There is no way to set a timezone in javascript, so we instead pretend the real unix
			// time is different and then get the values from that.
			d.setTime(d.getTime() + (offset * 60 * 1000));
			return d;
		},

		// Get clocktime string adjusted to timezone of wiki
		// from MediaWiki timestamp string
		getClocktimeFromApi: function (s) {
			var d = timeUtil.applyUserOffset(timeUtil.newDateFromApi(s));
			// Return clocktime with leading zeros
			return leadingZero(d.getUTCHours()) + ':' + leadingZero(d.getUTCMinutes());
		}
	};

	/**
	 * Main functions
	 * -------------------------------------------------
	 */

	function buildRcDayHead(time) {
		var current = time.getDate();
		if (current === rcPrevDayHeading) {
			return '';
		}
		rcPrevDayHeading = current;
		return '<div class="mw-rtrc-heading"><div><strong>' + time.getDate() + ' ' + monthNames[time.getMonth()] + '</strong></div></div>';
	}

	/**
	 * @param {Object} rc Recent change object from API
	 * @return {string} HTML
	 */
	function buildRcItem(rc) {
		var diffsize, isUnpatrolled, isAnon,
			typeSymbol, itemClass, diffLink,
			el, item;

		// Get size difference (can be negative, zero or positive)
		diffsize = rc.newlen - rc.oldlen;

		// Convert undefined/empty-string values from API into booleans
		isUnpatrolled = rc.unpatrolled !== undefined;
		isAnon = rc.anon !== undefined;

		// typeSymbol, diffLink & itemClass
		typeSymbol = '&nbsp;';
		itemClass = [];

		if (rc.type === 'new') {
			typeSymbol += '<span class="newpage">N</span>';
		}

		if ((rc.type === 'edit' || rc.type === 'new') && userHasPatrolRight && isUnpatrolled) {
			typeSymbol += '<span class="unpatrolled">!</span>';
		}

		if (rc.oldlen > 0 && rc.newlen === 0) {
			itemClass.push('mw-rtrc-item-alert');
		}

		/*
Example:

<div class="mw-rtrc-item mw-rtrc-item-patrolled" data-diff="0" data-rcid="0" user="Abc">
	<div first>(<a>diff</a>) <span class="unpatrolled">!</span> 00:00 <a>Page</a></div>
	<div user><a class="user" href="//User:Abc">Abc</a></div>
	<div comment><a href="//User talk:Abc">talk</a> / <a href="//Special:Contributions/Abc">contribs</a>&nbsp;<span class="comment">Abc</span></div>
	<div class="mw-rtrc-meta"><span class="mw-plusminus mw-plusminus-null">(0)</span></div>
</div>
		*/

		// build & return item
		item = buildRcDayHead(timeUtil.newDateFromApi(rc.timestamp));
		item += '<div class="mw-rtrc-item ' + itemClass.join(' ') + '" data-diff="' + rc.revid + '" data-rcid="' + rc.rcid + '" user="' + rc.user + '">';

		if (rc.type === 'edit') {
			diffLink = '<a class="rcitemlink diff" href="' +
				mw.util.wikiScript() + '?diff=' + rc.revid + '&oldid=' + rc.old_revid + '&rcid=' + rc.rcid +
				'">' + mw.message('diff').escaped() + '</a>';
		} else if (rc.type === 'new') {
			diffLink = '<a class="rcitemlink newPage">new</a>';
		} else {
			diffLink = mw.message('diff').escaped();
		}

		item += '<div first>' +
			'(' + diffLink + ') ' + typeSymbol + ' ' +
			timeUtil.getClocktimeFromApi(rc.timestamp) +
			' <a class="page" href="' + mw.util.getUrl(rc.title) + '?rcid=' + rc.rcid + '" target="_blank">' + rc.title + '</a>' +
			'</div>' +
			'<div user>&nbsp;<small>&middot;&nbsp;' +
			'<a href="' + mw.util.getUrl('User talk:' + rc.user) + '" target="_blank">' + mw.message('talkpagelinktext').escaped() + '</a>' +
			' &middot; ' +
			'<a href="' + mw.util.getUrl('Special:Contributions/' + rc.user) + '" target="_blank">' + mw.message('contribslink').escaped() + '</a>' +
			'&nbsp;</small>&middot;&nbsp;' +
			'<a class="mw-userlink" href="' + mw.util.getUrl((mw.util.isIPv4Address(rc.user) || mw.util.isIPv6Address(rc.user) ? 'Special:Contributions/' : 'User:') + rc.user) + '" target="_blank">' + rc.user + '</a>' +
			'</div>' +
			'<div comment>&nbsp;<span class="comment">' + rc.parsedcomment + '</span></div>';

		if (diffsize > 0) {
			el = diffsize > 399 ? 'strong' : 'span';
			item += '<div class="mw-rtrc-meta"><' + el + ' class="mw-plusminus mw-plusminus-pos">(+' + diffsize.toLocaleString() + ')</' + el + '></div>';
		} else if (diffsize === 0) {
			item += '<div class="mw-rtrc-meta"><span class="mw-plusminus mw-plusminus-null">(0)</span></div>';
		} else {
			el = diffsize < -399 ? 'strong' : 'span';
			item += '<div class="mw-rtrc-meta"><' + el + ' class="mw-plusminus mw-plusminus-neg">(' + diffsize.toLocaleString() + ')</' + el + '></div>';
		}

		item += '</div>';
		return item;
	}

	/**
	 * @param {Object} newOpt
	 * @param {string} [mode=normal] One of 'quiet' or 'normal'
	 * @return {boolean} True if no changes were made, false otherwise
	 */
	function normaliseSettings(newOpt, mode) {
		var mod = false;

		// MassPatrol requires a filter to be active
		if (newOpt.app.massPatrol && !newOpt.rc.user) {
			newOpt.app.massPatrol = false;
			mod = true;
			if (mode !== 'quiet') {
				alert(msg('masspatrol-requires-userfilter'));
			}
		}

		// MassPatrol implies AutoDiff
		if (newOpt.app.massPatrol && !newOpt.app.autoDiff) {
			newOpt.app.autoDiff = true;
			mod = true;
		}
		// MassPatrol implies fetching only unpatrolled changes
		if (newOpt.app.massPatrol && !newOpt.rc.unpatrolled) {
			newOpt.rc.unpatrolled = true;
			mod = true;
		}

		return !mod;
	}

	function fillSettingsForm(newOpt) {
		var $settings = $($wrapper.find('.mw-rtrc-settings')[0].elements).filter(':input');

		if (newOpt.rc) {
			$.each(newOpt.rc, function (key, value) {
				var $setting = $settings.filter(function () {
						return this.name === key;
					}),
					setting = $setting[0];

				if (!setting) {
					return;
				}

				switch (key) {
				case 'limit':
					setting.value = value;
					break;
				case 'namespace':
					if (value === undefined) {
						// Value "" (all) is represented by undefined.
						$setting.find('option').eq(0).prop('selected', true);
					} else {
						$setting.val(value);
					}
					break;
				case 'user':
				case 'start':
				case 'end':
				case 'tag':
					setting.value = value || '';
					break;
				case 'hideliu':
				case 'hidebots':
				case 'unpatrolled':
				case 'typeEdit':
				case 'typeNew':
					setting.checked = value;
					break;
				case 'dir':
					if (setting.value === value) {
						setting.checked = true;
					}
					break;
				}
			});
		}

		if (newOpt.app) {
			$.each(newOpt.app, function (key, value) {
				var $setting = $settings.filter(function () {
						return this.name === key;
					}),
					setting = $setting[0];

				if (!setting) {
					setting = document.getElementById('rc-options-' + key);
					$setting = $(setting);
				}

				if (!setting) {
					return;
				}

				switch (key) {
				case 'cvnDB':
				case 'ores':
				case 'massPatrol':
				case 'autoDiff':
					setting.checked = value;
					break;
				case 'refresh':
					setting.value = value;
					break;
				}
			});
		}

	}

	function readSettingsForm() {
		// jQuery#serializeArray is nice, but doesn't include "value: false" for unchecked
		// checkboxes that are not disabled. Using raw .elements instead and filtering
		// out <fieldset>.
		var $settings = $($wrapper.find('.mw-rtrc-settings')[0].elements).filter(':input');

		opt = $.extend(true, {}, defOpt);

		$settings.each(function (i, el) {
			var name = el.name;

			switch (name) {
			// RC
			case 'limit':
				opt.rc[name] = Number(el.value);
				break;
			case 'namespace':
				// Can be "0".
				// Value "" (all) is represented by undefined.
				// TODO: Turn this into a multi-select, the API supports it.
				opt.rc[name] = el.value.length ? Number(el.value) : undefined;
				break;
			case 'user':
			case 'start':
			case 'end':
			case 'tag':
				opt.rc[name] = el.value || undefined;
				break;
			case 'hideliu':
			case 'hidebots':
			case 'unpatrolled':
			case 'typeEdit':
			case 'typeNew':
				opt.rc[name] = el.checked;
				break;
			case 'dir':
				// There's more than 1 radio button with this name in this loop,
				// use the value of the first (and only) checked one.
				if (el.checked) {
					opt.rc[name] = el.value;
				}
				break;
			// APP
			case 'cvnDB':
			case 'ores':
			case 'massPatrol':
			case 'autoDiff':
				opt.app[name] = el.checked;
				break;
			case 'refresh':
				opt.app[name] = Number(el.value);
				break;
			}
		});

		if (!normaliseSettings(opt)) {
			// TODO: Optimise this, no need to repopulate the entire settings form
			// if only 1 thing changed.
			fillSettingsForm(opt);
		}
	}

	function getPermalink() {
		var uri = new mw.Uri(mw.util.getUrl(conf.wgPageName)),
			reducedOpt = {};

		$.each(opt.rc, function (key, value) {
			if (defOpt.rc[key] !== value) {
				if (!reducedOpt.rc) {
					reducedOpt.rc = {};
				}
				reducedOpt.rc[key] = value;
			}
		});

		$.each(opt.app, function (key, value) {
			// Don't permalink MassPatrol (issue Krinkle/mw-rtrc-gadget#59)
			if (key !== 'massPatrol' && defOpt.app[key] !== value) {
				if (!reducedOpt.app) {
					reducedOpt.app = {};
				}
				reducedOpt.app[key] = value;
			}
		});

		reducedOpt = JSON.stringify(reducedOpt);

		uri.extend({
			opt: reducedOpt === '{}' ? undefined : reducedOpt,
			kickstart: 1
		});

		return uri.toString();
	}

	function updateFeedNow() {
		$('#rc-options-pause').prop('checked', false);
		if (updateReq) {
			// Try to abort the current request
			updateReq.abort();
		}
		clearTimeout(updateFeedTimeout);
		return updateFeed();
	}

	/**
	 * @param {jQuery} $element
	 */
	function scrollIntoView($element) {
		$element[0].scrollIntoView({ block: 'start', behavior: 'smooth' });
	}

	/**
	 * @param {jQuery} $element
	 */
	function scrollIntoViewIfNeeded($element) {
		if ($element[0].scrollIntoViewIfNeeded) {
			$element[0].scrollIntoViewIfNeeded({ block: 'start', behavior: 'smooth' });
		} else {
			$element[0].scrollIntoView({ block: 'start', behavior: 'smooth' });
		}
	}

	// Read permalink into the program and reflect into settings form.
	// TODO: Refactor into init, as this does more than read permalink.
	// It also inits the settings form and handles kickstart
	function readPermalink() {
		var group, oldKey, newKey,
			url = new mw.Uri(),
			newOpt = url.query.opt,
			kickstart = url.query.kickstart;

		newOpt = newOpt ? JSON.parse(newOpt) : {};

		// Rename values for old aliases
		for (group in newOpt) {
			for (oldKey in newOpt[group]) {
				newKey = aliasOpt[oldKey];
				if (newKey && !newOpt[group].hasOwnProperty(newKey)) {
					newOpt[group][newKey] = newOpt[group][oldKey];
					delete newOpt[group][oldKey];
				}
			}
		}

		if (newOpt.app) {
			// Don't permalink MassPatrol (issue Krinkle/mw-rtrc-gadget#59)
			delete newOpt.app.massPatrol;
		}

		newOpt = $.extend(true, {}, defOpt, newOpt);

		normaliseSettings(newOpt, 'quiet');

		fillSettingsForm(newOpt);

		opt = newOpt;

		if (kickstart === '1') {
			updateFeedNow();
			scrollIntoView($wrapper);
		}
	}

	function getApiRcParams(rc) {
		var params,
			rcprop = [
				'flags',
				'timestamp',
				'user',
				'title',
				'parsedcomment',
				'sizes',
				'ids'
			],
			rcshow = [],
			rctype = [];

		if (userHasPatrolRight) {
			rcprop.push('patrolled');
		}

		if (rc.hideliu) {
			rcshow.push('anon');
		}
		if (rc.hidebots) {
			rcshow.push('!bot');
		}
		if (rc.unpatrolled) {
			rcshow.push('!patrolled');
		}

		if (rc.typeEdit) {
			rctype.push('edit');
		}
		if (rc.typeNew) {
			rctype.push('new');
		}
		if (!rctype.length) {
			// Custom default instead of MediaWiki's default (in case both checkboxes were unchecked)
			rctype = ['edit', 'new'];
		}

		params = {
			rcdir: rc.dir,
			rclimit: rc.limit,
			rcshow: rcshow.join('|'),
			rcprop: rcprop.join('|'),
			rctype: rctype.join('|')
		};

		if (rc.dir === 'older') {
			if (rc.end !== undefined) {
				params.rcstart = rc.end;
			}
			if (rc.start !== undefined) {
				params.rcend = rc.start;
			}
		} else if (rc.dir === 'newer') {
			if (rc.start !== undefined) {
				params.rcstart = rc.start;
			}
			if (rc.end !== undefined) {
				params.rcend = rc.end;
			}
		}

		if (rc.namespace !== undefined) {
			params.rcnamespace = rc.namespace;
		}

		if (rc.user !== undefined) {
			params.rcuser = rc.user;
		}

		if (rc.tag !== undefined) {
			params.rctag = rc.tag;
		}

		// params.titles: Title filter (rctitles) is no longer supported by MediaWiki,
		// see https://bugzilla.wikimedia.org/show_bug.cgi?id=12394#c5.

		return params;
	}

	// Called when the feed is regenerated before being inserted in the document
	function applyRtrcAnnotations($feedContent) {
		// Re-apply item classes
		$feedContent.filter('.mw-rtrc-item').each(function () {
			var $el = $(this),
				rcid = Number($el.data('rcid'));

			// Mark skipped and patrolled items as such
			if ($.inArray(rcid, skippedRCIDs) !== -1) {
				$el.addClass('mw-rtrc-item-skipped');
			} else if (annotationsCache.patrolled.hasOwnProperty(rcid)) {
				$el.addClass('mw-rtrc-item-patrolled');
			} else if (rcid === currentDiffRcid) {
				$el.addClass('mw-rtrc-item-current');
			}
		});
	}

	function applyOresAnnotations($feedContent) {
		var dAnnotations, revids, fetchRevids;

		if (!oresModel) {
			return $.Deferred().resolve();
		}

		// Find all revids names inside the feed
		revids = $.map($feedContent.filter('.mw-rtrc-item'), function (node) {
			return $(node).attr('data-diff');
		});

		if (!revids.length) {
			return $.Deferred().resolve();
		}

		fetchRevids = $.grep(revids, function (revid) {
			return !annotationsCache.ores.hasOwnProperty(revid);
		});

		if (!fetchRevids.length) {
			// No (new) revisions
			dAnnotations = $.Deferred().resolve(annotationsCache.ores);
		} else {
			dAnnotations = $.ajax({
				url: oresApiUrl,
				data: {
					models: oresModel,
					revids: fetchRevids.join('|')
				},
				timeout: 10000,
				dataType: $.support.cors ? 'json' : 'jsonp',
				cache: true
			}).then(function (resp) {
				var len;
				if (resp) {
					len = Object.keys ? Object.keys(resp).length : fetchRevids.length;
					annotationsCacheUp(len);
					$.each(resp, function (revid, item) {
						if (!item || item.error || !item[oresModel] || item[oresModel].error) {
							return;
						}
						annotationsCache.ores[revid] = item[oresModel].probability['true'];
					});
				}
				return annotationsCache.ores;
			});
		}

		return dAnnotations.then(function (annotations) {
			// Loop through all revision ids
			$.each(revids, function (i, revid) {
				var tooltip,
					score = annotations[revid];
				// Only highlight high probability scores
				if (!score || score <= 0.8) {
					return;
				}
				tooltip = msg('ores-damaging-probability', (100 * score).toFixed(0) + '%');

				// Add alert
				$feedContent
					.filter('.mw-rtrc-item[data-diff="' + Number(revid) + '"]')
					.addClass('mw-rtrc-item-alert mw-rtrc-item-alert-rev')
					.find('.mw-rtrc-meta')
					.prepend(
						$('<span>')
							.addClass('mw-rtrc-revscore')
							.attr('title', tooltip)
					);
			});
		});
	}

	function applyCvnAnnotations($feedContent) {
		var dAnnotations,
			users = [];

		// Collect user names
		$feedContent.filter('.mw-rtrc-item').each(function () {
			var user = $(this).attr('user');
			// Don't query the same user multiple times
			if (user && $.inArray(user, users) === -1 && !annotationsCache.cvn.hasOwnProperty(user)) {
				users.push(user);
			}
		});

		if (!users.length) {
			// No (new) users
			dAnnotations = $.Deferred().resolve(annotationsCache.cvn);
		} else {
			dAnnotations = $.ajax({
				url: cvnApiUrl,
				data: { users: users.join('|') },
				timeout: 2000,
				dataType: $.support.cors ? 'json' : 'jsonp',
				cache: true
			})
			.then(function (resp) {
				if (resp.users) {
					annotationsCacheUp(resp.users.length);
					$.each(resp.users, function (name, user) {
						annotationsCache.cvn[name] = user;
					});
				}
				return annotationsCache.cvn;
			});
		}

		return dAnnotations.then(function (annotations) {
			// Loop through all cvn user annotations
			$.each(annotations, function (name, user) {
				var tooltip;

				// Only if blacklisted, otherwise don't highlight
				if (user.type === 'blacklist') {
					tooltip = '';

					if (user.comment) {
						tooltip += msg('cvn-reason') + ': ' + user.comment + '. ';
					} else {
						tooltip += msg('cvn-reason') + ': ' + msg('cvn-reason-empty');
					}

					if (user.adder) {
						tooltip += msg('cvn-adder') + ': ' + user.adder;
					} else {
						tooltip += msg('cvn-adder') + ': ' + msg('cvn-adder-empty');
					}

					// Add alert
					$feedContent
						.filter('.mw-rtrc-item')
						.filter(function () {
							return $(this).attr('user') === name;
						})
						.addClass('mw-rtrc-item-alert mw-rtrc-item-alert-user')
						.find('.mw-userlink')
						.attr('title', tooltip);
				}

			});
		});
	}

	/**
	 * @param {Object} update
	 * @param {jQuery} update.$feedContent
	 * @param {string} update.rawHtml
	 */
	function pushFeedContent(update) {
		// TODO: Only do once
		$body.removeClass('placeholder');

		$feed.find('.mw-rtrc-feed-update').html(
			message('lastupdate-rc', new Date().toLocaleString()).escaped() +
			' | <a href="' + getPermalink() + '">' +
			message('permalink').escaped() +
			'</a>'
		);

		if (update.rawHtml !== prevFeedHtml) {
			prevFeedHtml = update.rawHtml;
			applyRtrcAnnotations(update.$feedContent);
			$feed.find('.mw-rtrc-feed-content').empty().append(update.$feedContent);
		}
	}

	function updateFeed() {
		if (updateReq) {
			updateReq.abort();
		}

		// Indicate updating
		$('#krRTRC_loader').show();

		// Download recent changes
		updateReq = $.ajax({
			url: apiUrl,
			dataType: 'json',
			data: $.extend(getApiRcParams(opt.rc), {
				format: 'json',
				action: 'query',
				list: 'recentchanges'
			})
		});
		// This waterfall flows in one of two ways:
		// - Everything casts to success and results in a UI update (maybe an error message),
		//   loading indicator hidden, and the next update scheduled.
		// - Request is aborted and nothing happens (instead, the final handling will
		//   be done by the new request).
		return updateReq.always(function () {
			updateReq = null;
		})
		.then(null, function (jqXhr, textStatus) {
			var feedContentHTML = '<h3>Downloading recent changes failed</h3>';
			if (textStatus === 'abort') {
				return $.Deferred().reject();
			}
			pushFeedContent({
				$feedContent: $(feedContentHTML),
				rawHtml: feedContentHTML
			});
			// Error is handled. Move on normally.
			return $.Deferred().resolve();
		}).then(function (data) {
			var recentchanges, $feedContent,
				feedContentHTML = '';

			if (data.error) {
				// Account doesn't have patrol flag
				if (data.error.code === 'rcpermissiondenied') {
					feedContentHTML += '<h3>Downloading recent changes failed</h3><p>Please untick the "Unpatrolled only"-checkbox or request the Patroller-right.</a>';

				// Other error
				} else {
					feedContentHTML += '<h3>Downloading recent changes failed</h3><p>Please check the settings above and try again. If you believe this is a bug, please <a href="//meta.wikimedia.org/w/index.php?title=User_talk:Krinkle/Tools&action=edit&section=new&preload=User_talk:Krinkle/Tools/Preload" target="_blank"><strong>let me know</strong></a>.';
				}
			} else {
				recentchanges = data.query.recentchanges;

				if (recentchanges.length) {
					$.each(recentchanges, function (i, rc) {
						feedContentHTML += buildRcItem(rc);
					});
				} else {
					// Everything is OK - no results
					feedContentHTML += '<strong><em>' + message('nomatches').escaped() + '</em></strong>';
				}

				// Reset day
				rcPrevDayHeading = undefined;
			}

			$feedContent = $($.parseHTML(feedContentHTML));
			return $.when(
				opt.app.cvnDB && applyCvnAnnotations($feedContent),
				oresModel && opt.app.ores && applyOresAnnotations($feedContent)
			).then(null, function () {
				// Ignore errors from annotation handlers
				return $.Deferred().resolve();
			}).then(function () {
				pushFeedContent({
					$feedContent: $feedContent,
					rawHtml: feedContentHTML
				});
			});
		}).then(function () {
			$RCOptionsSubmit.prop('disabled', false).css('opacity', '1.0');

			// Schedule next update
			updateFeedTimeout = setTimeout(updateFeed, opt.app.refresh * 1000);
			$('#krRTRC_loader').hide();
		});
	}

	function nextDiff() {
		var $lis = $feed.find('.mw-rtrc-item:not(.mw-rtrc-item-current, .mw-rtrc-item-patrolled, .mw-rtrc-item-skipped)');
		$lis.eq(0).find('a.rcitemlink').click();
	}

	function wakeupMassPatrol(settingVal) {
		if (settingVal === true) {
			if (!currentDiff) {
				nextDiff();
			} else {
				$('.patrollink a').click();
			}
		}
	}

	// Build the main interface
	function buildInterface() {
		var namespaceOptionsHtml, tagOptionsHtml,
			key,
			fmNs = mw.config.get('wgFormattedNamespaces');

		namespaceOptionsHtml = '<option value>' + mw.message('namespacesall').escaped() + '</option>';
		namespaceOptionsHtml += '<option value="0">' + mw.message('blanknamespace').escaped() + '</option>';

		for (key in fmNs) {
			if (key > 0) {
				namespaceOptionsHtml += '<option value="' + key + '">' + fmNs[key] + '</option>';
			}
		}

		tagOptionsHtml = '<option value selected>' + message('select-placeholder-none').escaped() + '</option>';
		for (key = 0; key < rcTags.length; key++) {
			tagOptionsHtml += '<option value="' + mw.html.escape(rcTags[key]) + '">' + mw.html.escape(rcTags[key]) + '</option>';
		}

		$wrapper = $($.parseHTML(
		'<div class="mw-rtrc-wrapper">' +
			'<div class="mw-rtrc-head">' +
				message('title').escaped() + ' <small>(' + appVersion + ')</small>' +
				'<div class="mw-rtrc-head-links">' +
					(!mw.user.isAnon() ? (
						'<a target="_blank" href="' + mw.util.getUrl('Special:Log/patrol') + '?user=' + encodeURIComponent(mw.user.getName()) + '">' +
							message('mypatrollog').escaped() +
						'</a>'
					) : '') +
					'<a id="mw-rtrc-toggleHelp">' + message('help').escaped() + '</a>' +
				'</div>' +
			'</div>' +
			'<form id="krRTRC_RCOptions" class="mw-rtrc-settings mw-rtrc-nohelp make-switch"><fieldset>' +
				'<div class="panel-group">' +
					'<div class="panel">' +
						'<label class="head">' + message('filter').escaped() + '</label>' +
						'<div class="sub-panel">' +
							'<label>' +
								'<input type="checkbox" name="hideliu" />' +
								' ' + message('filter-hideliu').escaped() +
							'</label>' +
							'<br />' +
							'<label>' +
								'<input type="checkbox" name="hidebots" />' +
								' ' + message('filter-hidebots').escaped() +
							'</label>' +
						'</div>' +
						'<div class="sub-panel">' +
							'<label>' +
								'<input type="checkbox" name="unpatrolled" />' +
								' ' + message('filter-unpatrolled').escaped() +
							'</label>' +
							'<br />' +
							'<label>' +
								message('userfilter').escaped() +
								'<span section="Userfilter" class="helpicon"></span>: ' +
								'<input type="search" size="16" name="user" />' +
							'</label>' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' + message('type').escaped() + '</label>' +
						'<div class="sub-panel">' +
							'<label>' +
								'<input type="checkbox" name="typeEdit" checked />' +
								' ' + message('typeEdit').escaped() +
							'</label>' +
							'<br />' +
							'<label>' +
								'<input type="checkbox" name="typeNew" checked />' +
								' ' + message('typeNew').escaped() +
							'</label>' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label  class="head">' +
							mw.message('namespaces').escaped() +
							' <br />' +
							'<select class="mw-rtrc-setting-select" name="namespace">' +
							namespaceOptionsHtml +
							'</select>' +
						'</label>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							message('timeframe').escaped() +
							'<span section="Timeframe" class="helpicon"></span>' +
						'</label>' +
						'<div class="sub-panel" style="text-align: right;">' +
							'<label>' +
								message('time-from').escaped() + ': ' +
								'<input type="text" size="16" placeholder="YYYYMMDDHHIISS" name="start" />' +
							'</label>' +
							'<br />' +
							'<label>' +
								message('time-untill').escaped() + ': ' +
								'<input type="text" size="16" placeholder="YYYYMMDDHHIISS" name="end" />' +
							'</label>' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							message('order').escaped() +
							' <br />' +
							'<span section="Order" class="helpicon"></span>' +
						'</label>' +
						'<div class="sub-panel">' +
							'<label>' +
								'<input type="radio" name="dir" value="newer" />' +
								' ' + message('asc').escaped() +
							'</label>' +
							'<br />' +
							'<label>' +
								'<input type="radio" name="dir" value="older" checked />' +
								' ' + message('desc').escaped() +
							'</label>' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label for="mw-rtrc-settings-refresh" class="head">' +
							message('reload-interval').escaped() + '<br />' +
							'<span section="Reload_Interval" class="helpicon"></span>' +
						'</label>' +
						'<input type="number" value="3" min="0" max="99" size="2" id="mw-rtrc-settings-refresh" name="refresh" />' +
					'</div>' +
					'<div class="panel panel-last">' +
						'<input class="button" type="button" id="RCOptions_submit" value="' + message('apply').escaped() + '" />' +
					'</div>' +
				'</div>' +
				'<div class="panel-group panel-group-mini">' +
					'<div class="panel">' +
						'<label for="mw-rtrc-settings-limit" class="head">' + message('limit').escaped() + '</label>' +
						' <select id="mw-rtrc-settings-limit" name="limit">' +
							'<option value="10">10</option>' +
							'<option value="25" selected>25</option>' +
							'<option value="50">50</option>' +
							'<option value="75">75</option>' +
							'<option value="100">100</option>' +
							'<option value="250">250</option>' +
							'<option value="500">500</option>' +
						'</select>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							message('tag').escaped() +
							' <select class="mw-rtrc-setting-select" name="tag">' +
							tagOptionsHtml +
							'</select>' +
						'</label>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							'CVN Scores' +
							'<span section="CVN_Scores" class="helpicon"></span>' +
							'<input type="checkbox" class="switch" name="cvnDB" />' +
						'</label>' +
					'</div>' +
					(oresModel ? (
						'<div class="panel">' +
							'<label class="head">' +
								'ORES Scores' +
								'<span section="ORES_Scores" class="helpicon"></span>' +
								'<input type="checkbox" class="switch" name="ores" />' +
							'</label>' +
						'</div>'
					) : '') +
					'<div class="panel">' +
						'<label class="head">' +
							message('masspatrol').escaped() +
							'<span section="MassPatrol" class="helpicon"></span>' +
							'<input type="checkbox" class="switch" name="massPatrol" />' +
						'</label>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							message('autodiff').escaped() +
							'<span section="AutoDiff" class="helpicon"></span>' +
							'<input type="checkbox" class="switch" name="autoDiff" />' +
						'</label>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							message('pause').escaped() +
							'<input class="switch" type="checkbox" id="rc-options-pause" />' +
						'</label>' +
					'</div>' +
				'</div>' +
			'</fieldset></form>' +
			'<a name="krRTRC_DiffTop" />' +
			'<div class="mw-rtrc-diff mw-rtrc-diff-closed" id="krRTRC_DiffFrame"></div>' +
			'<div class="mw-rtrc-body placeholder">' +
				'<div class="mw-rtrc-feed">' +
					'<div class="mw-rtrc-feed-update"></div>' +
					'<div class="mw-rtrc-feed-content"></div>' +
				'</div>' +
				'<img src="' + ajaxLoaderUrl + '" id="krRTRC_loader" style="display: none;" />' +
				'<div class="mw-rtrc-legend">' +
					message('legend').escaped() + ': ' +
					'<div class="mw-rtrc-item mw-rtrc-item-patrolled">' + mw.message('markedaspatrolled').escaped() + '</div>, ' +
					'<div class="mw-rtrc-item mw-rtrc-item-current">' + message('currentedit').escaped() + '</div>, ' +
					'<div class="mw-rtrc-item mw-rtrc-item-skipped">' + message('skippededit').escaped() + '</div>' +
				'</div>' +
			'</div>' +
			'<div style="clear: both;"></div>' +
			'<div class="mw-rtrc-foot">' +
				'<div class="plainlinks" style="text-align: right;">' +
					'Real-Time Recent Changes by ' +
					'<a href="//meta.wikimedia.org/wiki/User:Krinkle" class="external text">Krinkle</a>' +
					' | <a href="//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes" class="external text">' + message('documentation').escaped() + '</a>' +
					' | <a href="https://github.com/Krinkle/mw-gadget-rtrc/releases" class="external text">' + message('changelog').escaped() + '</a>' +
					' | <a href="https://github.com/Krinkle/mw-gadget-rtrc/issues" class="external text">Feedback</a>' +
					' | <a href="http://krinkle.mit-license.org" class="external text">License</a>' +
				'</div>' +
			'</div>' +
		'</div>'
		));

		// Add helper element for switch checkboxes
		$wrapper.find('input.switch').after('<div class="switched"></div>');

		// All links within the diffframe should open in a new window
		$wrapper.find('#krRTRC_DiffFrame').on('click', 'table.diff a', function () {
			var $el = $(this);
			if ($el.is('[href^="http://"], [href^="https://"], [href^="//"]')) {
				$el.attr('target', '_blank');
			}
		});

		$('#content').empty().append($wrapper);
		rAF(function () {
			$('html').addClass('mw-rtrc-ready');
		});

		$body = $wrapper.find('.mw-rtrc-body');
		$feed = $body.find('.mw-rtrc-feed');
	}

	function annotationsCacheUp(increment) {
		annotationsCacheSize += increment || 1;
		if (annotationsCacheSize > 1000) {
			annotationsCache.patrolled = {};
			annotationsCache.ores = {};
			annotationsCache.cvn = {};
		}
	}

	// Bind event hanlders in the user interface
	function bindInterface() {
		var api = new mw.Api();
		$RCOptionsSubmit = $('#RCOptions_submit');

		// Apply button
		$RCOptionsSubmit.click(function () {
			$RCOptionsSubmit.prop('disabled', true).css('opacity', '0.5');

			readSettingsForm();

			updateFeedNow().then(function () {
				wakeupMassPatrol(opt.app.massPatrol);
			});
			return false;
		});

		// Close Diff
		$wrapper.on('click', '#diffClose', function () {
			$('#krRTRC_DiffFrame').addClass('mw-rtrc-diff-closed');
			currentDiff = currentDiffRcid = false;
		});

		// Load diffview on (diff)-link click
		$feed.on('click', 'a.diff', function (e) {
			var $item = $(this).closest('.mw-rtrc-item').addClass('mw-rtrc-item-current'),
				title = $item.find('.page').text(),
				href = $(this).attr('href'),
				$frame = $('#krRTRC_DiffFrame');

			$feed.find('.mw-rtrc-item-current').not($item).removeClass('mw-rtrc-item-current');

			currentDiff = Number($item.data('diff'));
			currentDiffRcid = Number($item.data('rcid'));

			$frame
				.addClass('mw-rtrc-diff-loading')
				// Reset class potentially added by a.newPage or diffClose
				.removeClass('mw-rtrc-diff-newpage mw-rtrc-diff-closed');

			$.ajax({
				url: mw.util.wikiScript(),
				dataType: 'html',
				data: {
					action: 'render',
					diff: currentDiff,
					diffonly: '1',
					uselang: conf.wgUserLanguage
				}
			}).fail(function (jqXhr) {
				$frame
					.append(jqXhr.responseText || 'Loading diff failed.')
					.removeClass('mw-rtrc-diff-loading');
			}).done(function (data) {
				var skipButtonHtml, $diff;
				if ($.inArray(currentDiffRcid, skippedRCIDs) !== -1) {
					skipButtonHtml = '<span class="tab"><a id="diffUnskip">' + message('unskip').escaped() + '</a></span>';
				} else {
					skipButtonHtml = '<span class="tab"><a id="diffSkip">' + message('skip').escaped() + '</a></span>';
				}

				$frame
					.html(data)
					.prepend(
						'<h3>' + mw.html.escape(title) + '</h3>' +
						'<div class="mw-rtrc-diff-tools">' +
							'<span class="tab"><a id="diffClose">' + message('close').escaped() + '</a></span>' +
							'<span class="tab"><a href="' + href + '" target="_blank" id="diffNewWindow">Open in Wiki</a></span>' +
							(userHasPatrolRight ?
								'<span class="tab"><a onclick="(function(){ if($(\'.patrollink a\').length){ $(\'.patrollink a\').click(); } else { $(\'#diffSkip\').click(); } })();">[mark]</a></span>' :
								''
							) +
							'<span class="tab"><a id="diffNext">' + mw.message('next').escaped() + ' &raquo;</a></span>' +
							skipButtonHtml +
						'</div>'
					)
					.removeClass('mw-rtrc-diff-loading');

				if (opt.app.massPatrol) {
					$frame.find('.patrollink a').click();
				} else {
					$diff = $frame.find('table.diff');
					if ($diff.length) {
						mw.hook('wikipage.diff').fire($diff.eq(0));
					}
					// Only scroll up if the user scrolled down
					// Leave scroll offset unchanged otherwise
					scrollIntoViewIfNeeded($frame);
				}
			});

			e.preventDefault();
		});

		$feed.on('click', 'a.newPage', function (e) {
			var $item = $(this).closest('.mw-rtrc-item').addClass('mw-rtrc-item-current'),
				title = $item.find('.page').text(),
				href = $item.find('.page').attr('href'),
				$frame = $('#krRTRC_DiffFrame');

			$feed.find('.mw-rtrc-item-current').not($item).removeClass('mw-rtrc-item-current');

			currentDiffRcid = Number($item.data('rcid'));

			$frame
				.addClass('mw-rtrc-diff-loading mw-rtrc-diff-newpage')
				.removeClass('mw-rtrc-diff-closed');

			$.ajax({
				url: href,
				dataType: 'html',
				data: {
					action: 'render',
					uselang: conf.wgUserLanguage
				}
			}).fail(function (jqXhr) {
				$frame
					.append(jqXhr.responseText || 'Loading diff failed.')
					.removeClass('mw-rtrc-diff-loading');
			}).done(function (data) {
				var skipButtonHtml;
				if ($.inArray(currentDiffRcid, skippedRCIDs) !== -1) {
					skipButtonHtml = '<span class="tab"><a id="diffUnskip">' + message('unskip').escaped() + '</a></span>';
				} else {
					skipButtonHtml = '<span class="tab"><a id="diffSkip">' + message('skip').escaped() + '</a></span>';
				}

				$frame
					.html(data)
					.prepend(
						'<h3>' + title + '</h3>' +
						'<div class="mw-rtrc-diff-tools">' +
							'<span class="tab"><a id="diffClose">X</a></span>' +
							'<span class="tab"><a href="' + href + '" target="_blank" id="diffNewWindow">Open in Wiki</a></span>' +
							'<span class="tab"><a onclick="$(\'.patrollink a\').click()">[mark]</a></span>' +
							'<span class="tab"><a id="diffNext">' + mw.message('next').escaped() + ' &raquo;</a></span>' +
							skipButtonHtml +
						'</div>'
					)
					.removeClass('mw-rtrc-diff-loading');

				if (opt.app.massPatrol) {
					$frame.find('.patrollink a').click();
				}
			});

			e.preventDefault();
		});

		// Mark as patrolled
		$wrapper.on('click', '.patrollink', function () {
			var $el = $(this);
			$el.find('a').text(mw.msg('markaspatrolleddiff') + '...');
			api.postWithToken('patrol', {
				action: 'patrol',
				rcid: currentDiffRcid
			}).done(function (data) {
				if (!data || data.error) {
					$el.empty().append(
						$('<span style="color: red;"></span>').text(mw.msg('markedaspatrollederror'))
					);
					mw.log('Patrol error:', data);
					return;
				}
				$el.empty().append(
					$('<span style="color: green;"></span>').text(mw.msg('markedaspatrolled'))
				);
				$feed.find('.mw-rtrc-item[data-rcid="' + currentDiffRcid + '"]').addClass('mw-rtrc-item-patrolled');

				// Feed refreshes may overlap with patrol actions, which can cause patrolled edits
				// to show up in an "Unpatrolled only" feed. This is make nextDiff() skip those.
				annotationsCacheUp();
				annotationsCache.patrolled[currentDiffRcid] = true;

				if (opt.app.autoDiff) {
					nextDiff();
				}
			}).fail(function () {
				$el.empty().append(
					$('<span style="color: red;"></span>').text(mw.msg('markedaspatrollederror'))
				);
			});

			return false;
		});

		// Trigger NextDiff
		$wrapper.on('click', '#diffNext', function () {
			nextDiff();
		});

		// SkipDiff
		$wrapper.on('click', '#diffSkip', function () {
			$feed.find('.mw-rtrc-item[data-rcid="' + currentDiffRcid + '"]').addClass('mw-rtrc-item-skipped');
			// Add to array, to re-add class after refresh
			skippedRCIDs.push(currentDiffRcid);
			nextDiff();
		});

		// UnskipDiff
		$wrapper.on('click', '#diffUnskip', function () {
			$feed.find('.mw-rtrc-item[data-rcid="' + currentDiffRcid + '"]').removeClass('mw-rtrc-item-skipped');
			// Remove from array, to no longer re-add class after refresh
			skippedRCIDs.splice(skippedRCIDs.indexOf(currentDiffRcid), 1);
		});

		// Show helpicons
		$('#mw-rtrc-toggleHelp').click(function (e) {
			e.preventDefault();
			$('#krRTRC_RCOptions').toggleClass('mw-rtrc-nohelp mw-rtrc-help');
		});

		// Link helpicons
		$('.mw-rtrc-settings .helpicon')
			.attr('title', msg('helpicon-tooltip'))
			.click(function (e) {
				e.preventDefault();
				window.open(docUrl + '#' + $(this).attr('section'), '_blank');
			});

		// Mark as patrolled when rollbacking
		// Note: As of MediaWiki r(unknown) rollbacking does already automatically patrol all reverted revisions.
		// But by doing it anyway it saves a click for the AutoDiff-users
		$wrapper.on('click', '.mw-rollback-link a', function () {
			$('.patrollink a').click();
		});

		// Button: Pause
		$('#rc-options-pause').click(function () {
			if (!this.checked) {
				// Unpause
				updateFeedNow();
				return;
			}
			clearTimeout(updateFeedTimeout);
		});
	}

	function showUnsupported() {
		$('#content').empty().append(
			$('<p>').addClass('errorbox').text(
				'This program requires functionality not supported in this browser.'
			)
		);
	}

	/**
	 * @param {string} [errMsg]
	 */
	function showFail(errMsg) {
		$('#content').empty().append(
			$('<p>').addClass('errorbox').text(errMsg || 'An unexpected error occurred.')
		);
	}

	/**
	 * Init functions
	 * -------------------------------------------------
	 */

	/**
	 * Fetches all external data we need.
	 *
	 * This runs in parallel with loading of modules and i18n.
	 *
	 * @return {jQuery.Promise}
	 */
	function initData() {
		var dRights = $.Deferred(),
			promises = [
				dRights.promise()
			];

		// Get userrights
		mw.loader.using('mediawiki.user', function () {
			mw.user.getRights(function (rights) {
				if ($.inArray('patrol', rights) !== -1) {
					userHasPatrolRight = true;
				}
				dRights.resolve();
			});
		});

		// Get MediaWiki interface messages
		promises.push(
			mw.loader.using('mediawiki.api.messages').then(function () {
				return new mw.Api().loadMessages([
					'blanknamespace',
					'contributions',
					'contribslink',
					'diff',
					'markaspatrolleddiff',
					'markedaspatrolled',
					'markedaspatrollederror',
					'namespaces',
					'namespacesall',
					'next',
					'talkpagelinktext'
				]);
			})
		);

		promises.push($.ajax({
			url: apiUrl,
			dataType: 'json',
			data: {
				format: 'json',
				action: 'query',
				list: 'tags',
				tgprop: 'displayname'
			}
		}).done(function (data) {
			var tags = data.query && data.query.tags;
			if (tags) {
				rcTags = $.map(tags, function (tag) {
					return tag.name;
				});
			}
		}));

		promises.push($.ajax({
			url: apiUrl,
			dataType: 'json',
			data: {
				format: 'json',
				action: 'query',
				meta: 'siteinfo'
			}
		}).done(function (data) {
			wikiTimeOffset = (data.query && data.query.general.timeoffset) || 0;
		}));

		return $.when.apply(null, promises);
	}

	/**
	 * @return {jQuery.Promise}
	 */
	function init() {
		var dModules, dI18N, featureTest, $navToggle, dOres;

		// Transform title and navigation tabs
		document.title = 'RTRC: ' + conf.wgDBname;
		$(function () {
			$('#p-namespaces ul')
				.find('li.selected')
					.removeClass('new')
					.find('a')
						.text('RTRC');
		});

		featureTest = !!(Date.UTC);

		if (!featureTest) {
			$(showUnsupported);
			return;
		}

		// These selectors from vector-hd conflict with mw-rtrc-available
		$('.vector-animateLayout').removeClass('vector-animateLayout');

		$('html').addClass('mw-rtrc-available');

		if (navSupported) {
			$('html').addClass('mw-rtrc-sidebar-toggleable');
			$(function () {
				$('body').append(
					$('<div>').addClass('mw-rtrc-sidebar-cover'),
					$navToggle = $('<div>')
						.addClass('mw-rtrc-navtoggle')
						.on('click', function () {
							$('html').toggleClass('mw-rtrc-sidebar-on').removeClass('mw-rtrc-sidebar-peak');
						})
						.hover(function () {
							$('html').addClass('mw-rtrc-sidebar-peak');
						}, function () {
							$('html').removeClass('mw-rtrc-sidebar-peak');
						})
				);
			});
		}

		dModules = mw.loader.using([
			'json',
			'mediawiki.action.history.diff',
			'mediawiki.jqueryMsg',
			'mediawiki.Uri',
			'mediawiki.user',
			'mediawiki.util',
			'mediawiki.api',
			'mediawiki.api.messages'
		]);

		if (!mw.libs.getIntuition) {
			mw.libs.getIntuition = $.ajax({ url: intuitionLoadUrl, dataType: 'script', cache: true, timeout: 7000 /*ms*/ });
		}

		dOres = $.ajax({
			url: oresApiUrl,
			dataType: $.support.cors ? 'json' : 'jsonp',
			cache: true,
			timeout: 2000
		}).then(function (data) {
			if (data && data.models) {
				if (data.models.damaging) {
					oresModel = 'damaging';
				} else if (data.models.reverted) {
					oresModel = 'reverted';
				}
			}
		}, function () {
			// If ORES doesn't have models for this wiki, do continue loading without
			return $.Deferred().resolve();
		});

		dI18N = mw.libs.getIntuition
			.then(function () {
				return mw.libs.intuition.load('rtrc');
			})
			.then(function () {
				message = $.proxy(mw.libs.intuition.message, null, 'rtrc');
				msg = $.proxy(mw.libs.intuition.msg, null, 'rtrc');
			}, function () {
				// Ignore failure. RTRC should load even if Labs is down.
				// Fallback to displaying message keys.
				mw.messages.set('intuition-i18n-gone', '$1');
				message = function (key) {
					return mw.message('intuition-i18n-gone', key);
				};
				msg = function (key) {
					return key;
				};
				return $.Deferred().resolve();
			});

		$.when(initData(), dModules, dI18N, dOres, $.ready).fail(showFail).done(function () {
			if ($navToggle) {
				$navToggle.attr('title', msg('navtoggle-tooltip'));
			}

			// Map over months
			monthNames = msg('months').split(',');

			buildInterface();
			readPermalink();
			bindInterface();
		});
	}

	/**
	 * Execution
	 * -------------------------------------------------
	 */

	// On every page
	$(function () {
		if (!$('#t-rtrc').length) {
			mw.loader.using('mediawiki.util', function () {
				mw.util.addPortletLink(
					'p-tb',
					mw.util.getUrl('Special:BlankPage/RTRC'),
					'RTRC',
					't-rtrc',
					'Monitor and patrol recent changes in real-time',
					null,
					'#t-specialpages'
				);
			});
		}
	});

	// Initialise if in the right context
	if (
		(conf.wgTitle === 'Krinkle/RTRC' && conf.wgAction === 'view') ||
		(conf.wgCanonicalSpecialPageName === 'Blankpage' && conf.wgTitle.split('/', 2)[1] === 'RTRC')
	) {
		init();
	}

}(jQuery, mediaWiki));
