/**
 * Real-Time Recent Changes
 * https://github.com/Krinkle/mw-gadget-rtrc
 *
 * @license http://krinkle.mit-license.org/
 * @author Timo Tijhof, 2010–2013
 */
/*global confirm */
(function ($, mw) {
	'use strict';

	/**
	 * App configuration
	 * -------------------------------------------------
	 */
	var
	appVersion = 'v0.9.5-pre',
	apiUrl = mw.util.wikiScript('api'),
	conf = mw.config.get([
		'wgAction',
		'wgCanonicalSpecialPageName',
		'wgPageName',
		'wgServer',
		'wgTitle',
		'wgUserLanguage'
	]),
	// 32x32px
	ajaxLoaderUrl = '//upload.wikimedia.org/wikipedia/commons/d/de/Ajax-loader.gif',
	// 18x15
	blacklistIconUrl = '//upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Nuvola_apps_important.svg/18px-Nuvola_apps_important.svg.png',
	docUrl = '//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes?uselang=' + conf.wgUserLanguage,
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
	rcFeedMemUIDs = [],
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
			limit: '25',
			// Type filters are "show matches only"
			typeEdit: false,
			typeNew: false
		},

		app: {
			refresh: 3,
			cvnDB: false,
			massPatrol: false,
			autoDiff: false,
			autoDiffTop: false
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

	currentDiffRcid,
	$wrapper, $body, $feed,
	$krRTRC_MassPatrol;

	// implied globals, legacy click handlers
	window.$RCOptions_submit = undefined;

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
		},

		// Adjust MediaWiki API timestamp string to local timezone
		// Example: "20100424013000" => "20100424011000"
		apiApplyWikiOffset: function (s) {
			var d, msd;
			// Possible number/integer to string
			s = String(s);
			// Convert to Date()-readable
			s = s.substr(0, 4) + '/' +
				s.substr(4, 2) + '/' +
				s.substr(6, 2) + ' ' +
				s.substr(8, 2) + ':' +
				s.substr(10, 2) + ':' +
				s.substr(12, 2);
			d = new Date(s);
			// String(d): 'Invalid Date'
			// d.getTime(): NaN
			// Number(d): NaN
			if (isNaN(d)) {
				mw.log('timeUtil.apiApplyWikiOffset: Invalid Date');
				return false;
			}
			// Get difference in miliseconds
			msd = wikiTimeOffset * 60 * 1000;
			// Adjust object to difference
			d.setTime(d.getTime() - msd);
			// Return longtime with leading zeros
			return '' +
				d.getFullYear() + '' +
				leadingZero(d.getMonth() + 1) + '' +
				leadingZero(d.getDate()) + '' +
				leadingZero(d.getHours()) + '' +
				leadingZero(d.getMinutes()) + '' +
				leadingZero(d.getSeconds());
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

	function krRTRC_RCDayHead(time) {
		var current = time.getDate();
		if (current === rcPrevDayHeading) {
			return '';
		}
		rcPrevDayHeading = current;
		return '<div class="item"><div><strong>' + time.getDate() + ' ' + monthNames[time.getMonth()] + '</strong></div></div>';
	}

	function krRTRC_BuildItem(
		type, title, rcid, revid, old_revid, user, timestamp, comment,
		patrolled, anon, oldlen, newlen
	) {
		var diffsize, usertypeClass, el, typeSymbol, itemClass, diffLink, item;

		// Get size difference in bytes (can be negative, zero or positive)
		diffsize = (+newlen) - (+oldlen);

		// patrolled is empty string if edit is patrolled, else undefined if it isn't
		// patrolled or the user doesnt have the right to see that information
		patrolled = patrolled !== undefined;

		//anon-var is empty string if edit is by anon, else undefined
		anon = anon === '';

		// typeSymbol, diffLink & itemClass
		typeSymbol = '&nbsp;';
		itemClass = '';
		diffLink = mw.msg('diff');

		if (type === 'new') {
			typeSymbol += '<span class="newpage">N</span>';
		}

		if (type === 'edit' || type === 'new') {
			if (userHasPatrolRight && !patrolled) {
				typeSymbol += '<span class="unpatrolled">!</span>';
			}

			itemClass = 'rcitem';
		}

		// strip HTML from comment
		comment = comment.replace(/<&#91;^>&#93;*>/g, '');

		// Check if comment is AES
		if (comment.indexOf('[[COM:AES|←]]') === 0) {
			itemClass += ' aes';
			comment = comment.replace('[[COM:AES|←]]', '← ');
		}

		// Anon-attribute
		if (anon) {
			usertypeClass = ' anoncontrib';
		} else {
			usertypeClass = ' usercontrib';
		}
/*
	Example:

	<div class="item rcitem patrolled" diff="0" user="Abc">
		<div diff>(<a class="diff" diff="0" rcid="0" href="//">diff</a>)</div>
		<div type><span class="unpatrolled">!</span></div>
		<div timetitle>00:00 <a href="//?rcid=0" target="_blank">Abc</a></div>
		<div user><a class="user" href="//User:Abc">Abc</a></div>
		<div other><a href="//User talk:Abc">talk</a> / <a href="//Special:Contributions/Abc">contribs</a>&nbsp;<span class="comment">Abc</span></div>
		<div size><span class="mw-plusminus-null">(0)</span></div>
	</div>
*/
		// build & return item
		item = krRTRC_RCDayHead(timeUtil.newDateFromApi(timestamp));
		item += '<div class="item ' + itemClass + usertypeClass + '" diff="' + revid + '" rcid="' + rcid + '" user="' + user + '">';

		if (type === 'edit') {
			diffLink = mw.util.wikiScript() + '?diff=' + revid + '&oldif=' + old_revid + '&rcid=' + rcid;
			diffLink = '<a class="rcitemlink diff" diff="' + revid + '" rcid="' + rcid + '" href="' + diffLink + '">' + mw.msg('diff') + '</a>';
		} else if (type === 'new') {
			diffLink = '<a class="rcitemlink newPage" rcid="' + rcid + '">new</a>';
		}


		item += '<div first>(' + diffLink + ') ' + typeSymbol + ' ';
		item += timeUtil.getClocktimeFromApi(timestamp) + ' <a class="page" href="' + mw.util.wikiGetlink(title) + '?rcid=' + rcid + '" target="_blank">' + title + '</a></div>';
		item += '<div user>&nbsp;<small>&middot;&nbsp;<a href="' + mw.util.wikiGetlink('User talk:' + user) + '" target="_blank">T</a> &middot; <a href="' + mw.util.wikiGetlink('Special:Contributions/' + user) + '" target="_blank">C</a>&nbsp;</small>&middot;&nbsp;<a class="user" href="' + mw.util.wikiGetlink('User:' + user) + '" target="_blank">' + user + '</a></div>';
		item += '<div other>&nbsp;<span class="comment">' + mw.html.escape(comment) + '</span></div>';

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
				opt.app[name] = el.checked;
				break;
			case 'refresh':
				opt.app[name] = Number(el.value);
				break;
			// Other settings (MassPatrol, AutoDiff, ..) are instantly toggled
			// as opposed to on-apply
			}
		});
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
				case 'autoDiffTop':
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
		var uri = new mw.Uri(mw.util.wikiGetlink(conf.wgPageName));
		uri.extend({
			opt: $.toJSON(opt),
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
				'comment',
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
		$feed.find('div.rcitem').each(function () {

			// Compare each diff-attribute to the array, if match mark item with the class

			if (krInArray($(this).attr('rcid'), skippedRCIDs)) {
				$(this).addClass('skipped');
			} else if (krInArray($(this).attr('rcid'), patrolledRCIDs)) {
				$(this).addClass('patrolled');
			}
		});

		// The current diff in diff-view stays marked
		$feed.find('div[rcid="' + currentDiffRcid + '"]').addClass('indiff');

		// All http-links within the diff-view open in a new window
		$('#krRTRC_DiffFrame > table.diff a').filter('a[href^="http://"], a[href^="https://"], a[href^="//"]').attr('target', '_blank');

	}

	function krRTRC_PushFrontend(htmloutput) {
		// Get current time + localtime adjustment
		var msd = wikiTimeOffset * 60 * 1000,
			// Last-update heading
			lastupdate = new Date();

		lastupdate.setTime(lastupdate.getTime() + msd);

		// TODO: Only do once
		$body.removeClass('placeholder');

		$feed.find('.mw-rtrc-feed-update').html(
			msg('lastupdate-rc', lastupdate.toUTCString()) +
			' | <a href="' + getPermalink() + '">' +
			msg('permalink') +
			'</a>'
		);

		if (htmloutput !== prevFeedHtml) {
			prevFeedHtml = htmloutput;
			$feed.find('.mw-rtrc-feed-content').html(htmloutput);
			krRTRC_RebindElements();
		}

		// Reset day
		rcPrevDayHeading = undefined;
		rcRefreshTimeout = setTimeout(krRTRC_Refresh, opt.app.refresh * 1000);
		$('#krRTRC_loader').hide();
	}

	function krRTRC_ApplyIRCBL(htmloutput, callback) {
		// Only run if there's an update going on
		if (isUpdating) {
			rcFeedMemUIDs = [];

			$(htmloutput).find('div.item').each(function (index, el) {
				rcFeedMemUIDs.push($(el).attr('user'));
			});
			rcFeedMemUIDs.shift();

			// Parsing json could cause fatal error if url is not HTTP 200 OK (ie. HTTP 404 Error)
			try {
				$.ajax({
					url: '//toolserver.org/~krinkle/CVN/API/?raw=0&format=json&uid=' + rcFeedMemUIDs.join('|'),
					jsonp: 'jsoncallback',
					dataType: 'jsonp',
					success: function (data) {

						// If none of the users appear in the database at all, then data.users is null
						if (data.users) {

							// Loop through all users
							// i=username, val=object
							$.each(data.users, function (i, val) {

								// Only if blacklisted, otherwise dont highlight
								if (val.usertype === 'bl') {

									var tooltip = '';

									// Get blacklist reason
									if (val.reason) {
										tooltip += msg('cvn-reason') + ': ' + val.reason + '. ';
									} else {
										tooltip += msg('cvn-reason') + ': ' + msg('cvn-reason-empty');
									}

									// Get blacklist adder
									if (val.adder) {
										tooltip += msg('cvn-adder') + ': ' + val.adder;
									} else {
										tooltip += msg('cvn-adder') + ': ' + msg('cvn-adder-empty');
									}

									// Apply blacklisted-class, and insert icon with tooltip
									htmloutput = $('<div>')
										.html(htmloutput)
										.find('div.item[user=' + i + '] .user')
											.addClass('blacklisted')
											.prepend('<img src="' + blacklistIconUrl + '" alt="" title="' + tooltip + '" />')
											.attr('title', tooltip)
											.end()
										.html();
								}

							});
						}

						// Either way, push the feed to the frontend
						callback(htmloutput);
						$feed.find('.mw-rtrc-feed-cvninfo').text('CVN DB ' + msg('lastupdate-cvn', data.dumpdate) + ': ' + data.dumpdate + ' (UTC)');
					},
					error: function () {
						// Ignore errors, just push to frontend
						callback();
					}
				});
			} catch (e) {
				// Ignore errors, just push to frontend
				callback();
			}

		}
	}

	function krRTRC_Refresh() {
		var rcparams;
		if (rcRefreshEnabled && !isUpdating) {

			// Indicate updating
			$('#krRTRC_loader').show();
			isUpdating = true;

			// Download recent changes

			rcparams = getApiRcParams(opt.rc);
			rcparams.format = 'xml';
			rcparams.action = 'query';
			rcparams.list = 'recentchanges';

			$.ajax({
				type: 'GET',
				url: apiUrl,
				data: rcparams,
				dataType: 'xml'
			}).done(function (rawback) {

				var htmloutput = '',
					$data = $(rawback);

				// API errors ?
				if ($data.find('error').length) {

					mw.log('krRTRC_GetRCData()-> ' + $data.find('rc').length + ' errors');
					$body.removeClass('placeholder');

					// Account doesnt have patrol flag
					if ($data.find('error').attr('code') === 'rcpermissiondenied') {
						htmloutput += '<h3>Downloading recent changes failed</h3><p>Please untick the "Unpatrolled only"-checkbox or request the Patroller-right on <a href="' + conf.wgPageName + '">' + conf.wgPageName + '</a>';

					// Other error
					} else {
						htmloutput += '<h3>Downloading recent changes failed</h3><p>Please check the settings above and try again. If you believe this is a bug, please <a href="//meta.wikimedia.org/w/index.php?title=User_talk:Krinkle/Tools&action=edit&section=new&editintro=User_talk:Krinkle/Tools/Editnotice&preload=User_talk:Krinkle/Tools/Preload" target="_blank"><strong>let me know</strong></a>.';
					}

				// Everything is OK - with results
				} else if ($data.find('rc').length) {

					$data.find('rc').each(function () {
						htmloutput += krRTRC_BuildItem(
							$(this).attr('type'),
							$(this).attr('title'),
							$(this).attr('rcid'),
							$(this).attr('revid'),
							$(this).attr('old_revid'),
							$(this).attr('user'),
							$(this).attr('timestamp'),
							$(this).attr('comment'),
							$(this).attr('patrolled'),
							$(this).attr('anon'),
							$(this).attr('oldlen'),
							$(this).attr('newlen')
						);
					});

				// Everything is OK - no results
				} else {
					htmloutput += '<strong><em>' + msg('nomatches') + '</em></strong>';
				}

				if (opt.app.cvnDB) {
					krRTRC_ApplyIRCBL(htmloutput, function (modoutput) {
						krRTRC_PushFrontend(modoutput || htmloutput);
						isUpdating = false;
					});
				} else {
					krRTRC_PushFrontend(htmloutput);
					isUpdating = false;
				}

				window.$RCOptions_submit.prop('disabled', false).css('opacity', '1.0');
			});
		}
	}

	function krRTRC_hardRefresh() {
		rcRefreshEnabled = true;
		$('#rc-options-pause').prop('checked', false);
		readSettingsForm();
		clearTimeout(rcRefreshTimeout);
		krRTRC_Refresh();
	}

	function krRTRC_NextDiff() {
		var $lis = $feed.find('div.rcitem:not(.indiff, .patrolled, .skipped)');
		if (opt.app.autoDiffTop) {
			$lis.eq(0).find('a.rcitemlink').click();
		} else {
			// eq(-1) doesn't work somehow..
			$lis.eq($lis.length - 1).find(' a.rcitemlink').click();
		}
	}

	function krRTRC_ToggleMassPatrol(b) {
		if (b === true) {
			opt.app.massPatrol = true;
			$krRTRC_MassPatrol.prop('checked', true);
			if (window.currentDiff === '') {
				krRTRC_NextDiff();
			} else {
				$('.patrollink a').click();
			}
		} else {
			opt.app.massPatrol = false;
			$krRTRC_MassPatrol.prop('checked', false);
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

		$('#p-namespaces ul')
			.find('li.selected')
				.removeClass('new')
				.find('a')
					.text('RTRC')
					.end()
				.end()
			.append(
				// Transplant "Main Page" link from the now-hidden sidebar
				$('#mw-panel .portal').eq(0).find('li').eq(0).wrapInner('<span>')
			);

		namespaceOptionsHtml += '<option value>' + mw.msg('namespacesall') + '</option>';
		namespaceOptionsHtml += '<option value="0">' + mw.msg('blanknamespace') + '</option>';

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
					'<a target="_blank" href="' + mw.util.wikiGetlink('Special:Log/patrol') + '?user=' + encodeURIComponent(mw.user.name()) + '">' +
						msg('mypatrollog').ucFirst() +
					'</a>' +
					'<a id="toggleHelp" href="#toggleHelp">Help</a>' +
				'</div>' +
			'</div>' +
			'<form id="krRTRC_RCOptions" class="mw-rtrc-settings mw-rtrc-nohelp make-switch"><fieldset>' +
				'<div class="panel-group">' +
					'<div class="panel">' +
						'<label for="mw-rtrc-settings-limit" class="head">' + msg('limit') + '</label>' +
						'<select id="mw-rtrc-settings-limit" name="limit">' +
							'<option value="10">10</option>' +
							'<option value="25" selected>25</option>' +
							'<option value="50">50</option>' +
							'<option value="75">75</option>' +
							'<option value="100">100</option>' +
						'</select>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' + msg('filter') + '</label>' +
						'<div style="text-align: left;">' +
							'<label>' +
								'<input type="checkbox" name="showAnonOnly" />' +
								' ' + msg('showAnonOnly') +
							'</label>' +
							'<br />' +
							'<label>' +
								'<input type="checkbox" name="showUnpatrolledOnly" />' +
								' ' + msg('showUnpatrolledOnly') +
							'</label>' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label for="mw-rtrc-settings-user" class="head">' +
							msg('userfilter') +
							'<span section="Userfilter" class="helpicon"></span>' +
						'</label>' +
						'<div style="text-align: center;">' +
							'<input type="text" size="16" id="mw-rtrc-settings-user" name="user" />' +
							'<br />' +
							'<input class="button button-small" type="button" id="mw-rtrc-settings-user-clr" value="' + msg('clear') + '" />' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' + msg('type') + '</label>' +
						'<div style="text-align: left;">' +
							'<label>' +
								'<input type="checkbox" name="typeEdit" checked />' +
								' ' + msg('typeEdit') +
							'</label>' +
							'<br />' +
							'<label>' +
								'<input type="checkbox" name="typeNew" checked />' +
								' ' + msg('typeNew') +
							'</label>' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							msg('timeframe') +
							'<span section="Timeframe" class="helpicon"></span>' +
						'</label>' +
						'<div style="text-align: right;">' +
							'<label>' +
								msg('time-from') + ': ' +
								'<input type="text" size="14" name="start" />' +
							'</label>' +
							'<br />' +
							'<label>' +
								msg('time-untill') + ': ' +
								'<input type="text" size="14" name="end" />' +
							'</label>' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label for="mw-rtrc-settings-namespace" class="head">' +
							mw.msg('namespaces') +
						'</label>' +
						'<select id="mw-rtrc-settings-namespace" name="namespace">' +
							namespaceOptionsHtml +
						'</select>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							msg('order') +
							' <br />' +
							'<span section="Order" class="helpicon"></span>' +
						'</label>' +
						'<div style="text-align: left;">' +
							'<label>' +
								'<input type="radio" name="dir" value="newer" />' +
								' ' + msg('asc') +
							'</label>' +
							'<br />' +
							'<label>' +
								'<input type="radio" name="dir" value="older" checked />' +
								' ' + msg('desc') +
							'</label>' +
						'</div>' +
					'</div>' +
					'<div class="panel">' +
						'<label for="mw-rtrc-settings-refresh" class="head">' +
							'R<br />' +
							'<span section="Reload_Interval" class="helpicon"></span>' +
						'</label>' +
						'<input type="number" value="3" min="0" max="999" id="mw-rtrc-settings-refresh" name="refresh" />' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head" for="mw-rtrc-settings-cvnDB">' +
							'CVN DB<br />' +
							'<span section="IRC_Blacklist" class="helpicon"></span>' +
						'</label>' +
						'<input type="checkbox" id="mw-rtrc-settings-cvnDB" name="cvnDB" />' +
					'</div>' +
					'<div class="panel panel-last">' +
						'<input class="button" type="button" id="RCOptions_submit" value="' + msg('apply') + '" />' +
					'</div>' +
				'</div>' +
				'<div class="panel-group panel-group-mini">' +
					'<div class="panel">' +
						'<label class="head">' +
							'MassPatrol' +
							'<span section="MassPatrol" class="helpicon"></span>' +
							'<input type="checkbox" class="switch" id="rc-options-massPatrol" />' +
						'</label>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							'AutoDiff' +
							'<span section="AutoDiff" class="helpicon"></span>' +
							'<input type="checkbox" class="switch" id="rc-options-autoDiff" />' +
						'</label>' +
					'</div>' +
					'<div class="panel">' +
						'<label class="head">' +
							msg('autodiff_loadfromtop') +
							'<input type="checkbox" class="switch" id="rc-options-autoDiffTop" />' +
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
			'<div class="mw-rtrc-body placeholder plainlinks">' +
				'<div class="mw-rtrc-feed">' +
					'<div class="mw-rtrc-feed-update"></div>' +
					'<div class="mw-rtrc-feed-content"></div>' +
					'<small class="mw-rtrc-feed-cvninfo"></small>' +
				'</div>' +
				'<img src="' + ajaxLoaderUrl + '" id="krRTRC_loader" style="display: none;" />' +
				'<div class="mw-rtrc-legend">' +
					'Colors: <div class="item patrolled inline-block">&nbsp;' +
					mw.msg('markedaspatrolled') + '&nbsp;</div>, <div class="item indiff inline-block">&nbsp;' +
					msg('currentedit') + '&nbsp;</div>, ' +
					'<div class="item skipped inline-block">&nbsp;' + msg('skippededit') + '&nbsp;</div>, ' +
					'<div class="item aes inline-block">&nbsp;Edit with an Automatic Edit Summary&nbsp;</div>' +
					'<br />Abbreviations: T - ' + mw.msg('talkpagelinktext') + ', C - ' + mw.msg('contributions', mw.user) +
				'</div>' +
			'</div>' +
			'<div style="clear: both;"></div>' +
			'<div class="mw-rtrc-foot">' +
				'<div class="plainlinks" style="text-align: right;">' +
					'Real-Time Recent Changes by ' +
					'<a href="//commons.wikimedia.org/wiki/User:Krinkle" class="external text" rel="nofollow">Krinkle</a>' +
					' | <a href="//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes#Changelog" class="external text" rel="nofollow">' + msg('changelog') + '</a>' +
					' | <a href="//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes" class="external text" rel="nofollow">' + msg('documentation') + '</a>' +
					' | <a href="http://krinkle.mit-license.org" class="external text" rel="nofollow">License</a>' +
				'</div>' +
			'</div>' +
		'</div>'
		));

		// Add helper element for switch checkboxes
		$wrapper.find('input.switch').after('<div class="switched"></div>');

		$('#content').empty().append($wrapper);

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

		window.$RCOptions_submit = $('#RCOptions_submit');

		// Apply button
		window.$RCOptions_submit.click(function () {
			window.$RCOptions_submit.prop('disabled', true).css('opacity', '0.5');
			krRTRC_hardRefresh();
			return false;
		});

		// Close Diff
		$('#diffClose').live('click', function () {
			$('#krRTRC_DiffFrame').fadeOut('fast');
			window.currentDiff = '';
			currentDiffRcid = '';
		});

		// Load diffview on (diff)-link click
		window.currentDiff = '';
		currentDiffRcid = '';
		$('a.diff').live('click', function () {
			window.currentDiff = $(this).attr('diff');
			currentDiffRcid = $(this).attr('rcid');
			var title = $(this).parent().find('>a.page').text(),
				href = $(this).parent().find('>a.diff').attr('href');
			$('#krRTRC_DiffFrame')
			.removeAttr('style'/* this resets style="max-height: 400;" from a.newPage below */)
			.load(mw.util.wikiScript() + '?action=render&diff=' + window.currentDiff + '&diffonly=1&uselang=' + conf.wgUserLanguage, function () {
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
					'<span class="tab"><a id="diffNext">' + mw.msg('next').ucFirst() + ' &raquo;</a></span>' + skipButtonHtml + '</div>'
				);

				if (opt.app.massPatrol) {
					$('.patrollink a').click();
				}

				$feed.find('div.indiff').removeClass('indiff');
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
				$('#krRTRC_DiffFrame').fadeIn().prepend('<h3>' + title + '</h3><div class="mw-rtrc-diff-tools"><span class="tab"><a id="diffClose">X</a></span><span class="tab"><a href="' + href + '" target="_blank" id="diffNewWindow">Open in Wiki</a></span><span class="tab"><a onclick="$(\'.patrollink a\').click()">[mark]</a></span><span class="tab"><a id="diffNext">' + mw.msg('next').ucFirst() + ' &raquo;</a></span>' + skipButtonHtml + '</div>');
				if (opt.app.massPatrol) {
					$('.patrollink a').click();
				}
				$feed.find('div.indiff').removeClass('indiff');
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
				data: {
					action: 'patrol',
					format: 'json',
					list: 'recentchanges',
					rcid: currentDiffRcid,
					token: userPatrolTokenCache
				},
				dataType: 'json'
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
			$feed.find('div[rcid=' + currentDiffRcid + ']').addClass('skipped');
			// Add to array, to reAddClass after refresh in krRTRC_RebindElements
			skippedRCIDs.push(currentDiffRcid);
			krRTRC_NextDiff(); // Load next
		});

		// UnskipDiff
		$('#diffUnskip').live('click', function () {
			$feed.find('div[rcid=' + currentDiffRcid + ']').removeClass('skipped');
			// Remove from array, to no longer reAddClass after refresh
			skippedRCIDs.splice(skippedRCIDs.indexOf(currentDiffRcid), 1);
			//krRTRC_NextDiff(); // Load next ?
		});

		// Show helpicons
		$('#toggleHelp').click(function (e) {
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
			if (opt.app.massPatrol) {
				var a = confirm(msg('userfilter-disable-masspatrol'));
				if (a) {
					$('#mw-rtrc-settings-user').val('');
					krRTRC_ToggleMassPatrol(false);
				}
			} else {
				$('#mw-rtrc-settings-user').val('');
			}
			window.$RCOptions_submit.click();
		});

		// Mark as patrolled when rollbacking
		// Note: As of MediaWiki r(unknown) rollbacking does already automatically patrol all reverted revisions.
		// But by doing it anyway it saves a click for the AutoDiff-users
		$('.mw-rollback-link a').live('click', function () {
			$('.patrollink a').click();
		});

		// Button: MassPatrol
		$krRTRC_MassPatrol = $('#rc-options-massPatrol').click(function () {
			if (!this.checked) {
				if (opt.app.massPatrol) {
					krRTRC_ToggleMassPatrol(false);
				}
				return;
			}
			if (opt.app.autoDiff) {
				krRTRC_ToggleMassPatrol(true);
			} else {
				var a = confirm(msg('masspatrol-enable-autodiff'));
				if (!a) {
					// Undo
					this.checked = false;
					return;
				}
				$('#rc-options-autoDiff').prop('checked', true);
				opt.app.autoDiff = true;
				krRTRC_ToggleMassPatrol(true);
			}
		});

		// Button: AutoDiff
		$('#rc-options-autoDiff').click(function () {
			if (opt.app.massPatrol && opt.app.autoDiff && !this.checked) {
				var a = confirm(msg('autodiff-disable-masspatrol'));
				if (!a) {
					// Undo
					this.checked = true;
					return;
				}
				opt.app.autoDiff = false;
				krRTRC_ToggleMassPatrol(false);
			} else {
				opt.app.autoDiff = this.checked;
			}
		});

		// Checkbox: AutoDiff from top
		$('#rc-options-autoDiffTop').click(function () {
			opt.app.autoDiffTop = this.checked;
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

	// If on the right page with the right action...
	if (
		(conf.wgTitle === 'Krinkle/RTRC' && conf.wgAction === 'view') ||
		(conf.wgCanonicalSpecialPageName === 'Blankpage' && conf.wgTitle.split('/', 2)[1] === 'RTRC')
	) {

		$('html').addClass('mw-rtrc-available');

		dModules = $.Deferred();
		dI18N = $.Deferred();

		mw.loader.using(
			['mediawiki.util', 'mediawiki.jqueryMsg', 'jquery.json',  'mediawiki.Uri', 'mediawiki.action.history.diff'],
			dModules.resolve,
			dModules.reject
		);

		$.ajax({
			url: '//tools.wmflabs.org/intuition/load.php?env=mw',
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

			// Map over months
			monthNames = msg('months').split(',');

			// Start first phase of init
			krRTRC_init1();
		});
	}

}(jQuery, mediaWiki));
