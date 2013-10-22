/**
 * Real-Time Recent Changes
 * https://github.com/Krinkle/mw-gadget-rtrc
 *
 * @license http://krinkle.mit-license.org/
 * @author Timo Tijhof, 2010–2013
 */
/*global alert */
(function ($, mw) {
	'use strict';

	/**
	 * App configuration
	 * -------------------------------------------------
	 */
	var
	appVersion = 'v0.9.6',
	apiUrl = mw.util.wikiScript('api'),
	conf = mw.config.get([
		'skin',
		'wgAction',
		'wgCanonicalSpecialPageName',
		'wgPageName',
		'wgServer',
		'wgTitle',
		'wgUserLanguage'
	]),
	// 32x32px
	cvnApiUrl = '//cvn.wmflabs.org/api.php',
	intuitionLoadUrl = '//tools.wmflabs.org/intuition/load.php?env=mw',
	docUrl = '//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes?uselang=' + conf.wgUserLanguage,
	ajaxLoaderUrl = '//upload.wikimedia.org/wikipedia/commons/d/de/Ajax-loader.gif',
	patrolCacheSize = 20,

	/**
	 * App state
	 * -------------------------------------------------
	 */
	userHasPatrolRight = false,
	userHasDeletedhistoryRight = false,
	userPatrolTokenCache = false,
	rcRefreshTimeout,
	rcRefreshEnabled = false,

	rcPrevDayHeading,
	skippedRCIDs = [],
	patrolledRCIDs = [],
	monthNames,

	skipButtonHtml = '',
	prevFeedHtml,
	// Difference UTC vs. wiki - fetched from siteinfo/timeoffset, in minutes
	wikiTimeOffset = 0,
	wikiId = 'unknown', // wgDBname
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

	krRTRC_initFuncs,
	krRTRC_initFuncs2,
	timeUtil,
	dModules,
	dI18N,
	message,
	msg,
	navCollapsed,
	navSupported,

	currentDiff,
	currentDiffRcid,
	$wrapper, $body, $feed,
	$RCOptions_submit;

	/**
	 * Utility functions
	 * -------------------------------------------------
	 */

	if (!String.prototype.ucFirst) {
		String.prototype.ucFirst = function () {
			// http://jsperf.com/ucfirst/4
			// http://jsperf.com/ucfirst-replace-vs-substr/3
			// str.charAt(0).toUpperCase() + str.substr(1);
			// str[0].toUpperCase() + str.slice(1);
			// str.charAt(0).toUpperCase() + str.substring(1);
			// str.substr(0, 1).toUpperCase() + str.substr(1, this.length);
			return this.charAt(0).toUpperCase() + this.substring(1);
		};
	}

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
			s = String(s)
				// Convert to Date-readable
				// Example: "2010-04-25T23:24:02Z" => "2010/04/25 23:24:02"
				.replace('-', '/')
				.replace('-', '/')
				.replace('T', ' ')
				.replace('Z', '');
			return new Date(s);
		},

		// Get clocktime string adjusted to timezone of wiki
		// from MediaWiki timestamp string
		getClocktimeFromApi: function (s) {
			var d, msd;
			d = timeUtil.newDateFromApi(s);
			// Get difference in miliseconds
			msd = wikiTimeOffset * 60 * 1000;
			// Adjust object to difference
			d.setTime(d.getTime() + msd);
			return leadingZero(d.getHours()) + ':' + leadingZero(d.getMinutes()); // Return clocktime with leading zeros
		}
	};

	// Searches an array for the giving string
	// MUST be loose comparison
	function krInArray(s, array) {
		/*jshint eqeqeq:false */
		var i;
		for (i = 0; i < array.length; i += 1) {
			if (array[i] == s) {
				return true;
			}
		}
		return false;
	}


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
		var diffsize, isPatrolled, isAnon,
			typeSymbol, itemClass, diffLink,
			commentHtml, el, item;

		// Get size difference (can be negative, zero or positive)
		diffsize = rc.newlen - rc.oldlen;

		// Convert undefined/empty-string values from API into booleans
		isPatrolled = rc.patrolled !== undefined;
		isAnon = rc.anon !== undefined;

		// typeSymbol, diffLink & itemClass
		typeSymbol = '&nbsp;';
		itemClass = '';

		if (rc.type === 'new') {
			typeSymbol += '<span class="newpage">N</span>';
		}

		if ((rc.type === 'edit' || rc.type === 'new') && userHasPatrolRight && !isPatrolled) {
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

	<div class="mw-rtrc-item mw-rtrc-item-patrolled" diff="0" user="Abc">
		<div diff>(<a class="diff" diff="0" rcid="0" href="//">diff</a>)</div>
		<div type><span class="unpatrolled">!</span></div>
		<div timetitle>00:00 <a href="//?rcid=0" target="_blank">Abc</a></div>
		<div user><a class="user" href="//User:Abc">Abc</a></div>
		<div other><a href="//User talk:Abc">talk</a> / <a href="//Special:Contributions/Abc">contribs</a>&nbsp;<span class="comment">Abc</span></div>
		<div size><span class="mw-plusminus-null">(0)</span></div>
	</div>
*/
		// build & return item
		item = buildRcDayHead(timeUtil.newDateFromApi(rc.timestamp));
		item += '<div class="mw-rtrc-item ' + itemClass + '" diff="' + rc.revid + '" rcid="' + rc.rcid + '" user="' + rc.user + '">';

		if (rc.type === 'edit') {
			diffLink = '<a class="rcitemlink diff" diff="' + rc.revid + '" rcid="' + rc.rcid + '" href="' +
				mw.util.wikiScript() + '?diff=' + rc.revid + '&oldif=' + rc.old_revid + '&rcid=' + rc.rcid +
				'">' + mw.message('diff').escaped() + '</a>';
		} else if (rc.type === 'new') {
			diffLink = '<a class="rcitemlink newPage" rcid="' + rc.rcid + '">new</a>';
		} else {
			diffLink = mw.message('diff').escaped();
		}

		item += '<div first>(' + diffLink + ') ' + typeSymbol + ' ';
		item += timeUtil.getClocktimeFromApi(rc.timestamp) + ' <a class="page" href="' + mw.util.wikiGetlink(rc.title) + '?rcid=' + rc.rcid + '" target="_blank">' + rc.title + '</a></div>';
		item += '<div user>&nbsp;<small>&middot;&nbsp;<a href="' + mw.util.wikiGetlink('User talk:' + rc.user) + '" target="_blank">T</a> &middot; <a href="' + mw.util.wikiGetlink('Special:Contributions/' + rc.user) + '" target="_blank">C</a>&nbsp;</small>&middot;&nbsp;<a class="user" href="' + mw.util.wikiGetlink('User:' + rc.user) + '" target="_blank">' + rc.user + '</a></div>';
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
		var uri = new mw.Uri(mw.util.wikiGetlink(conf.wgPageName)),
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

		reducedOpt = $.toJSON(reducedOpt);

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

		newOpt = newOpt ? $.parseJSON(newOpt): {};

		newOpt = $.extend(true, {}, defOpt, newOpt);

		normaliseSettings(newOpt, 'quiet');

		fillSettingsForm(newOpt);

		opt = newOpt;

		if (kickstart === '1') {
			krRTRC_hardRefresh();
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

		// params.tag

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

	// Called when the list is refreshed
	function krRTRC_RebindElements() {

		// Re-apply "skipped" and "patrolled" classes
		$feed.find('.mw-rtrc-item').each(function () {

			// Compare each diff-attribute to the array, if match mark item with the class

			if (krInArray($(this).attr('rcid'), skippedRCIDs)) {
				$(this).addClass('mw-rtrc-item-skipped');
			} else if (krInArray($(this).attr('rcid'), patrolledRCIDs)) {
				$(this).addClass('mw-rtrc-item-patrolled');
			}
		});

		// The current diff in diff-view stays marked
		$feed.find('.mw-rtrc-item[rcid="' + currentDiffRcid + '"]').addClass('mw-rtrc-item-current');

		// All http-links within the diff-view open in a new window
		$('#krRTRC_DiffFrame > table.diff a').filter('a[href^="http://"], a[href^="https://"], a[href^="//"]').attr('target', '_blank');

	}

	/**
	 * @param {Object} update
	 * @param {jQuery} update.$feedContent
	 * @param {string} update.rawHtml
	 */
	function pushFeedContent(update) {
		// Get current time + localtime adjustment
		var msd = wikiTimeOffset * 60 * 1000,
			// Last-update heading
			lastupdate = new Date();

		lastupdate.setTime(lastupdate.getTime() + msd);

		// TODO: Only do once
		$body.removeClass('placeholder');

		$feed.find('.mw-rtrc-feed-update').html(
			message('lastupdate-rc', lastupdate.toUTCString()).escaped() +
			' | <a href="' + getPermalink() + '">' +
			message('permalink').escaped() +
			'</a>'
		);

		if (update.rawHtml !== prevFeedHtml) {
			prevFeedHtml = update.rawHtml;
			$feed.find('.mw-rtrc-feed-content').empty().append(update.$feedContent);
			krRTRC_RebindElements();
		}

		// Reset day
		rcPrevDayHeading = undefined;
		rcRefreshTimeout = setTimeout(krRTRC_Refresh, opt.app.refresh * 1000);
		$('#krRTRC_loader').hide();
	}

	function applyCvnAnnotations($feedContent, callback) {
		var users;

		// Find all user names inside the feed
		users = [];
		$feedContent.filter('.mw-rtrc-item').each(function () {
			var user = $(this).attr('user');
			if (user) {
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
				users: users.join('|'),
			},
			dataType: 'jsonp'
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

	function krRTRC_Refresh() {
		var rcparams;
		if (rcRefreshEnabled && !isUpdating) {

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

				$RCOptions_submit.prop('disabled', false).css('opacity', '1.0');
			});
		}
	}

	function krRTRC_hardRefresh() {
		rcRefreshEnabled = true;
		$('#rc-options-pause').prop('checked', false);
		clearTimeout(rcRefreshTimeout);
		krRTRC_Refresh();
	}

	function krRTRC_NextDiff() {
		var $lis = $feed.find('.mw-rtrc-item:not(.mw-rtrc-item-current, .mw-rtrc-item-patrolled, .mw-rtrc-item-skipped)');
		$lis.eq(0).find('a.rcitemlink').click();
	}

	function krRTRC_ToggleMassPatrol(b) {
		if (b === true) {
			if (!currentDiff) {
				krRTRC_NextDiff();
			} else {
				$('.patrollink a').click();
			}
		}
	}

	function krRTRC_GetPatroltoken() {
		$.ajax({
			type: 'GET',
			url: apiUrl,
			data: {
				format: 'json',
				action: 'query',
				list: 'recentchanges',
				rctoken: 'patrol',
				rclimit: 1,
				// Using rctype=new because some wikis only have patrolling of newpages enabled.
				// If querying all changes returns an edit in that case, it won't have a token on it.
				// This workaround works as long as there are no wikis with RC-patrol but no NP-patrol.
				rctype: 'new'
			},
			dataType: 'json'
		}).done(function (data) {
			userPatrolTokenCache = data.query.recentchanges[0].patroltoken;
		});
	}

	function navToggle() {
		navCollapsed = String(navCollapsed !== 'true');
		$('html').toggleClass('mw-rtrc-navtoggle-collapsed');
		localStorage.setItem('mw-rtrc-navtoggle-collapsed', navCollapsed);
	}

	// Init Phase 1 : When the DOM is ready
	function krRTRC_init1() {
		while (krRTRC_initFuncs.length) {
			(krRTRC_initFuncs.shift())();
		}
	}

	// Init Phase 2 : Called in GetIntMsgs()
	function krRTRC_init2() {
		while (krRTRC_initFuncs2.length) {
			(krRTRC_initFuncs2.shift())();
		}
	}


/**
 * App Initiate Functions (Phase 1, pre IntMsg)
 * -------------------------------------------------
 */
	// CheckRights, GetPatrol, GetSiteinfo, GetIntMsg
	krRTRC_initFuncs = [];

	// function CheckRights()
	//
	// Checks the userrights of the current user via the API
	krRTRC_initFuncs[0] = function () {
		$.ajax({
			type: 'GET',
			url: apiUrl + '?action=query&meta=userinfo&uiprop=rights&format=xml',
			dataType: 'xml',
			success: function (rawback) {
				if ($(rawback).find('r:contains("patrol")').length) {
					$(rawback).find('r:contains("patrol")').each(function () {
						if ($(this).text() === 'patrol' && !userHasPatrolRight) {
							userHasPatrolRight = true;
						}
					});
				}
				if ($(rawback).find('r:contains("deletedhistory")').length) {
					$(rawback).find('r:contains("deletedhistory")').each(function () {
						if ($(this).text() === 'deletedhistory' && !userHasDeletedhistoryRight) {
							userHasDeletedhistoryRight = true;
						}
					});
				}
			}
		});
	};

	// function GetPatroltoken()
	//
	// Requests a patroltoken via the API
	krRTRC_initFuncs[1] = function () {
		krRTRC_GetPatroltoken();
	};

	// function GetSiteInfo()
	//
	// Downloads siteinfo via the API
	krRTRC_initFuncs[2] = function () {
		$.ajax({
			type: 'GET',
			url: apiUrl + '?action=query&meta=siteinfo&format=xml',
			dataType: 'xml',
			success: function (rawback) {
				wikiTimeOffset = $(rawback).find('general').attr('timeoffset');
				wikiId = $(rawback).find('general').attr('wikiid');
				document.title = 'RTRC: ' + wikiId;
			}
		});
	};

	// function GetIntMsgs()
	//
	// Downloads interface messages via the API
	krRTRC_initFuncs[3] = function () {

		$.ajax({
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
			for (var i = 0; i < data.length; i ++) {
				mw.messages.set(data[i].name, data[i]['*']);
			}

			// Interface messages ready, excecute init phase 2
			krRTRC_init2();
		});
	};

/**
 * App Initiate Functions (Phase 2, post IntMsg)
 * -------------------------------------------------
 */
	// Buildpage, ProcesPermalink, Bindevent
	krRTRC_initFuncs2 = [];

	// function BuildPage()
	//
	// Prepares the page
	krRTRC_initFuncs2[0] = function () {
		var ns, namespaceOptionsHtml,
			fmNs = mw.config.get('wgFormattedNamespaces');

		namespaceOptionsHtml += '<option value>' + mw.message('namespacesall').escaped() + '</option>';
		namespaceOptionsHtml += '<option value="0">' + mw.message('blanknamespace').escaped() + '</option>';

		for (ns in fmNs) {
			if (ns > 0) {
				namespaceOptionsHtml += '<option value="' + ns + '">' + fmNs[ns] + '</option>';
			}
		}

		$wrapper = $($.parseHTML(
		'<div class="mw-rtrc-wrapper">' +
			'<div class="mw-rtrc-head">' +
				'Real-Time Recent Changes <small>(' + appVersion + ')</small>' +
				'<div class="mw-rtrc-head-links">' +
					(!mw.user.isAnon() ? (
						'<a target="_blank" href="' + mw.util.wikiGetlink('Special:Log/patrol') + '?user=' + encodeURIComponent(mw.user.name()) + '">' +
							message('mypatrollog').escaped().ucFirst() +
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
							'<select class="mw-rtrc-settings-namespace" name="namespace">' +
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
						'<input type="number" value="3" min="0" max="99" id="mw-rtrc-settings-refresh" name="refresh" />' +
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
			'<div class="mw-rtrc-diff" id="krRTRC_DiffFrame" style="display: none;"></div>' +
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

		$('#content').empty().append($wrapper);
		(window.requestAnimationFrame || setTimeout)(function () {
			$('html').addClass('mw-rtrc-ready');
		});

		$body = $wrapper.find('.mw-rtrc-body');
		$feed = $body.find('.mw-rtrc-feed');
	};

	// function ProcesPermalink()
	krRTRC_initFuncs2[1] = function () {
		readPermalink();
	};

	// function Bindevents()
	//
	// Binds events to the user interface
	krRTRC_initFuncs2[2] = function () {

		$RCOptions_submit = $('#RCOptions_submit');

		// Apply button
		$RCOptions_submit.click(function () {
			$RCOptions_submit.prop('disabled', true).css('opacity', '0.5');

			readSettingsForm();

			krRTRC_ToggleMassPatrol(opt.app.massPatrol);

			krRTRC_hardRefresh();
			return false;
		});

		// Close Diff
		$('#diffClose').live('click', function () {
			$('#krRTRC_DiffFrame').fadeOut('fast');
			currentDiff = currentDiffRcid = false;
		});

		// Load diffview on (diff)-link click
		$('a.diff').live('click', function () {
			currentDiff = $(this).attr('diff');
			currentDiffRcid = $(this).attr('rcid');
			var title = $(this).parent().find('>a.page').text(),
				href = $(this).parent().find('>a.diff').attr('href');
			$('#krRTRC_DiffFrame')
			.removeAttr('style'/* this resets style="max-height: 400;" from a.newPage below */)
			.load(mw.util.wikiScript() + '?action=render&diff=' + currentDiff + '&diffonly=1&uselang=' + conf.wgUserLanguage, function () {
				$(this).html($(this).html().replace('diffonly=', 'krinkle=').replace('diffonly=', 'krinkle='));
				if (krInArray(currentDiffRcid, skippedRCIDs)) {
					skipButtonHtml = '<span class="tab"><a id="diffUnskip">Unskip</a></span>';
				} else {
					skipButtonHtml = '<span class="tab"><a id="diffSkip">Skip</a></span>';
				}
				$('#krRTRC_DiffFrame').fadeIn().prepend(
					'<h3>' + title + '</h3><div class="mw-rtrc-diff-tools"><span class="tab"><a id="diffClose">X</a></span><span class="tab"><a href="' + href + '" target="_blank" id="diffNewWindow">Open in Wiki</a></span>' +
					(userPatrolTokenCache ?
						'<span class="tab"><a onclick="(function(){ if($(\'.patrollink a\').length){ $(\'.patrollink a\').click(); } else { $(\'#diffSkip\').click(); } })();">[mark]</a></span>' :
						''
					) +
					'<span class="tab"><a id="diffNext">' + mw.message('next').escaped().ucFirst() + ' &raquo;</a></span>' + skipButtonHtml + '</div>'
				);

				if (opt.app.massPatrol) {
					$('.patrollink a').click();
				}

				$feed.find('.mw-rtrc-item-current').removeClass('mw-rtrc-item-current');
				krRTRC_RebindElements();
			});
			return false;
		});
		$('a.newPage').live('click', function () {
			currentDiffRcid = $(this).attr('rcid');
			var title = $(this).parent().find('> a.page').text(),
				href = $(this).parent().find('> a.page').attr('href');

			$('#krRTRC_DiffFrame').css('max-height', '400px').load(href + '&action=render&uselang=' + conf.wgUserLanguage, function () {
				if (krInArray(currentDiffRcid, skippedRCIDs)) {
					skipButtonHtml = '<span class="tab"><a id="diffUnskip">Unskip</a></span>';
				} else {
					skipButtonHtml = '<span class="tab"><a id="diffSkip">Skip</a></span>';
				}
				$('#krRTRC_DiffFrame').fadeIn().prepend('<h3>' + title + '</h3><div class="mw-rtrc-diff-tools"><span class="tab"><a id="diffClose">X</a></span><span class="tab"><a href="' + href + '" target="_blank" id="diffNewWindow">Open in Wiki</a></span><span class="tab"><a onclick="$(\'.patrollink a\').click()">[mark]</a></span><span class="tab"><a id="diffNext">' + mw.message('next').escaped().ucFirst() + ' &raquo;</a></span>' + skipButtonHtml + '</div>');
				if (opt.app.massPatrol) {
					$('.patrollink a').click();
				}
				$feed.find('.mw-rtrc-item-current').removeClass('mw-rtrc-item-current');
				krRTRC_RebindElements();
			});
			return false;
		});

		// Mark as patrolled
		$('.patrollink').live('click', function () {
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
					$feed.find('div[rcid="' + currentDiffRcid + '"]').addClass('patrolled');

					// Patrolling/Refreshing sometimes overlap eachother causing patrolled edits to show up in an 'unpatrolled only' feed.
					// Make sure that any patrolled edits stay marked as such to prevent AutoDiff from picking a patrolled edit
					// See also krRTRC_RebindElements()
					patrolledRCIDs.push(currentDiffRcid);

					while (patrolledRCIDs.length > patrolCacheSize) {
						patrolledRCIDs.shift();
					}

					if (opt.app.autoDiff) {
						krRTRC_NextDiff();
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
		$('#diffNext').live('click', function () {
			krRTRC_NextDiff();
		});

		// SkipDiff
		$('#diffSkip').live('click', function () {
			$feed.find('.mw-rtrc-item[rcid="' + currentDiffRcid + '"]').addClass('mw-rtrc-item-skipped');
			// Add to array, to reAddClass after refresh in krRTRC_RebindElements
			skippedRCIDs.push(currentDiffRcid);
			krRTRC_NextDiff(); // Load next
		});

		// UnskipDiff
		$('#diffUnskip').live('click', function () {
			$feed.find('.mw-rtrc-item[rcid="' + currentDiffRcid + '"]').removeClass('mw-rtrc-item-skipped');
			// Remove from array, to no longer reAddClass after refresh
			skippedRCIDs.splice(skippedRCIDs.indexOf(currentDiffRcid), 1);
			//krRTRC_NextDiff(); // Load next ?
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
		$('.mw-rollback-link a').live('click', function () {
			$('.patrollink a').click();
		});

		// Button: Pause
		$('#rc-options-pause').click(function () {
			if (this.checked) {
				rcRefreshEnabled = false;
				clearTimeout(rcRefreshTimeout);
				return;
			}
			rcRefreshEnabled = true;
			krRTRC_hardRefresh();
		});

	};

	/**
	 * Fire it off when the DOM is ready...
	 * -------------------------------------------------
	 */

	// On every page
	$(function () {
		if (!$('#t-rtrc').length) {
			mw.util.addPortletLink(
				'p-tb',
				mw.util.wikiGetlink('Special:BlankPage/RTRC'),
				'RTRC',
				't-rtrc',
				'Monitor and patrol recent changes in real-time',
				null,
				'#t-specialpages'
			);
		}
	});

	// If on the right page with the right action...
	if (
		(conf.wgTitle === 'Krinkle/RTRC' && conf.wgAction === 'view') ||
		(conf.wgCanonicalSpecialPageName === 'Blankpage' && conf.wgTitle.split('/', 2)[1] === 'RTRC')
	) {

		// These selectors from vector-hd conflict with mw-rtrc-available
		$('.vector-animateLayout').removeClass('vector-animateLayout');

		$('html').addClass('mw-rtrc-available');

		navSupported = conf.skin === 'vector' && !!window.localStorage;

		$(function () {
			$('#p-namespaces ul')
				.find('li.selected')
					.removeClass('new')
					.find('a')
						.text('RTRC');

		});

		dModules = $.Deferred();
		dI18N = $.Deferred();

		mw.loader.using(
			[
				'jquery.json',
				'mediawiki.action.history.diff',
				'mediawiki.jqueryMsg',
				'mediawiki.Uri',
				'mediawiki.util'
			],
			dModules.resolve,
			dModules.reject
		);

		$.ajax({
			url: intuitionLoadUrl,
			dataType: 'script',
			cache: true
		}).done(function () {
			mw.libs.intuition.load('rtrc')
				.done(function () {
					message = $.proxy(mw.libs.intuition.message, null, 'rtrc');
					msg = $.proxy(mw.libs.intuition.msg, null, 'rtrc');
					dI18N.resolve();
				})
				.fail(dI18N.reject);
		}).fail(dI18N.reject);

		if (navSupported) {
			// Apply stored setting
			navCollapsed = localStorage.getItem('mw-rtrc-navtoggle-collapsed') || 'true';
			if (navCollapsed === 'true') {
				$('html').toggleClass('mw-rtrc-navtoggle-collapsed');
			}
		}

		$.when(dModules, dI18N, $.ready.promise()).done(function () {
			var profile = $.client.profile();

			// Reject bad browsers
			// TODO: Check versions as well, or better yet: feature detection
			if (profile.name === 'msie' && profile.versionNumber < 9) {
				$('#mw-content-text').empty().append(
					$('<p>').addClass('errorbox').text(
						'Internet Explorer 8 and below are not supported. ' +
							'Please use a modern browser such as Chrome, Firefox or Safari.'
					)
				);
				return;
			}

			// Set up DOM for navtoggle
			if (navSupported) {
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

			// Start first phase of init
			krRTRC_init1();
		});
	}

}(jQuery, mediaWiki));
