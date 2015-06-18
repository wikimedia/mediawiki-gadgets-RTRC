/**
 * Real-Time Recent Changes
 * https://github.com/Krinkle/mw-gadget-rtrc
 *
 * @license http://krinkle.mit-license.org/
 * @author Timo Tijhof, 2010–2015
 */
/*global alert */
(function ($, mw) {
	'use strict';

	/**
	 * Configuration
	 * -------------------------------------------------
	 */
	var
	appVersion = 'v1.0.1',
	conf = mw.config.get([
		'skin',
		'wgAction',
		'wgCanonicalSpecialPageName',
		'wgPageName',
		'wgServer',
		'wgTitle',
		'wgUserLanguage',
		'wgDBname',
		'wgScriptPath',
		'wgScriptExtension'
	]),
	// Can't use mw.util.wikiScript until after #init
	apiUrl = conf.wgScriptPath + '/api' + conf.wgScriptExtension,
	cvnApiUrl = '//cvn.wmflabs.org/api.php',
	intuitionLoadUrl = '//tools.wmflabs.org/intuition/load.php?env=mw',
	docUrl = '//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes?uselang=' + conf.wgUserLanguage,
	// 32x32px
	ajaxLoaderUrl = '//upload.wikimedia.org/wikipedia/commons/d/de/Ajax-loader.gif',
	patrolCacheSize = 20,

	/**
	 * Info from the wiki
	 * -------------------------------------------------
	 */
	userHasPatrolRight = false,
	userPatrolTokenCache = false,
	rcTags = [],
	wikiTimeOffset,

	/**
	 * State
	 * -------------------------------------------------
	 */
	updateFeedTimeout,

	rcPrevDayHeading,
	skippedRCIDs = [],
	patrolledRCIDs = [],
	monthNames,

	prevFeedHtml,
	isUpdating = false,

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
			// Show filters: exclude, include, filter
			showAnonOnly: false,
			showUnpatrolledOnly: false,
			limit: 25,
			// Type filters are "show matches only"
			typeEdit: false,
			typeNew: false
		},

		app: {
			refresh: 3,
			cvnDB: false,
			massPatrol: false,
			autoDiff: false
		}
	},
	opt = $(true, {}, defOpt),

	timeUtil,
	message,
	msg,
	navCollapsed,
	navSupported = conf.skin === 'vector' && !!window.localStorage,
	nextFrame = window.requestAnimationFrame || setTimeout,

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
			commentHtml, el, item;

		// Get size difference (can be negative, zero or positive)
		diffsize = rc.newlen - rc.oldlen;

		// Convert undefined/empty-string values from API into booleans
		isUnpatrolled = rc.unpatrolled !== undefined;
		isAnon = rc.anon !== undefined;

		// typeSymbol, diffLink & itemClass
		typeSymbol = '&nbsp;';
		itemClass = '';

		if (rc.type === 'new') {
			typeSymbol += '<span class="newpage">N</span>';
		}

		if ((rc.type === 'edit' || rc.type === 'new') && userHasPatrolRight && isUnpatrolled) {
			typeSymbol += '<span class="unpatrolled">!</span>';
		}

		commentHtml = rc.parsedcomment;

		// Check if edit summary is an AES
		if (commentHtml.indexOf('<a href="/wiki/Commons:AES" class="mw-redirect" title="Commons:AES">\u2190</a>') === 0) {
			// TODO: This is specific to commons.wikimedia.org
			itemClass += ' mw-rtrc-item-aes';
		}

		// Anon-attribute
		if (isAnon) {
			itemClass = ' mw-rtrc-item-anon';
		} else {
			itemClass = ' mw-rtrc-item-liu';
		}
