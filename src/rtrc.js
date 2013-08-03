/**
 * Real-Time Recent Changes
 * https://meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes
 *
 * MediaWiki dependencies: mediawiki.util, mediawiki.action.history.diff
 * External dependencies: [[m:User:Krinkle/RTRC.css]], [[tools:~krinkle/I18N/export.php]]
 *
 * @license http://krinkle.mit-license.org/
 * @author Timo Tijhof, 2010–2013
 */
/*global krMsgs, confirm */
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
	apiRecentChangesQueryUrl = false,
	rcRefreshTimeout = null,
	rcRefreshEnabled = null,
	rcLegendHtml = '',
	rcNamespaceDropdown,

	rcPrevDayHeading = false,
	skippedRCIDs = [],
	patrolledRCIDs = [],
	monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],

	skipButtonHtml = '',
	rcFeedMemHTML = '',
	rcFeedMemUIDs = [],
	// Difference UTC vs. wiki - fetched from siteinfo/timeoffset, in minutes
	wikiTimeOffset = 0,
	wikiId = 'unknown', // wgDBname
	isUpdating = false,

	/**
	 * Feed options
	 * -------------------------------------------------
	 */
	optLimit = '25',
	optFiltAnon = false,
	optFiltPatrol = false,
	optUser = '',
	optTypeEditoptUser = true,
	optTypeNewpage = true,
	optPage = '',
	optRctype = '',
	optFrom = false,
	optUntill = false,
	optRcshow = '',
	optRcprop = '',
	optRcstart = '',
	optNS = '',
	optOrder = 'desc',
	optRcend = '',
	optRInt = 3000,
	optIRCBL = false,

	optMassPatrol = false,
	optAutoDiff = false,
	optAutoDiffTop = false,

	optRcdir,
	krRTRC_initFuncs,
	krRTRC_initFuncs2,
	timeUtil,
	dModules,

	$krRTRC_Tip, $krRTRC_MassPatrol, $krRTRC_Tiptext;

	// implied globals, legacy click handlers
	window.$RCOptions_submit = undefined;

	/**
	 * Utility functions
	 * -------------------------------------------------
	 */

	if (!String.prototype.ucFirst) {
		String.prototype.ucFirst = function () {
			return this.substr(0, 1).toUpperCase() + this.substr(1, this.length);
		};
	}

	if (!String.prototype.escapeRE) {
		String.prototype.escapeRE = function () {
			return this.replace(/([\\{}()|.?*+\^$\[\]])/g, '\\$1');
		};
	}

	// Encode/decode htmlentities
	function krEncodeEntities(s) {
		return $('<div>').text(s).html();
	}

	// Get interface message
	function krMsg(key) {
		return krMsgs[key] || key.ucFirst();
	}

	// Returns a GET-parameter as string
	function krGetUrlParam(s, url) {
		return mw.util.getParamValue(s, url);
	}

	// Check if a variable is 'empty'
	function krEmpty(v) {
		var key;

		if (v === '' || v === '0' || v === 0 || v === false || v === null || v === undefined) {
			return true;
		}

		if (typeof v === 'object') {
			for (key in v) {
				return false;
			}
			return true;
		}

		return false;
	}

	// Prepends a leading zero if value is under 10
	function leadingZero(i) {
		if (i < 10) {
			i = '0' + i;
		}
		return i;
	}

	// Construct a URL to a page on the wiki
	function getWikipageUrl(s) {
		return mw.util.wikiGetlink(s);
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

	// Returns whether the given variable is an integer
	function krRTRC_isInt(i) {
		return parseInt(i, 10) === i;
	}

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

	function krRTRC_BuildItem(type, title, rcid, revid, old_revid, user, timestamp, comment,
		patrolled, anon, oldlen, newlen
	) {
		var diffsize, usertypeClass, el, typeSymbol, itemClass, diffLink, item;

		// Get size difference in bytes (can be negative, zero or positive)
		diffsize = (+newlen) - (+oldlen);

		//patrolled-var is empty string if edit is patrolled, else undefined
		patrolled = patrolled === '';

		//anon-var is empty string if edit is by anon, else undefined
		anon = anon === '';

		// typeSymbol, diffLink & itemClass
		typeSymbol = '&nbsp;';
		itemClass = '';
		diffLink = krMsg('diff');
		if (type === 'edit') {

			if (userHasPatrolRight) {
				if (optFiltPatrol === 'on') {
					typeSymbol = '<span class="unpatrolled">!</span>';
				} else if (!patrolled) {
					typeSymbol = '<span class="unpatrolled">!</span>';
				}
			}

			itemClass = 'rcitem';

		} else if (type === 'new') {

			itemClass = 'rcitem';

			typeSymbol = '<span class="newpage">N</span>';

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
			diffLink = '<a class="rcitemlink diff" diff="' + revid + '" rcid="' + rcid + '" href="' + diffLink + '">' + krMsg('diff') + '</a>';
		} else if (type === 'new') {
			diffLink = '<a class="rcitemlink newPage" rcid="' + rcid + '">new</a>';
		}


		item += '<div first>(' + diffLink + ') ' + typeSymbol + ' ';
		item += timeUtil.getClocktimeFromApi(timestamp) + ' <a class="page" href="' + getWikipageUrl(title) + '?rcid=' + rcid + '" target="_blank">' + title + '</a></div>';
		item += '<div user>&nbsp;<small>&middot;&nbsp;<a href="' + getWikipageUrl('User talk:' + user) + '" target="_blank">T</a> &middot; <a href="' + getWikipageUrl('Special:Contributions/' + user) + '" target="_blank">C</a>&nbsp;</small>&middot;&nbsp;<a class="user" href="' + getWikipageUrl('User:' + user) + '" target="_blank">' + user + '</a></div>';
		item += '<div other>&nbsp;<span class="comment">' + krEncodeEntities(comment) + '</span></div>';

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

	function krRTRC_GetRCOptions() {

		optLimit = $('#rc-options-limit').val();

		optFiltAnon = $('#rc-options-filter-anons:checked').val();
		optRcshow = optFiltAnon === 'on' ? '|anon' : '';

		optFiltPatrol = $('#rc-options-filter-unpatrolled:checked').val();
		if (optFiltPatrol === 'on') {
			optRcshow += '|!patrolled';
		}

		if (userHasPatrolRight) {
			optRcprop = '|patrolled';
		}

		optUser = $('#rc-options-rcuser').val() === '' ? false : $.trim($('#rc-options-rcuser').val());
		if (!krEmpty(optUser)) {
			optUser = '&rcuser=' + optUser;
		} else {
			optUser = '';
		}

		optTypeEditoptUser = $('#rc-options-type-edit:checked').val() === 'on';
		optTypeNewpage = $('#rc-options-type-newpage:checked').val() === 'on';
		optRctype = [];
		if (optTypeEditoptUser) {
			optRctype.push('edit');
		}
		if (optTypeNewpage) {
			optRctype.push('new');
		}
		optRctype = optRctype.join('|');

		if (optRctype === '') {
			// If all of, enable all
			$('#rc-options-type-edit').click();
			$('#rc-options-type-newpage').click();
			optRctype = 'edit|new';
		}

		optFrom = krEmpty($.trim($('#rc-options-timeframe-rcfrom').val())) ? false : $.trim($('#rc-options-timeframe-rcfrom').val());
		optUntill = krEmpty($.trim($('#rc-options-timeframe-rcuntill').val())) ? false : $.trim($('#rc-options-timeframe-rcuntill').val());

		if (optOrder === 'older') {
			if (krRTRC_isInt(parseInt(optUntill, 10)) && timeUtil.apiApplyWikiOffset(optUntill)) {
				optRcstart = '&rcstart=' + timeUtil.apiApplyWikiOffset(optUntill);
			} else {
				optRcstart = '';
			}
			if (krRTRC_isInt(parseInt(optFrom, 10)) && timeUtil.apiApplyWikiOffset(optFrom)) {
				optRcend = '&rcend=' + timeUtil.apiApplyWikiOffset(optFrom);
			} else {
				optRcend = '';
			}
		} else if (optOrder === 'newer') {
			if (krRTRC_isInt(parseInt(optFrom, 10)) && timeUtil.apiApplyWikiOffset(optFrom)) {
				optRcstart = '&rcstart=' + timeUtil.apiApplyWikiOffset(optFrom);
			} else {
				optRcstart = '';
			}
			if (krRTRC_isInt(parseInt(optUntill, 10)) && timeUtil.apiApplyWikiOffset(optUntill)) {
				optRcend = '&rcend=' + timeUtil.apiApplyWikiOffset(optUntill);
			} else {
				optRcend = '';
			}
		}

		optNS = $('#rc-options-namespace').val();

		optRcdir = $('input[name="rc-options-rcdir"]:checked').val();
		optOrder = optRcdir === 'asc' ? 'newer' : 'older';

		optRInt = parseInt($('#rc-options-interval').val(), 10) * 1000;

		optIRCBL = $('#rc-options-ircbl:checked').val() === 'on';

		optAutoDiff = $('#rc-options-autodiff').val();
		optAutoDiff = optAutoDiff === 'On';
		optAutoDiffTop = $('#rc-options-autodiff-top:checked').val();
		optAutoDiffTop = optAutoDiffTop === 'on';

		apiRecentChangesQueryUrl = apiUrl + '?action=query&format=xml&list=recentchanges' + optUser + '' + optPage + '&rctype=' + optRctype + '&rcshow=!bot' + optRcshow + '&rcprop=flags|timestamp|user|title|comment|sizes|ids' + optRcprop + '&rcnamespace=' + optNS + '&rclimit=' + optLimit + '&rcdir=' + optOrder + optRcstart + optRcend;
		return apiRecentChangesQueryUrl;
	}

	// Called when the list is refreshed
	function krRTRC_RebindElements() {

		// Re-apply "skipped" and "patrolled" classes
		$('#krRTRC_RCOutput > .feed div.rcitem').each(function () {

			// Compare each diff-attribute to the array, if match mark item with the class

			if (krInArray($(this).attr('rcid'), skippedRCIDs)) {
				$(this).addClass('skipped');
			} else if (krInArray($(this).attr('rcid'), patrolledRCIDs)) {
				$(this).addClass('patrolled');
			}
		});

		// The current diff in diff-view stays marked
		$('#krRTRC_RCOutput > .feed div[rcid="' + window.currentDiffRcid + '"]').addClass('indiff');

		// All http-links within the diff-view open in a new window
		$('#krRTRC_DiffFrame > table.diff a[href^="http://"], #krRTRC_DiffFrame > table.diff a[href^="https://"], #krRTRC_DiffFrame > table.diff a[href^="//"]').attr('target', '_blank');

	}

	function krRTRC_PushFrontend() {
		$('#krRTRC_RCOutput').removeClass('placeholder');
		$('#krRTRC_RCOutput > .feed').html(rcFeedMemHTML);

		// rebind elements
		krRTRC_RebindElements();
		// reset day
		rcPrevDayHeading = '';
		rcRefreshTimeout = setTimeout(krRTRC_Refresh, optRInt);
		$('#krRTRC_loader').hide();
	}

	function krRTRC_ApplyIRCBL() {
		// Only run if there's an update going on
		if (isUpdating) {
			rcFeedMemUIDs = [];

			$(rcFeedMemHTML).find('div.item').each(function (index, el) {
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
										tooltip += krMsg('reason') + ': ' + val.reason + '. ';
									} else {
										tooltip += krMsg('noreasonfound');
									}

									// Get blacklist adder
									if (val.adder) {
										tooltip += krMsg('adder') + ': ' + val.adder;
									} else {
										tooltip += krMsg('adder') + ': ' + krMsg('unknown');
									}

									// Apply blacklisted-class, and insert icon with tooltip
									rcFeedMemHTML = $('<div>')
										.html(rcFeedMemHTML)
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
						krRTRC_PushFrontend();
						$('#krRTRC_RCOutput>.feed').append('<small id="krRTRC_Dumpdate">CVN DB ' + krMsg('lastupdate') + ': ' + data.dumpdate + ' (UTC)</small>');
						isUpdating = false;
					},
					error: function () {
						// Ignore errors, just push to frontend
						krRTRC_PushFrontend();
						isUpdating = false;
					}
				});
			} catch (e) {
				// Ignore errors, just push to frontend
				krRTRC_PushFrontend();
				isUpdating = false;
			}

		}
	}

	function krRTRC_Refresh() {
		if (rcRefreshEnabled  && !isUpdating) {

			// Indicate updating
			$('#krRTRC_loader').show();
			isUpdating = true;
			// Download recent changes
			$.ajax({
				type: 'GET',
				url: apiRecentChangesQueryUrl,
				dataType: 'xml',
				success: function (rawback) {

					var htmloutput,
						// Last-update heading
						lastupdate = new Date(),
						// Get current time + localtime adjustment
						msd = wikiTimeOffset * 60 * 1000;
					lastupdate.setTime(lastupdate.getTime() + msd);
					rcFeedMemHTML = '<div id="krRTRC_lastupdate">' + krMsg('lastupdate') + ': ' + lastupdate.toUTCString() + ' | <a href="' + krRTRC_GeneratePermalink() + '">' + krMsg('permalinktext') + '</a></div>';

					// API errors ?
					if ($(rawback).find('error').length) {

						mw.log('krRTRC_GetRCData()-> ' + $(rawback).find('rc').length + ' errors');
						$('#krRTRC_RCOutput').removeClass('placeholder');

						// Account doesnt have patrol flag
						if ($(rawback).find('error').attr('code') === 'rcpermissiondenied') {
							rcFeedMemHTML += '<h3>Downloading recent changes failed</h3><p>Please untick the "Unpatrolled only"-checkbox or request the Patroller-right on <a href="' + conf.wgPageName + '">' + conf.wgPageName + '</a>';

						// Other error
						} else {
							rcFeedMemHTML += '<h3>Downloading recent changes failed</h3><p>Please check the settings above and try again. If you believe this is a bug, please <a href="//meta.wikimedia.org/w/index.php?title=User_talk:Krinkle/Tools&action=edit&section=new&editintro=User_talk:Krinkle/Tools/Editnotice&preload=User_talk:Krinkle/Tools/Preload" target="_blank"><strong>let me know</strong></a>.';
						}
						krRTRC_PushFrontend();
						isUpdating = false;

					// Everything is OK - with results
					} else if ($(rawback).find('rc').length) {

						htmloutput = '<div id="krRTRC_list">';
						$(rawback).find('rc').each(function () {
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
						rcFeedMemHTML += htmloutput + '</div>';
						if (optIRCBL) {
							krRTRC_ApplyIRCBL();
							//isUpdating is set to false within krRTRC_ApplyIRCBL()
						} else {
							krRTRC_PushFrontend();
							isUpdating = false;
						}

					// Everything is OK - no results
					} else {
						rcFeedMemHTML += '<strong><em>' + krMsg('nomatches') + '</em></strong>';
						krRTRC_PushFrontend();
						isUpdating = false;
					}

					window.$RCOptions_submit.prop('disabled', false).css('opacity', '1.0');
				}

			});
		}
	}

	function krRTRC_hardRefresh() {

		rcRefreshEnabled = true;
		$('#krRTRC_toggleRefresh').val('Off').removeClass('button-on');
		krRTRC_GetRCOptions();
		clearTimeout(rcRefreshTimeout);
		krRTRC_Refresh();
	}

	// Checks the GET-parameters and manipulates #krRTRC_RCOptions
	// Also initiates jumpstart
	function krRTRC_ProcesPermalink(l) {
		var get;

		get = krGetUrlParam('rclimit', l);
		$('#rc-options-limit option[value=' + get + ']').prop('selected', true);

		get = krGetUrlParam('rcshow_anon', l);
		if (get === 'on') {
			$('#rc-options-filter-anons').prop('checked', true);
		}

		get = krGetUrlParam('rcshow_patrol', l);
		if (get === 'on') {
			$('#rc-options-filter-unpatrolled').prop('checked', true);
		}

		get = krGetUrlParam('rcuser', l);
		$('#rc-options-rcuser').val(get);

		get = krGetUrlParam('typeedit', l);
		if (get === 'off') {
			$('#rc-options-type-edit').prop('checked', false);
		}

		get = krGetUrlParam('typenewpage', l);
		if (get === 'off') {
			$('#rc-options-type-newpage').prop('checked');
		}

		get = krGetUrlParam('rcfrom', l);
		$('#rc-options-timeframe-rcfrom').val(get);

		get = krGetUrlParam('rcuntill', l);
		$('#rc-options-timeframe-rcuntill').val(get);

		// optNS
		get = krGetUrlParam('rcnamespace', l);
		$('#rc-options-namespace option[value=' + get + ']').prop('selected', true);

		get = krGetUrlParam('rcdir', l);
		if (get === 'asc') {
			$('#krRTRC_RCOptions input[name=rc-options-rcdir][value=asc]').prop('checked', true);
			$('#krRTRC_RCOptions input[name=rc-options-rcdir][value=desc]').prop('checked', false);
		}

		get = krGetUrlParam('ajaxint', l);
		if (get !== '' && get !== ' ' && get !== null && get !== false) {
			$('#rc-options-interval').val(get);
		}

		get = krGetUrlParam('ircbl', l);
		if (get === 'on') {
			$('#rc-options-ircbl').prop('checked', true);
		}

		get = krGetUrlParam('autodiff');
		if (get === 'on') {
			$('#rc-options-autodiff').val('On').addClass('button-on');
		}

		get = krGetUrlParam('autodiff_top', l);
		if (get === 'on') {
			$('#rc-options-autodiff-top').prop('checked', true);
		}

		get = krGetUrlParam('jumpstart', l);
		if (get === 'on') {
			get = krRTRC_GetRCOptions();
			krRTRC_hardRefresh();
			window.location.hash = '';
			window.location.hash = 'toggleHelp';
		}
	}

	// Checks the settings and returns a the permalink that would reproduce these settings manipulates #krRTRC_RCOptions
	function krRTRC_GeneratePermalink() {
		var a = '&rclimit=' + optLimit;
		a += optFiltAnon === 'on' ? '&rcshow_anon=on' : '';
		a += optFiltPatrol === 'on' ? '&rcshow_patrol=on' : '';
		a += optUser || '';
		a += optTypeEditoptUser ? '' : '&typeedit=off';
		a += optTypeNewpage ? '' : '&typenewpage=off';
		a += optPage || '';
		a += !optFrom ? '' : ('&rcfrom=' + optFrom);
		a += !optUntill ? '' : ('&rcuntill=' + optUntill);
		a += optNS === '' ? '' : ('&rcnamespace=' + optNS);
		a += '&rcdir=';
		a += optRcdir === 'asc' ? 'asc' : 'desc';
		a += Math.round(optRInt / 1000) !== 3 ? '&ajaxint=' + Math.round(optRInt / 1000) : '';
		a += optIRCBL ? '&ircbl=on' : '';
		a += optAutoDiff ? '&autodiff=on' : '';
		a += optAutoDiffTop ? '&autodiff_top=on' : '';
		return mw.util.wikiScript() + '?' + $.param({ title: conf.wgPageName, jumpstart: 'on' }) + a;
	}

	function krRTRC_NextDiff() {
		var $lis = $('#krRTRC_RCOutput > .feed div.rcitem:not(.indiff, .patrolled, .skipped)');
		if (optAutoDiffTop) {
			$lis.eq(0).find('a.rcitemlink').click();
		} else {
			// eq(-1) doesn't work somehow..
			$lis.eq($lis.length - 1).find(' a.rcitemlink').click();
		}
	}

	function krRTRC_TipIn($targetEl, uid, is_anon) {
		var o, links;
		mw.log('krRTRC_TipIn()');
		o = $targetEl.offset();
		if (is_anon) {
			links = ' · <a target="_blank" title="Whois ' + uid + '?" href="//toolserver.org/~chm/whois.php?ip=' + uid + '">WHOIS</a>';
		} else {
			links = '';
		}
		links += ' · <a target="_blank" title="View cross-wiki contributions" href="//toolserver.org/~luxo/contributions/contributions.php?user=' + uid + '&blocks=true">CrossWiki</a>';
		if (userHasDeletedhistoryRight) {
			links += ' · <a target="_blank" title="View deleted contributions" href="' + getWikipageUrl('Special:DeletedContributions/' + uid) + '">DeletedContributions</a>';
		}
		$krRTRC_Tiptext.html('<a id="krRTRC_Tip_FilterAdd" onclick="$(\'#rc-options-rcuser\').val(\'' + uid + '\'); window.$RCOptions_submit.click();" uid="' + uid + '" title="Filter by ' + uid + '">[ + <small>filter</small>]</a>' + links);
		$krRTRC_Tip.css({
			left: o.left + 'px',
			top: (o.top - 23) + 'px',
			display: 'block'
		}).show();
		window.krRTRC_TipTime = setTimeout(krRTRC_TipOut, 3000);
	}

	function krRTRC_TipOut() {
		if (window.krRTRC_TipTime !== undefined) {
			clearTimeout(window.krRTRC_TipTime);
		}
		$krRTRC_Tip.hide();
	}

	function krRTRC_ToggleMassPatrol(b) {
		if (b === true) {
			optMassPatrol = true;
			$krRTRC_MassPatrol.val('On').addClass('button-on');
			if (window.currentDiff === '') {
				krRTRC_NextDiff();
			} else {
				$('.patrollink a').click();
			}
		} else {
			optMassPatrol = false;
			$krRTRC_MassPatrol.val('Off').removeClass('button-on');
		}

	}

	function krRTRC_GetPatroltoken() {
		$.ajax({
			type: 'GET',
			// added rctype=new because several wikis only do newpages, by getting all rcs changes are it'll return an edit and thus error instead of token. Unless there are wikis with RC-patrol but no NP-patrol (as supposed to both or the opposite), this will be just fine. If there are wikis without NP-patrol but with RC-patrol, we'll have to split up somewhere around here.
			url: apiUrl + '?action=query&format=xml&list=recentchanges&rctoken=patrol&rclimit=1&rctype=new',
			dataType: 'xml',
			success: function (rawback) {
				userPatrolTokenCache = $(rawback).find('rc').attr('patroltoken');
				if (userPatrolTokenCache) {
					userPatrolTokenCache = userPatrolTokenCache.replace('+', '%2B').replace('\\', '%5C');
				} else {
					userPatrolTokenCache = false;
				}
			}
		});
	}

	// Init Phase 1 : When the DOM is ready
	function krRTRC_init1() {
		mw.log('Init Phase 1 started');
		while (krRTRC_initFuncs.length) {
			(krRTRC_initFuncs.shift())();
		}
		mw.log('Init Phase 1 done');
	}

	// Init Phase 2 : Called in GetIntMsgs()
	function krRTRC_init2() {
		mw.log('Init Phase 2 started');
		while (krRTRC_initFuncs2.length) {
			(krRTRC_initFuncs2.shift())();
		}
		mw.log('Init Phase 2 done');
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

		$.getJSON(apiUrl + '?action=query&format=json&meta=allmessages&amlang=' + conf.wgUserLanguage + '&ammessages=show|hide|ascending abbrev|descending abbrev|markaspatrolleddiff|markedaspatrolled|markedaspatrollederror|next|diff|talkpagelinktext|contributions|recentchanges-label-legend|recentchanges-label-bot|recentchanges-label-minor|recentchanges-label-newpage|recentchanges-label-unpatrolled|recentchanges-legend-bot|recentchanges-legend-minor|recentchanges-legend-newpage|recentchanges-legend-unpatrolled|namespaces|namespacesall|blanknamespace&callback=?', function (data) {
			var i;
			mw.log('GetIntMsgs->' + data);
			mw.log(data);
			data = data.query.allmessages;
			for (i = 0; i < data.length; i += 1) {
				krMsgs[data[i].name] = data[i]['*'];
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
		$('#p-namespaces > ul > li')
			.removeClass('new')
			.find(' > a > span').eq(0)
				.text('Tool');
		$('#ca-talk')
			.removeClass('new')
			.find('> a')
				.attr('href', '//meta.wikimedia.org/w/index.php?title=User_talk:Krinkle/Tools&action=edit&section=new&editintro=User_talk:Krinkle/Tools/Editnotice&preload=User_talk:Krinkle/Tools/Preload')
				.attr('target', '_blank')
				.find('> span')
					.text('Feedback');
		$('#footer').remove();
		$('#content').addClass('krRTRC_body');
		rcLegendHtml = '<div id="krRTRC_RCLegend">' + krMsg('recentchanges-label-legend').replace('$1.', '') + ' <abbr class="newpage" title="' + krMsg('recentchanges-label-newpage') + '">N</abbr>' + krMsg('recentchanges-legend-newpage').replace('$1', '') + ', <!--<abbr class="minor" title="' + krMsg('recentchanges-label-minor') + '">m</abbr>' + krMsg('recentchanges-legend-minor').replace('$1', '') + ', <abbr class="bot" title="' + krMsg('recentchanges-label-bot') + '">b</abbr>' + krMsg('recentchanges-legend-bot').replace('$1', '') + ', --><abbr class="unpatrolled" title="' + krMsg('recentchanges-label-unpatrolled') + '">!</abbr>' + krMsg('recentchanges-legend-unpatrolled').replace('$1', '') + '<br />Colors: <div class="item patrolled inline-block">&nbsp;' + krMsg('markedaspatrolled') + '&nbsp;</div>, <div class="item indiff inline-block">&nbsp;' + krMsg('currentedit') + '&nbsp;</div>, <div class="item skipped inline-block">&nbsp;' + krMsg('skippededit') + '&nbsp;</div>, <div class="item aes inline-block">&nbsp;Edit with an Automatic Edit Summary&nbsp;</div><br />' + krMsg('abbreviations') + ': T - ' + krMsg('talkpagelinktext') + ', C - ' + krMsg('contributions') + '</div>';
		rcNamespaceDropdown = '<select id="rc-options-namespace" name="rc-options-namespace">';
		rcNamespaceDropdown += '<option value>' + krMsg('namespacesall') + '</option>';
		rcNamespaceDropdown += '<option value="0">' + krMsg('blanknamespace') + '</option>';

		var ns,
			fmNs = mw.config.get('wgFormattedNamespaces');

		for (ns in fmNs) {
			if (ns > 0) {
				rcNamespaceDropdown += '<option value="' + ns + '">' + fmNs[ns] + '</option>';
			}
		}
		rcNamespaceDropdown += '</select>';

		$('#content').html(
		'<div id="content-inner"><div id="krRTRC_PageWrap" class="plainlinks">' +
			'<div id="krRTRC_Topbar">Real-Time Recent Changes <small class="ns">(' + appVersion + ')</small><small id="toggleHelp">[help]</small><a target="_blank" href="' + getWikipageUrl('Special:Log/patrol') + '?user=' + encodeURIComponent(mw.user.name()) + '" style="float:right;font-size:smaller;color:#ccc">&nbsp;[' + krMsg('mypatrollog') + ']&nbsp;</a></div>' +
			'<div id="krRTRC_RCForm"><fieldset id="krRTRC_RCOptions" class="nohelp"><form>' +
				'<div class="panel"><label for="rc-options-limit" class="head">' + krMsg('limit') + '</label><select id="rc-options-limit" name="rc-options-limit"><option value="10">10</option><option selected="" value="25">25</option><option value="50">50</option><option value="75">75</option><option value="100">100</option></select></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label class="head">' + krMsg('filter') + '</label><div style="text-align:left"><input type="checkbox" value="on" id="rc-options-filter-anons" name="rc-options-filter-anons"><label for="rc-options-filter-anons"> ' + krMsg('anononly') + '</label><br /><input type="checkbox" value="on" id="rc-options-filter-unpatrolled" name="rc-options-filter-unpatrolled"><label for="rc-options-filter-unpatrolled"> ' + krMsg('unpatrolledonly') + '</label></div></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label for="rc-options-rcuser" class="head">' + krMsg('userfilter-opt') + ' <span section="Userfilter" class="helpicon"></span></label><div style="text-align: center;"><input type="text" value="" size="16" id="rc-options-rcuser" name="rc-options-rcuser" /><br /><input class="button" type="button" id="RCOptions_RcuserClr" value="' + krMsg('clear') + '" /></div></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label class="head">' + krMsg('type') + '</label><div style="text-align:left"><input type="checkbox" value="on" id="rc-options-type-edit" name="rc-options-type-edit" checked="checked"><label for="rc-options-type-edit"> ' + krMsg('edits') + '</label><br /><input type="checkbox" checked="checked" value="on" id="rc-options-type-newpage" name="rc-options-type-newpage"><label for="rc-options-type-newpage"> ' + krMsg('newpages') + '</label></div></div>' +
				'<div class="sep"></div>' +
				// RCTITLES DISABLED: https://bugzilla.wikimedia.org/show_bug.cgi?id=12394#c5
				// '<div class="panel"><label class="head" for="rc-options-rctitle">' + krMsg('pagefilter-opt') + ' <span section="Pagefilter" class="helpicon"></span></label><div style="text-align: center;"><input type="text" value="" size="16" id="rc-options-rctitle" name="rc-options-rctitle" /><br /><input class="button" type="button" id="RCOptions_RctitleClr" value="' + krMsg('clear') + '" /></div></div>' +
				//'<div class="sep"></div>' +
				'<div class="panel"><label class="head">' + krMsg('timeframe-opt') + ' <span section="Timeframe" class="helpicon"></span></label><div style="text-align: right;"><label for="rc-options-timeframe-rcfrom">' + krMsg('from') + ': </label><input type="text" value="" size="14" id="rc-options-timeframe-rcfrom" name="rc-options-timeframe-rcfrom"><br /><label for="rc-options-timeframe-rcuntill">' + krMsg('untill') + ': </label><input type="text" value="" size="14" id="rc-options-timeframe-rcuntill" name="rc-options-timeframe-rcuntill"></div></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label for="rc-options-namespace" class="head">' + krMsg('namespaces') + '</label>' + rcNamespaceDropdown + '</div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label class="head">' + krMsg('order') + ' <br /><span section="Order" class="helpicon"></span></label><div style="text-align: left;"><input type="radio" name="rc-options-rcdir" value="asc"> ' + krMsg('asc') + ' <br /><input type="radio" name="rc-options-rcdir" value="desc" checked="checked"> ' + krMsg('desc') + ' </div></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label for="rc-options-interval" class="head">R <br /><span section="Reload_Interval" class="helpicon"></span></label><input type="text" value="3" size="1" id="rc-options-interval" name="rc-options-interval"></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label class="head" for="rc-options-ircbl">IRCBL<br /><span section="IRC_Blacklist" class="helpicon"></span></label><input type="checkbox" value="on" size id="rc-options-ircbl" name="rc-options-ircbl" /></div>' +
				'<div class="sep"></div>' +
				'<div class="panel panel-last"><input class="button" type="button" id="RCOptions_submit" value="' + krMsg('apply') + '" /></div>' +
				'<hr style="clear: both;" />' +
				'<div class="panel2"><label for="krRTRC_MassPatrol" class="head">MassPatrol <span section="MassPatrol" class="helpicon"></span></label><input id="krRTRC_MassPatrol" class="button button-off" type="button" value="Off" /></div>' +
				'<div class="sep2"></div>' +
				'<div class="panel2"><label for="rc-options-autodiff" class="head">AutoDiff <span section="AutoDiff" class="helpicon"></span></label><input type="button" class="button button-off" value="Off" id="rc-options-autodiff" /> <input type="checkbox" value="on" id="rc-options-autodiff-top" /> <label for="rc-options-autodiff-top"> ' + krMsg('loadfromtop') + '</label></div>' +
				'<div class="sep2"></div>' +
				'<div class="panel2"><label for="krRTRC_toggleRefresh" class="head">Pause</label><input id="krRTRC_toggleRefresh" class="button button-off" type="button" value="Off" /></div>' +
			'</fieldset></form></div>' +
			'<a name="krRTRC_DiffTop" />' +
			'<div id="krRTRC_DiffFrame" style="display: none;"></div>' +
			'<div id="krRTRC_RCOutput" class="placeholder">' + rcLegendHtml + '</div>' +
			'<div style="clear: both;"></div>' +
			'<div id="krRTRC_Footer"><div class="inside" style="text-align: right;">' +
				'Real-Time Recent Changes by <a href="//commons.wikimedia.org/wiki/User:Krinkle" class="external text" rel="nofollow">Krinkle</a>:' +
				' <a href="//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes#Changelog" class="external text" rel="nofollow">' + krMsg('whatsnew') + '</a>' +
				' | <a href="//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes" class="external text" rel="nofollow">' + krMsg('documentation') + '</a>' +
				' | <a href="http://krinkle.mit-license.org" class="external text" rel="nofollow">License</a>' +
			'</div></div>');
		$('body').append('<div id="krRTRC_Tip"><span id="krRTRC_Tiptext"></span></div>');

		$('#content-inner').css('position', 'relative');
		$('#krRTRC_RCOutput').prepend('<div class="feed"></div><img src="' + ajaxLoaderUrl + '" id="krRTRC_loader" style="display: none;" />');
	};

	// function ProcesPermalink()
	krRTRC_initFuncs2[1] = function () {
		krRTRC_ProcesPermalink();
	};

	// function Bindevents()
	//
	// Binds events to the user interface
	krRTRC_initFuncs2[2] = function () {

		window.$RCOptions_submit = $('#RCOptions_submit');

		// Apply button
		window.$RCOptions_submit.click(function () {
			window.$RCOptions_submit.prop('disabled', true).css('opacity', '0.5');
			krRTRC_GetRCOptions();
			krRTRC_hardRefresh();
			return false;
		});

		// Close Diff
		$('#diffClose').live('click', function () {
			$('#krRTRC_DiffFrame').fadeOut('fast');
			window.currentDiff = '';
			window.currentDiffRcid = '';
		});

		// Load diffview on (diff)-link click
		window.currentDiff = '';
		window.currentDiffRcid = '';
		$('a.diff').live('click', function () {
			window.currentDiff = $(this).attr('diff');
			window.currentDiffRcid = $(this).attr('rcid');
			var title = $(this).parent().find('>a.page').text(),
				href = $(this).parent().find('>a.diff').attr('href');
			$('#krRTRC_DiffFrame')
			.removeAttr('style'/* this resets style="max-height: 400;" from a.newPage below */)
			.load(mw.util.wikiScript() + '?action=render&diff=' + window.currentDiff + '&diffonly=1&uselang=' + conf.wgUserLanguage, function () {
				$(this).html($(this).html().replace('diffonly=', 'krinkle=').replace('diffonly=', 'krinkle='));
				if (krInArray(window.currentDiffRcid, skippedRCIDs)) {
					skipButtonHtml = '<span class="tab"><a id="diffUnskip">Unskip</a></span>';
				} else {
					skipButtonHtml = '<span class="tab"><a id="diffSkip">Skip</a></span>';
				}
				$('#krRTRC_DiffFrame').fadeIn().prepend(
					'<h3>' + title + '</h3><div id="krRTRC_DiffTools"><span class="tab"><a id="diffClose">X</a></span><span class="tab"><a href="' + href + '" target="_blank" id="diffNewWindow">Open in Wiki</a></span>' +
					(userPatrolTokenCache ?
						'<span class="tab"><a onclick="(function(){ if($(\'.patrollink a\').length){ $(\'.patrollink a\').click(); } else { $(\'#diffSkip\').click(); } })();">[mark]</a></span>' :
						''
					) +
					'<span class="tab"><a id="diffNext">' + krMsg('next').ucFirst() + ' &raquo;</a></span>' + skipButtonHtml + '</div>'
				);

				if (optMassPatrol) {
					$('.patrollink a').click();
				}

				$('#krRTRC_RCOutput > .feed div.indiff').removeClass('indiff');
				krRTRC_RebindElements();
			});
			return false;
		});
		$('a.newPage').live('click', function () {
			window.currentDiffRcid = $(this).attr('rcid');
			var title = $(this).parent().find('> a.page').text(),
				href = $(this).parent().find('> a.page').attr('href');

			$('#krRTRC_DiffFrame').css('max-height', '400px').load(href + '&action=render&uselang=' + conf.wgUserLanguage, function () {
				if (krInArray(window.currentDiffRcid, skippedRCIDs)) {
					skipButtonHtml = '<span class="tab"><a id="diffUnskip">Unskip</a></span>';
				} else {
					skipButtonHtml = '<span class="tab"><a id="diffSkip">Skip</a></span>';
				}
				$('#krRTRC_DiffFrame').fadeIn().prepend('<h3>' + title + '</h3><div id="krRTRC_DiffTools"><span class="tab"><a id="diffClose">X</a></span><span class="tab"><a href="' + href + '" target="_blank" id="diffNewWindow">Open in Wiki</a></span><span class="tab"><a onclick="$(\'.patrollink a\').click()">[mark]</a></span><span class="tab"><a id="diffNext">' + krMsg('next').ucFirst() + ' &raquo;</a></span>' + skipButtonHtml + '</div>');
				if (optMassPatrol) {
					$('.patrollink a').click();
				}
				$('#krRTRC_RCOutput > .feed div.indiff').removeClass('indiff');
				krRTRC_RebindElements();
			});
			return false;
		});

		// Mark as patrolled
		$('.patrollink').live('click', function () {
			$('.patrollink > a').html(krMsg('markaspatrolleddiff') + '...');
			$.ajax({
				type: 'POST',
				url: apiUrl + '?action=patrol&format=xml&list=recentchanges&rcid=' + window.currentDiffRcid + '&token=' + userPatrolTokenCache,
				dataType: 'xml',
				success: function (rawback) {
					if ($(rawback).find('error').length) {
						$('.patrollink').html('<span style="color: red;">' + krMsg('markedaspatrollederror') + '</span>');
						mw.log('PatrolError: ' + $(rawback).find('error').attr('code') + '; info: ' + $(rawback).find('error').attr('info'));
					} else {
						$('.patrollink').html('<span style="color: green;">' + krMsg('markedaspatrolled') + '</span>');
						$('#krRTRC_RCOutput > .feed div[rcid="' + window.currentDiffRcid + '"]').addClass('patrolled');

						// Patrolling/Refreshing sometimes overlap eachother causing patrolled edits to show up in an 'unpatrolled only' feed.
						// Make sure that any patrolled edits stay marked as such to prevent AutoDiff from picking a patrolled edit
						// See also krRTRC_RebindElements()
						patrolledRCIDs.push(window.currentDiffRcid);

						while (patrolledRCIDs.length > patrolCacheSize) {
							mw.log('MarkPatrolCache -> Cache array is bigger then cachemax, shifting array(' + patrolledRCIDs.length + ' vs. ' + patrolCacheSize + '). Current array:');
							mw.log(patrolledRCIDs);
							patrolledRCIDs.shift();
							mw.log('MarkPatrolCache -> Cache array is shifted. New array:');
							mw.log(patrolledRCIDs);
						}

						if (optAutoDiff) {
							krRTRC_NextDiff();
						}
					}
				},
				error: function () {
					$('.patrollink').html('<span style="color: red;">' + krMsg('markedaspatrollederror') + '</span>');
				}
			});
			return false;
		});

		// Trigger NextDiff
		$('#diffNext').live('click', function () {
			krRTRC_NextDiff();
		});

		// SkipDiff
		$('#diffSkip').live('click', function () {
			$('#krRTRC_RCOutput > .feed div[rcid=' + window.currentDiffRcid + ']').addClass('skipped');
			// Add to array, to reAddClass after refresh in krRTRC_RebindElements
			skippedRCIDs.push(window.currentDiffRcid);
			krRTRC_NextDiff(); // Load next
		});

		// UnskipDiff
		$('#diffUnskip').live('click', function () {
			$('#krRTRC_RCOutput > .feed div[rcid=' + window.currentDiffRcid + ']').removeClass('skipped');
			// Remove from array, to no longer reAddClass after refresh
			skippedRCIDs.splice(skippedRCIDs.indexOf(window.currentDiffRcid), 1);
			//krRTRC_NextDiff(); // Load next ?
		});

		// Show helpicons
		$('#toggleHelp').live('click', function () {
			$('#krRTRC_RCOptions').toggleClass('nohelp');
		});

		// Link helpicons
		$('#krRTRC_RCForm .helpicon').attr('title', krMsg('clickforinfo'));
		$('#krRTRC_RCForm .helpicon').live('click', function () {
			window.open(docUrl + '#' + $(this).attr('section'), '_blank');
			return false;
		});

		// Clear rcuser-field
		// If MassPatrol is active, warn that clearing rcuser will automatically disable MassPatrol f
		$('#RCOptions_RcuserClr').live('click', function () {
			if (optMassPatrol) {
				var a = window.confirm(krMsg('masspatrol_userfilterconfirm'));
				if (a) {
					$('#rc-options-rcuser').val('');
					krRTRC_ToggleMassPatrol(false);
				}
			} else {
				$('#rc-options-rcuser').val('');
			}
			window.$RCOptions_submit.click();
		});

		// Tip
		$krRTRC_Tip = $('#krRTRC_Tip');
		$krRTRC_Tiptext = $('#krRTRC_Tiptext');
		$('#krRTRC_Tip').click(function () {
			krRTRC_TipOut();
		});
		$('#krRTRC_Tip').hover(function () {
			clearTimeout(window.krRTRC_TipTime);
		}, function () {
			window.krRTRC_TipTime = setTimeout(krRTRC_TipOut, 1000);
		});

		$('#krRTRC_list *').live('mouseover', function (e) {
			var $hovEl = false;

			mw.log(e);
			mw.log(e.target);
			if ($(e.target).is('.rcitem')) {
				$hovEl = $(e.target);
			} else if ($(e.target).parents('.rcitem').is('.rcitem')) {
				$hovEl = $(e.target).parents('.rcitem');
			}

			if ($hovEl) {
				krRTRC_TipIn($hovEl.find('.user'), $hovEl.find('.user').text(), $hovEl.hasClass('anoncontrib'));
			} else {
				krRTRC_TipOut();
			}

		});

		// Mark as patrolled when rollbacking
		// Note: As of MediaWiki r(unknown) rollbacking does already automatically patrol all reverted revisions. But by doing it anyway it saves a click for the AutoDiff-users
		$('.mw-rollback-link a').live('click', function () {
			$('.patrollink a').click();
		});

		// Button: MassPatrol
		$krRTRC_MassPatrol = $('#krRTRC_MassPatrol');
		$krRTRC_MassPatrol.live('click', function () {
			if (optMassPatrol) {
				krRTRC_ToggleMassPatrol(false);
			} else if (optAutoDiff) {
				krRTRC_ToggleMassPatrol(true);
			} else {
				var a = window.confirm(krMsg('masspatrol_autodiffneeded'));
				if (a) {
					optAutoDiff = true;
					$('#rc-options-autodiff').val('On').addClass('button-on');
					krRTRC_ToggleMassPatrol(true);
				}
			}
		});

		// Button: AutoDiff
		$('#rc-options-autodiff').live('click', function () {
			if (optAutoDiff) {
				if (optMassPatrol) {
					var a = window.confirm(krMsg('autodiff_masspatrolneeds'));
					if (a) {
						$('#rc-options-autodiff').val('Off').removeClass('button-on');
						optAutoDiff = false;
						krRTRC_ToggleMassPatrol(false);
					}
				} else {
					$(this).val('Off').removeClass('button-on');
					optAutoDiff = false;
				}
			} else {
				$(this).val('On').addClass('button-on');
				optAutoDiff = true;
			}
		});

		// Checkbox: AutoDiff from top
		$('#rc-options-autodiff-top').live('click', function () {
			if (optAutoDiffTop) {
				$(this).prop('checked', false);
				optAutoDiffTop = false;
			} else {
				$(this).prop('checked', true);
				optAutoDiffTop = true;
			}
		});

		// Button: Pause
		$('#krRTRC_toggleRefresh').live('click', function () {
			mw.log('#krRTRC_toggleRefresh clicked');
			if (rcRefreshEnabled) {
				rcRefreshEnabled = false;
				$(this).val('On').addClass('button-on');
				clearTimeout(rcRefreshTimeout);
			} else if (!rcRefreshEnabled) {
				rcRefreshEnabled = true;
				$(this).val('Off').removeClass('button-on');
				krRTRC_hardRefresh();
			} else {
				$(this).val('On').addClass('button-on');
				clearTimeout(rcRefreshTimeout);
			}
			return false;
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

		mw.loader.load('//meta.wikimedia.org/w/index.php?title=User:Krinkle/RTRC.css&action=raw&ctype=text/css', 'text/css', true);

		dModules = $.Deferred();
		mw.loader.using(['mediawiki.util', 'mediawiki.action.history.diff'], dModules.resolve, dModules.reject);

		$.when(
			!!window.krMsgs || $.getScript('//toolserver.org/~krinkle/I18N/export.php?lang=' + conf.wgUserLanguage),
			dModules.promise()
		).done(function () {
			var msg, ret,
				browserName = $.client.profile().name;

			// Reject bad browsers
			// TODO: Check versions as well, or better yet: feature detection
			if (browserName === 'msie') {
				msg = 'Internet Explorer is not supported. Please use a Mozilla or WebKit-based browser such as Chrome, Firefox or Safari.';
				$('#mw-content-text').empty().append(
					$('<p>').addClass('errorbox').text(msg)
				);
				return;
			}
			if (browserName === 'opera') {
				ret = confirm('Opera is currently not supported. Proceed at own risk or use a Mozilla or WebKit-based browser such as Chrome, Firefox or Safari.');
				if (!ret) {
					return;
				}
			}

			// Map over months
			monthNames = krMsg('months').split(',');

			// Start first phase of init
			krRTRC_init1();
		});
	}

}(jQuery, mediaWiki));