/*
	Example:

	<div class="mw-rtrc-item mw-rtrc-item-patrolled" data-diff="0" data-rcid="0" user="Abc">
		<div diff>(<a class="diff" href="//">diff</a>)</div>
		<div type><span class="unpatrolled">!</span></div>
		<div timetitle>00:00 <a href="//?rcid=0" target="_blank">Abc</a></div>
		<div user><a class="user" href="//User:Abc">Abc</a></div>
		<div other><a href="//User talk:Abc">talk</a> / <a href="//Special:Contributions/Abc">contribs</a>&nbsp;<span class="comment">Abc</span></div>
		<div size><span class="mw-plusminus-null">(0)</span></div>
	</div>
*/
		// build & return item
		item = buildRcDayHead(timeUtil.newDateFromApi(rc.timestamp));
		item += '<div class="mw-rtrc-item ' + itemClass + '" data-diff="' + rc.revid + '" data-rcid="' + rc.rcid + '" user="' + rc.user + '">';

		if (rc.type === 'edit') {
			diffLink = '<a class="rcitemlink diff" href="' +
				mw.util.wikiScript() + '?diff=' + rc.revid + '&oldid=' + rc.old_revid + '&rcid=' + rc.rcid +
				'">' + mw.message('diff').escaped() + '</a>';
		} else if (rc.type === 'new') {
			diffLink = '<a class="rcitemlink newPage">new</a>';
		} else {
			diffLink = mw.message('diff').escaped();
		}

		item += '<div first>(' + diffLink + ') ' + typeSymbol + ' ';
		item += timeUtil.getClocktimeFromApi(rc.timestamp) + ' <a class="page" href="' + mw.util.getUrl(rc.title) + '?rcid=' + rc.rcid + '" target="_blank">' + rc.title + '</a></div>';
		item += '<div user>&nbsp;<small>&middot;&nbsp;<a href="' + mw.util.getUrl('User talk:' + rc.user) + '" target="_blank">T</a> &middot; <a href="' + mw.util.getUrl('Special:Contributions/' + rc.user) + '" target="_blank">C</a>&nbsp;</small>&middot;&nbsp;<a class="user" href="' + mw.util.getUrl((mw.util.isIPv4Address(rc.user) || mw.util.isIPv6Address(rc.user) ? 'Special:Contributions/' : 'User:') + rc.user) + '" target="_blank">' + rc.user + '</a></div>';
		item += '<div other>&nbsp;<span class="comment">' + commentHtml + '</span></div>';

		if (diffsize > 0) {
			el = diffsize > 399 ? 'strong' : 'span';
			item += '<div size><' + el + ' class="mw-plusminus-pos">(' + diffsize + ')</' + el + '></div>';
		} else if (diffsize === 0) {
			item += '<div size><span class="mw-plusminus-null">(0)</span></div>';
		} else {
			el = diffsize < -399 ? 'strong' : 'span';
			item += '<div size><' + el + ' class="mw-plusminus-neg">(' + diffsize + ')</' + el + '></div>';
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

		// MassPatrol requires AutoDiff
		if (newOpt.app.massPatrol && !newOpt.app.autoDiff) {
			newOpt.app.autoDiff = true;
			mod = true;
		}

		return !mod;
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
			case 'showAnonOnly':
			case 'showUnpatrolledOnly':
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
				case 'showAnonOnly':
				case 'showUnpatrolledOnly':
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
			if (defOpt.app[key] !== value) {
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

	// Read permalink into the program and reflect into settings form.
	// TODO: Refactor into init, as this does more than read permalink.
	// It also inits the settings form and handles kickstart
	function readPermalink() {
		var url = new mw.Uri(),
			newOpt = url.query.opt,
			kickstart = url.query.kickstart;

		newOpt = newOpt ? JSON.parse(newOpt) : {};

		newOpt = $.extend(true, {}, defOpt, newOpt);

		normaliseSettings(newOpt, 'quiet');

		fillSettingsForm(newOpt);

		opt = newOpt;

		if (kickstart === '1') {
			updateFeedNow();
			if ($wrapper[0].scrollIntoView) {
				$wrapper[0].scrollIntoView();
			}
		}
	}

	function getApiRcParams(rc) {
		var rcprop = [
				'flags',
				'timestamp',
				'user',
				'title',
				'parsedcomment',
				'sizes',
				'ids'
			],
			rcshow = ['!bot'],
			rctype = [],
			params = {};

		params.rcdir = rc.dir;

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

		// params.titles: Title filter option (rctitles) is no longer supported by MediaWiki,
		// see https://bugzilla.wikimedia.org/show_bug.cgi?id=12394#c5.

		if (rc.tag !== undefined) {
			params.rctag = rc.tag;
		}

		if (userHasPatrolRight) {
			rcprop.push('patrolled');
		}

		params.rcprop = rcprop.join('|');

		if (rc.showAnonOnly) {
			rcshow.push('anon');
		}

		if (rc.showUnpatrolledOnly) {
			rcshow.push('!patrolled');
		}

		params.rcshow = rcshow.join('|');

		params.rclimit = rc.limit;

		if (rc.typeEdit) {
			rctype.push('edit');
		}

		if (rc.typeNew) {
			rctype.push('new');
		}

		params.rctype = rctype.length ? rctype.join('|') : 'edit|new';

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
			} else if ($.inArray(rcid, patrolledRCIDs) !== -1) {
				$el.addClass('mw-rtrc-item-patrolled');
			} else if (rcid === currentDiffRcid) {
				$el.addClass('mw-rtrc-item-current');
			}
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

		// Schedule next update
		updateFeedTimeout = setTimeout(updateFeed, opt.app.refresh * 1000);
		$('#krRTRC_loader').hide();
	}

	function applyCvnAnnotations($feedContent, callback) {
		var users;

		// Find all user names inside the feed
		users = [];
		$feedContent.filter('.mw-rtrc-item').each(function () {
			var user = $(this).attr('user');
			// Keep the list values unique to avoid overly long
			// query strings.
			if (user && $.inArray(user, users) === -1) {
				users.push(user);
			}
		});

		if (!users.length) {
			callback();
			return;
		}

		$.ajax({
			url: cvnApiUrl,
			data: {
				users: users.join('|')
			},
			timeout: 2000,
			dataType: 'jsonp',
			// Don't append invalid "&_=.." query
			cache: true
		})
		.fail(function () {
			callback();
		})
		.done(function (data) {
			var d;

			if (!data.users) {
				callback();
				return;
			}

			// Loop through all users
			$.each(data.users, function (name, user) {
				var tooltip;

				// Only if blacklisted, otherwise dont highlight
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

					// Apply blacklisted-class, and insert icon with tooltip
					$feedContent
						.filter('.mw-rtrc-item')
						.filter(function () {
							return $(this).attr('user') === name;
						})
						.find('.user')
						.addClass('blacklisted')
						.attr('title', tooltip);
				}

			});

			// Either way, push the feed to the frontend
			callback();

			d = new Date();
			d.setTime(data.lastUpdate * 1000);
			$feed.find('.mw-rtrc-feed-cvninfo').text('CVN DB ' + msg('lastupdate-cvn', d.toUTCString()));
		});
	}

	function updateFeedNow() {
		$('#rc-options-pause').prop('checked', false);
		clearTimeout(updateFeedTimeout);
		updateFeed();
	}

	function updateFeed() {
		var rcparams;
		if (!isUpdating) {

			// Indicate updating
			$('#krRTRC_loader').show();
			isUpdating = true;

			// Download recent changes

			rcparams = getApiRcParams(opt.rc);
			rcparams.format = 'json';
			rcparams.action = 'query';
			rcparams.list = 'recentchanges';

			$.ajax({
				url: apiUrl,
				dataType: 'json',
				data: rcparams
			}).fail(function () {
				var feedContentHTML = '<h3>Downloading recent changes failed</h3>';
				pushFeedContent({
					$feedContent: $(feedContentHTML),
					rawHtml: feedContentHTML
				});
				isUpdating = false;
				$RCOptionsSubmit.prop('disabled', false).css('opacity', '1.0');

			}).done(function (data) {
				var recentchanges, $feedContent, feedContentHTML = '';

				if (data.error) {
					$body.removeClass('placeholder');

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
				if (opt.app.cvnDB) {
					applyCvnAnnotations($feedContent, function () {
						pushFeedContent({
							$feedContent: $feedContent,
							rawHtml: feedContentHTML
						});
						isUpdating = false;
					});
				} else {
					pushFeedContent({
						$feedContent: $feedContent,
						rawHtml: feedContentHTML
					});
					isUpdating = false;
				}

				$RCOptionsSubmit.prop('disabled', false).css('opacity', '1.0');
			});
		}
	}

	function nextDiff() {
		var $lis = $feed.find('.mw-rtrc-item:not(.mw-rtrc-item-current, .mw-rtrc-item-patrolled, .mw-rtrc-item-skipped)');
		$lis.eq(0).find('a.rcitemlink').click();
	}

	function toggleMassPatrol(b) {
		if (b === true) {
			if (!currentDiff) {
				nextDiff();
			} else {
				$('.patrollink a').click();
			}
		}
	}

	function navToggle() {
		navCollapsed = String(navCollapsed !== 'true');
		$('html').toggleClass('mw-rtrc-navtoggle-collapsed');
		localStorage.setItem('mw-rtrc-navtoggle-collapsed', navCollapsed);
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
				'Real-Time Recent Changes <small>(' + appVersion + ')</small>' +
				'<div class="mw-rtrc-head-links">' +
					(!mw.user.isAnon() ? (
						'<a target="_blank" href="' + mw.util.getUrl('Special:Log/patrol') + '?user=' + encodeURIComponent(mw.user.getName()) + '">' +
							message('mypatrollog').escaped() +
						'</a>') :
						''
					) +
					'<a id="mw-rtrc-toggleHelp">Help</a>' +
				'</div>' +
			'</div>' +
			'<form id="krRTRC_RCOptions" class="mw-rtrc-settings mw-rtrc-nohelp make-switch"><fieldset>' +
				'<div class="panel-group">' +
					'<div class="panel">' +
						'<label for="mw-rtrc-settings-limit" class="head">' + message('limit').escaped() + '</label>' +
						'<select id="mw-rtrc-settings-limit" name="limit">' +
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
						'<label class="head">' + message('filter').escaped() + '</label>' +
						'<div style="text-align: left;">' +
							'<label>' +
								'<input type="checkbox" name="showAnonOnly" />' +
								' ' + message('showAnonOnly').escaped() +
							'</label>' +
							'<br />' +
							'<label>' +
								'<input type="checkbox" name="showUnpatrolledOnly" />' +
								' ' + message('showUnpatrolledOnly').escaped() +
							'</label>' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label for="mw-rtrc-settings-user" class="head">' +
							message('userfilter').escaped() +
							'<span section="Userfilter" class="helpicon"></span>' +
						'</label>' +
						'<div style="text-align: center;">' +
							'<input type="text" size="16" id="mw-rtrc-settings-user" name="user" />' +
							'<br />' +
							'<input class="button button-small" type="button" id="mw-rtrc-settings-user-clr" value="' + message('clear').escaped() + '" />' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' + message('type').escaped() + '</label>' +
						'<div style="text-align: left;">' +
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
						'<label class="head">' +
							message('timeframe').escaped() +
							'<span section="Timeframe" class="helpicon"></span>' +
						'</label>' +
						'<div style="text-align: right;">' +
							'<label>' +
								message('time-from').escaped() + ': ' +
								'<input type="text" size="18" name="start" />' +
							'</label>' +
							'<br />' +
							'<label>' +
								message('time-untill').escaped() + ': ' +
								'<input type="text" size="18" name="end" />' +
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
							message('order').escaped() +
							' <br />' +
							'<span section="Order" class="helpicon"></span>' +
						'</label>' +
						'<div style="text-align: left;">' +
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
							'R<br />' +
							'<span section="Reload_Interval" class="helpicon"></span>' +
						'</label>' +
						'<input type="number" value="3" min="0" max="99" size="2" id="mw-rtrc-settings-refresh" name="refresh" />' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							'CVN DB<br />' +
							'<span section="IRC_Blacklist" class="helpicon"></span>' +
							'<input type="checkbox" class="switch" name="cvnDB" />' +
						'</label>' +
					'</div>' +
					'<div class="panel panel-last">' +
						'<input class="button" type="button" id="RCOptions_submit" value="' + message('apply').escaped() + '" />' +
					'</div>' +
				'</div>' +
				'<div class="panel-group panel-group-mini">' +
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
							'MassPatrol' +
							'<span section="MassPatrol" class="helpicon"></span>' +
							'<input type="checkbox" class="switch" name="massPatrol" />' +
						'</label>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							'AutoDiff' +
							'<span section="AutoDiff" class="helpicon"></span>' +
							'<input type="checkbox" class="switch" name="autoDiff" />' +
						'</label>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							'Pause' +
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
					'<small class="mw-rtrc-feed-cvninfo"></small>' +
				'</div>' +
				'<img src="' + ajaxLoaderUrl + '" id="krRTRC_loader" style="display: none;" />' +
				'<div class="mw-rtrc-legend">' +
					'Colors: <div class="mw-rtrc-item mw-rtrc-item-patrolled inline-block">&nbsp;' +
					mw.message('markedaspatrolled').escaped() + '&nbsp;</div>, <div class="mw-rtrc-item mw-rtrc-item-current inline-block">&nbsp;' +
					message('currentedit').escaped() + '&nbsp;</div>, ' +
					'<div class="mw-rtrc-item mw-rtrc-item-skipped inline-block">&nbsp;' + message('skippededit').escaped() + '&nbsp;</div>, ' +
					'<div class="mw-rtrc-item mw-rtrc-item-aes inline-block">&nbsp;Edit with an Automatic Edit Summary&nbsp;</div>' +
					'<br />Abbreviations: T - ' + mw.message('talkpagelinktext').escaped() + ', C - ' + mw.message('contributions', mw.user).escaped() +
				'</div>' +
			'</div>' +
			'<div style="clear: both;"></div>' +
			'<div class="mw-rtrc-foot">' +
				'<div class="plainlinks" style="text-align: right;">' +
					'Real-Time Recent Changes by ' +
					'<a href="//meta.wikimedia.org/wiki/User:Krinkle" class="external text" rel="nofollow">Krinkle</a>' +
					' | <a href="//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes" class="external text" rel="nofollow">' + message('documentation').escaped() + '</a>' +
					' | <a href="https://github.com/Krinkle/mw-gadget-rtrc/releases" class="external text" rel="nofollow">' + message('changelog').escaped() + '</a>' +
					' | <a href="https://github.com/Krinkle/mw-gadget-rtrc/issues" class="external text" rel="nofollow">Feedback</a>' +
					' | <a href="http://krinkle.mit-license.org" class="external text" rel="nofollow">License</a>' +
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
		nextFrame(function () {
			$('html').addClass('mw-rtrc-ready');
		});

		$body = $wrapper.find('.mw-rtrc-body');
		$feed = $body.find('.mw-rtrc-feed');
	}

	// Bind event hanlders in the user interface
	function bindInterface() {

		$RCOptionsSubmit = $('#RCOptions_submit');

		// Apply button
		$RCOptionsSubmit.click(function () {
			$RCOptionsSubmit.prop('disabled', true).css('opacity', '0.5');

			readSettingsForm();

			toggleMassPatrol(opt.app.massPatrol);

			updateFeedNow();
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
				var skipButtonHtml;
				if ($.inArray(currentDiffRcid, skippedRCIDs) !== -1) {
					skipButtonHtml = '<span class="tab"><a id="diffUnskip">Unskip</a></span>';
				} else {
					skipButtonHtml = '<span class="tab"><a id="diffSkip">Skip</a></span>';
				}

				$frame
					.html(data)
					.prepend(
						'<h3>' + mw.html.escape(title) + '</h3>' +
						'<div class="mw-rtrc-diff-tools">' +
							'<span class="tab"><a id="diffClose">Close</a></span>' +
							'<span class="tab"><a href="' + href + '" target="_blank" id="diffNewWindow">Open in Wiki</a></span>' +
							(userPatrolTokenCache ?
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
					skipButtonHtml = '<span class="tab"><a id="diffUnskip">Unskip</a></span>';
				} else {
					skipButtonHtml = '<span class="tab"><a id="diffSkip">Skip</a></span>';
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
			$.ajax({
				type: 'POST',
				url: apiUrl,
				dataType: 'json',
				data: {
					action: 'patrol',
					format: 'json',
					list: 'recentchanges',
					rcid: currentDiffRcid,
					token: userPatrolTokenCache
				}
			}).done(function (data) {
				if (!data || data.error) {
					$el.empty().append(
						$('<span style="color: red;"></span>').text(mw.msg('markedaspatrollederror'))
					);
					mw.log('Patrol error:', data);
				} else {
					$el.empty().append(
						$('<span style="color: green;"></span>').text(mw.msg('markedaspatrolled'))
					);
					$feed.find('.mw-rtrc-item[data-rcid="' + currentDiffRcid + '"]').addClass('mw-rtrc-item-patrolled');

					// Patrolling/Refreshing sometimes overlap eachother causing patrolled edits to show up in an 'unpatrolled only' feed.
					// Make sure that any patrolled edits stay marked as such to prevent AutoDiff from picking a patrolled edit
					patrolledRCIDs.push(currentDiffRcid);

					while (patrolledRCIDs.length > patrolCacheSize) {
						patrolledRCIDs.shift();
					}

					if (opt.app.autoDiff) {
						nextDiff();
					}
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

		// Clear rcuser-field
		// If MassPatrol is active, warn that clearing rcuser will automatically disable MassPatrol f
		$('#mw-rtrc-settings-user-clr').click(function () {
			$('#mw-rtrc-settings-user').val('');
		});

		// Mark as patrolled when rollbacking
		// Note: As of MediaWiki r(unknown) rollbacking does already automatically patrol all reverted revisions.
		// But by doing it anyway it saves a click for the AutoDiff-users
		$wrapper.on('click', '.mw-rollback-link a', function () {
			$('.patrollink a').click();
		});

		// Button: Pause
		$('#rc-options-pause').click(function () {
			if (this.checked) {
				clearTimeout(updateFeedTimeout);
				return;
			}
			updateFeedNow();
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
			promises = [dRights.promise()];

		// Get userrights
		mw.loader.using('mediawiki.user', function () {
			mw.user.getRights(function (rights) {
				if ($.inArray('patrol', rights) !== -1) {
					userHasPatrolRight = true;
				}
				dRights.resolve();
			});
		});

		// Get a patroltoken
		promises.push($.ajax({
			url: apiUrl,
			dataType: 'json',
			data: {
				format: 'json',
				action: 'tokens',
				type: 'patrol'
			}
		}).done(function (data) {
			userPatrolTokenCache = data.tokens.patroltoken;
		}));

		// Get MediaWiki interface messages
		promises.push($.ajax({
			url: apiUrl,
			dataType: 'json',
			data: {
				action: 'query',
				format: 'json',
				meta: 'allmessages',
				amlang: conf.wgUserLanguage,
				ammessages: ([
					'ascending abbrev',
					'blanknamespace',
					'contributions',
					'descending abbrev',
					'diff',
					'hide',
					'markaspatrolleddiff',
					'markedaspatrolled',
					'markedaspatrollederror',
					'namespaces',
					'namespacesall',
					'next',
					'recentchanges-label-bot',
					'recentchanges-label-minor',
					'recentchanges-label-newpage',
					'recentchanges-label-unpatrolled',
					'show',
					'talkpagelinktext'
				].join('|'))
			}
		}).done(function (data) {
			data = data.query.allmessages;
			for (var i = 0; i < data.length; i++) {
				mw.messages.set(data[i].name, data[i]['*']);
			}
		}));

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
		var dModules, dI18N, featureTest;

		// Transform title and navigation tabs
		document.title = 'RTRC: ' + conf.wgDBname;
		$(function () {
			$('#p-namespaces ul')
				.find('li.selected')
					.removeClass('new')
					.find('a')
						.text('RTRC');
		});

		featureTest = !!(
			// For timeUtil
			Date.UTC &&
			// For CSS :before and :before
			$.support.modernizr4rtrc.generatedcontent
		);

		if (!featureTest) {
			$(showUnsupported);
			return;
		}

		// These selectors from vector-hd conflict with mw-rtrc-available
		$('.vector-animateLayout').removeClass('vector-animateLayout');

		$('html').addClass('mw-rtrc-available');

		if (navSupported) {
			// Apply stored setting
			navCollapsed = localStorage.getItem('mw-rtrc-navtoggle-collapsed') || 'true';
			if (navCollapsed === 'true') {
				$('html').toggleClass('mw-rtrc-navtoggle-collapsed');
			}
		}

		dModules = mw.loader.using([
			'json',
			'mediawiki.action.history.diff',
			'mediawiki.jqueryMsg',
			'mediawiki.Uri',
			'mediawiki.user',
			'mediawiki.util'
		]);

		if (!mw.libs.getIntuition) {
			mw.libs.getIntuition = $.ajax({ url: intuitionLoadUrl, dataType: 'script', cache: true, timeout: 7000 /*ms*/ });
		}

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

		$.when(initData(), dModules, dI18N, $.ready).fail(showFail).done(function () {

			// Set up DOM for navtoggle
			if (navSupported) {
				// Needs i18n and $.ready
				$('body').append(
					$('#p-logo')
						.clone()
							.removeAttr('id')
							.addClass('mw-rtrc-navtoggle-logo'),
					$('<div>')
						.addClass('mw-rtrc-navtoggle')
						.attr('title', msg('navtoggle-tooltip'))
						.on('click', navToggle)
				);
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

	/**
	 * Modernizr 2.8.3 (Custom Build) | MIT & BSD
	 * Build: http://modernizr.com/download/#-generatedcontent-teststyles
	 *
	 * Customized further for inclusion in mw-gadget-rtrc:
	 * - Remove unused utilities.
	 * - Export to jQuery.support.modernizr4rtrc instead of window.Modernizr.
	 * - Ensure <style> is cleaned up by appending it to <div> instead of <body>,
	 *   or by also removing the <style> afterwards, like the <div>.
	 */
	(function () {
		function injectElementWithStyles(rule, callback) {
			var style, ret,
				mod = 'modernizr',
				div = document.createElement('div'),
				body = document.body;

			style = document.createElement('style');
			style.type = 'text/css';
			style.id = 's' + mod;

			div.appendChild(style);
			body.appendChild(div);

			if (style.styleSheet) {
				style.styleSheet.cssText = rule;
			} else {
				style.appendChild(document.createTextNode(rule));
			}
			div.id = mod;

			ret = callback(div);
			// Clean up <div> and its <style>
			body.removeChild(div);

			return !!ret;
		}

		$.support.modernizr4rtrc = {
			generatedcontent: injectElementWithStyles('#modernizr{font:0/0 a}#modernizr:after{content:":)";visibility:hidden;font:7px/1 a}', function (node) {
				return node.offsetHeight >= 7;
			})
		};
	})();

	// Initialise if in the right context
	if (
		(conf.wgTitle === 'Krinkle/RTRC' && conf.wgAction === 'view') ||
		(conf.wgCanonicalSpecialPageName === 'Blankpage' && conf.wgTitle.split('/', 2)[1] === 'RTRC')
	) {
		init();
	}

}(jQuery, mediaWiki));
