/**
 * Real-Time Recent Changes
 * Created on April 25th, 2010
 *
 * @version 0.9.3 (2013-01-17)
 * @source meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes
 * @copyright Timo Tijhof, 2010 - 2013
 * @license CC-BY-SA 3.0 creativecommons.org/licenses/by-sa/3.0/
 * -------------------------------------------------
 * Dependencies: mediawiki.util
 * Loads: [[m:User:Krinkle/RTRC.css]], tools:~krinkle/I18N/export.php, skins/common/diff.css
 */
/*jshint browser:true, forin:false, undef:true, unused:true, smarttabs:true, white:false */
/*global $, mw, krMsgs, alert */
/*global wgUserLanguage, wgPageName, wgServer, wgAction, wgTitle */
(function () {
"use strict";
/**
 * Configuration
 * -------------------------------------------------
 */
	var krRTRC_appVersion = 'v0.9.3';
	var krRTRC_appDate = '2013-01-17';
	var krRTRC_APIURL = mw.util.wikiScript('api');
	var krRTRC_LoaderSRC = "//upload.wikimedia.org/wikipedia/commons/d/de/Ajax-loader.gif"; // 32x32px
	var krRTRC_BliconSRC = "//upload.wikimedia.org/wikipedia/commons/thumb/f/f7/Nuvola_apps_important.svg/18px-Nuvola_apps_important.svg.png"; // 18x15
	var krRTRC_HelpURL = '//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes?uselang=' + wgUserLanguage;
	var krRTRC_Disabled;
	// Disable RTRC ?
	//if ( typeof krRTRC_Disabled === 'undefined' || krRTRC_Disabled !== true ) {
		krRTRC_Disabled = false;
	//} else {
	//	krRTRC_Disabled = true;
	//}
	// Enable Debug ?
	var krRTRC_Debug;
	if ( typeof krRTRC_Debug === 'undefined' || krRTRC_Debug !== 1 ) {
		krRTRC_Debug = 0;
	} else {
		krRTRC_Debug = 1;
	}
	var krRTRC_MarkPatrolCacheMax = 20;

	// Are used later:
	var krRTRC_Patrolright = false;
	var krRTRC_Patroltoken = false;
	var krRTRC_Delhistright = false;
	var krRTRC_RCDataURL = false;
		var krRTRC_optLimit = "25";
		var krRTRC_optFiltAnon = false;
		var krRTRC_optFiltPatrol = false;
		var krRTRC_optUser = '';
		var krRTRC_optTypeEdit = true;
		var krRTRC_optTypeNewpage = true;
		var krRTRC_optPage = '';
		var krRTRC_optRctype = '';
		var krRTRC_optFrom = false;
		var krRTRC_optUntill = false;
		var krRTRC_optRcshow = '';
		var krRTRC_optRcprop = '';
		var krRTRC_optRcstart = '';
		var krRTRC_optNS = '';
		var krRTRC_optOrder = "desc";
		var krRTRC_optRcend = '';
		var krRTRC_optRInt = 3000;
		var krRTRC_optIRCBL = false;
	var krRTRC_RCTimeout = false;
	var krRTRC_RCEnabled = null;
	var krRTRC_RCLegendHTML = '';
	var krRTRC_MassPatrol = false;
	var krRTRC_AutoDiff = false;
	var krRTRC_AutoDiffTop = false;
	var krRTRC_DayHeadPrev = false;
	var krRTRC_SkipDiffs = [];
	var krRTRC_MarkPatrolCache = [];
	var krRTRC_Months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

	var krRTRC_SkipButon = '';
	var krRTRC_FeedMemHTML = '';
	var krRTRC_FeedMemUidArr = [];
	var krRTRC_TimeDiff = 0; // Difference UTC vs. wiki - fetched from siteinfo/timeoffset, in minutes
	var krRTRC_WikiID = "unknown"; // wgDBname
	var krRTRC_Updating = false;

	var krRTRC_optRcdir;
	var krRTRC_optAutoDiff;
	var krRTRC_optAutoDiffTop;
	var krRTRC_RCNamespaceDropdown;

	var $krRTRC_Tip, $krRTRC_MassPatrol, $krRTRC_Tiptext;
	/* implied globals, legacy click handlers */
	window.$RCOptions_submit = undefined;

/**
 * Tool Functions
 * -------------------------------------------------
 */
	// Logs a message if debugging is enabled
	function krLog(s,o){
		if(o){
			mw.log(s, o);
		} else {
			mw.log(s);
		}
	}

	if ( typeof String.prototype.ucFirst === 'undefined' ) {
		String.prototype.ucFirst = function(){
			return this.substr(0,1).toUpperCase() + this.substr(1,this.length);
		};
	}
	if ( typeof String.prototype.escapeRE === 'undefined' ) {
	        String.prototype.escapeRE = function() {
	                return this.replace(/([\\{}()|.?*+\^$\[\]])/g, "\\$1");
	        };
	}

	// Encode/decode htmlentities
	function krEncodeEntities(s){
		return $("<div/>").text(s).html();
	}

	// Get interface message
	function krMsg(key){
		if(krMsgs[key]){
			return krMsgs[key];
		}
		return key.ucFirst();
	}

	// Returns a GET-parameter as string
	function krGetUrlParam(s,url){
		return mw.util.getParamValue(s, url);
	}

	// Check if a variable is 'empty'
	function krEmpty(v){
		var key;

		if (v === "" || v === 0 || v === "0" || v === null || v === false || v === undefined) {
			return true;
		}

		if (typeof v === 'object'){
			for (key in v){
				return false;
			}
			return true;
		}

		return false;
	}

	// Trim whitespace
	// Thanks to http://blog.stevenlevithan.com/archives/faster-trim-javascript
	function krTrim(v){
		return v.replace(/^\s*((?:[\S\s]*\S)?)\s*$/, '$1');
	}

	// Prepends a leading zero if value is under 10
	function krRTRC_leadZ(i){
		if (i<10){ i="0" + i;}
		return i;
	}

	// Construct a URL to a page on the wiki
	function krRTRC_WikiLink(s){
		return mw.util.wikiGetlink(s);
	}

	// Adjust API-timestamp to local timezone time
	// Convert API-timestamp to Date()-readable
	// Example: "2010-04-25T23:24:02Z" => "2010/04/25 23:24:02"
	// Convert to UNIX Epoch - amount of ms to adjust
	function krRTRC_APITimeConv(s){
		s = s.toString(); // Possible number/integer to string
		s = s.replace("-","/").replace("-","/").replace("T"," ").replace("Z",""); // Convert to Date()-readable
		return new Date(s);
	}

	// Adjust API-timestamp to local timezone time
	// Convert API-timestamp to Date()-readable
	// Example: "2010-04-25T23:24:02Z" => "2010/04/25 23:24:02"
	// Convert to UNIX Epoch - amount of ms to adjust
	function krRTRC_AdjustAPIClocktime(s){
		var d = krRTRC_APITimeConv(s);
		var msd = krRTRC_TimeDiff*60*1000; // Get difference in miliseconds
		d.setTime(d.getTime()+msd); // Adjust object to difference
		return krRTRC_leadZ(d.getHours()) + ':'+krRTRC_leadZ(d.getMinutes()); // Return clocktime with leading zeros
	}

	// Adjust long timestamp to local timezone
	// - Converts from LongTime to Date()-readable
	// - Example: "20100424013000" => "20100424011000"
	// - Convert to UNIX Epoch - amount of ms to adjust
	// - Returns new LongTime
	function krRTRC_AdjustLongTime(s){
		s = s.toString(); // Possible number/integer to string
		s = s.substr(0,4) + '/'+s.substr(4,2) + '/'+s.substr(6,2) + ' '+s.substr(8,2) + ':'+s.substr(10,2) + ':'+s.substr(12,2); // Convert to Date()-readable
		var d = new Date(s);
		if ( d === 'Invalid Date' ) {
			krLog("krRTRC_AdjustLongTime: d-var: Invalid Date");
			return false;
		}
		var msd = krRTRC_TimeDiff*60*1000; // Get difference in miliseconds
		d.setTime(d.getTime()-msd); // Adjust object to difference
		return d.getFullYear() + ''+krRTRC_leadZ(d.getMonth()+1) + ''+krRTRC_leadZ(d.getDate()) + ''+krRTRC_leadZ(d.getHours()) + ''+krRTRC_leadZ(d.getMinutes()) + ''+krRTRC_leadZ(d.getSeconds()); // Return longtime with leading zeros
	}

	// Returns whether the given variable is an integer
	function krRTRC_isInt( i ) {
		return parseInt( i, 10 ) === i;
	}

	// Searches an array for the giving string
	// MUST be loose comparison
	function krInArray(s, array){
		/*jshint eqeqeq:false */
		var i;
		for ( i = 0; i < array.length; i += 1 ) {
			if ( array[i] == s ) {
				return true;
			}
		}
		return false;
	}


/**
 * App Main Functions
 * -------------------------------------------------
 */

	function krRTRC_RCDayHead(time) {
		var current = time.getDate();
		if ( current === krRTRC_DayHeadPrev ) {
			return '';
		}
		krRTRC_DayHeadPrev = current;
		return '<div class="item"><div><strong>' + time.getDate() + ' '+ krRTRC_Months[time.getMonth()] + '</strong></div></div>';
	}

	function krRTRC_BuildItem(type,title,rcid,revid,old_revid,user,timestamp,comment,patrolled,anon,oldlen,newlen){
		var diffsize, usertypeClass, el;

		// Get size difference in bytes (can be negative, zero or positive)
		diffsize = (+newlen) - (+oldlen);

		//patrolled-var is empty string if edit is patrolled, else undefined
		patrolled = patrolled === '' ? true : false;

		//anon-var is empty string if edit is by anon, else undefined
		anon = anon === '' ? true : false;

		// typeSymbol, diffLink & itemClass
		var typeSymbol = "&nbsp;";
		var itemClass = '';
		var diffLink = krMsg('diff');
		if (type === 'edit'){

			if (krRTRC_Patrolright === true && krRTRC_optFiltPatrol === 'on'){
				typeSymbol = '<span class="unpatrolled">!</span>';
			} else if (krRTRC_Patrolright === true && patrolled === false){
				typeSymbol = '<span class="unpatrolled">!</span>';
			}

			itemClass = 'rcitem';

		} else if (type === 'new'){

			itemClass = 'rcitem';

			typeSymbol = '<span class="newpage">N</span>';

		}

		// strip HTML from comment
		comment = comment.replace(/<&#91;^>&#93;*>/g, '');

		// Check if comment is AES
		if( comment.indexOf("[[COM:AES|←]]") === 0 ){
			itemClass += ' aes';
			comment = comment.replace("[[COM:AES|←]]", "← ");
		}

		// Anon-attribute
		if (anon){
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
		var item = krRTRC_RCDayHead(krRTRC_APITimeConv(timestamp));
		item += '<div class="item '+itemClass+usertypeClass+'" diff="'+revid+'" rcid="'+rcid+'" user="'+user+'">';

		if (type === 'edit'){
			diffLink = mw.util.wikiScript() + "?diff="+revid+"&oldif="+old_revid+"&rcid="+rcid;
			diffLink = '<a class="rcitemlink diff" diff="'+revid+'" rcid="'+rcid+'" href="'+diffLink+'">' + krMsg('diff') + '</a>';
		} else if (type === 'new'){
			diffLink = '<a class="rcitemlink newPage" rcid="'+rcid+'">new</a>';
		}


		item += '<div first>('+diffLink+') '+typeSymbol+' ';
		item += krRTRC_AdjustAPIClocktime(timestamp) + ' <a class="page" href="'+krRTRC_WikiLink(title) + '?rcid='+rcid+'" target="_blank">'+title+'</a></div>';
		item += '<div user>&nbsp;<small>&middot;&nbsp;<a href="'+krRTRC_WikiLink("User talk:"+user) + '" target="_blank">T</a> &middot; <a href="'+krRTRC_WikiLink("Special:Contributions/"+user) + '" target="_blank">C</a>&nbsp;</small>&middot;&nbsp;<a class="user" href="'+krRTRC_WikiLink("User:"+user) + '" target="_blank">'+user+'</a></div>';
		item += '<div other>&nbsp;<span class="comment">'+krEncodeEntities(comment) + '</span></div>';

		if (diffsize > 0){
			el = diffsize > 399 ? "strong" : "span";
			item += '<div size><'+el+' class="mw-plusminus-pos">('+diffsize+')</'+el+'></div>';
		} else if (diffsize === 0){
			item += '<div size><span class="mw-plusminus-null">(0)</span></div>';
		} else {
			el = diffsize < -399 ? "strong" : "span";
			item += '<div size><'+el+' class="mw-plusminus-neg">('+diffsize+')</'+el+'></div>';
		}

		item += '</div>';
		return item;
	}

	function krRTRC_GetRCOptions(){

		krRTRC_optLimit = $("#rc-options-limit").val();

		krRTRC_optFiltAnon = $("#rc-options-filter-anons:checked").val();
		krRTRC_optRcshow = krRTRC_optFiltAnon === 'on' ? "|anon" : '';

		krRTRC_optFiltPatrol = $("#rc-options-filter-unpatrolled:checked").val();
		if (krRTRC_optFiltPatrol === 'on'){ krRTRC_optRcshow += "|!patrolled";
		}

		if (krRTRC_Patrolright === true){ krRTRC_optRcprop = "|patrolled";}

		krRTRC_optUser = $("#rc-options-rcuser").val() === '' ? false : krTrim($("#rc-options-rcuser").val());
		if (!krEmpty(krRTRC_optUser)){
			krRTRC_optUser = "&rcuser="+krRTRC_optUser;
		} else { krRTRC_optUser = ''; }

		krRTRC_optTypeEdit = $("#rc-options-type-edit:checked").val() === 'on' ? true : false;
		krRTRC_optTypeNewpage = $("#rc-options-type-newpage:checked").val() === 'on' ? true : false;
		krRTRC_optRctype = [];
		if (krRTRC_optTypeEdit){ krRTRC_optRctype.push('edit'); }
		if (krRTRC_optTypeNewpage){ krRTRC_optRctype.push('new'); }
		krRTRC_optRctype = krRTRC_optRctype.join("|");

		if (krRTRC_optRctype === ''){
			// If all of, enable all
			$("#rc-options-type-edit").click();
			$("#rc-options-type-newpage").click();
			krRTRC_optRctype = 'edit|new';
		}

		/* RCTITLES DISABLED:
		krRTRC_optPage = $("#rc-options-rctitle").val() === '' ? false : krTrim($("#rc-options-rctitle").val());
		if (!krEmpty(krRTRC_optPage)){
			krRTRC_optPage = "&rctitles="+krRTRC_optPage;
		} else { krRTRC_optPage = ''; }
		*/

		krRTRC_optFrom = krEmpty(krTrim($("#rc-options-timeframe-rcfrom").val())) ? false : krTrim($("#rc-options-timeframe-rcfrom").val());
		krRTRC_optUntill = krEmpty(krTrim($("#rc-options-timeframe-rcuntill").val())) ? false : krTrim($("#rc-options-timeframe-rcuntill").val());

		if (krRTRC_optOrder === 'older'){
			if ( krRTRC_isInt(parseInt(krRTRC_optUntill, 10)) && krRTRC_AdjustLongTime(krRTRC_optUntill) ){
				krRTRC_optRcstart = "&rcstart="+krRTRC_AdjustLongTime(krRTRC_optUntill);
			} else { krRTRC_optRcstart = '';}
			if ( krRTRC_isInt(parseInt(krRTRC_optFrom, 10)) && krRTRC_AdjustLongTime(krRTRC_optFrom) ){
				krRTRC_optRcend = "&rcend="+krRTRC_AdjustLongTime(krRTRC_optFrom);
			} else { krRTRC_optRcend = '';}
		} else if (krRTRC_optOrder === 'newer'){
			if ( krRTRC_isInt(parseInt(krRTRC_optFrom, 10)) && krRTRC_AdjustLongTime(krRTRC_optFrom) ){
				krRTRC_optRcstart = "&rcstart="+krRTRC_AdjustLongTime(krRTRC_optFrom);
			} else { krRTRC_optRcstart = '';}
			if ( krRTRC_isInt(parseInt(krRTRC_optUntill, 10)) && krRTRC_AdjustLongTime(krRTRC_optUntill)){
				krRTRC_optRcend = "&rcend="+krRTRC_AdjustLongTime(krRTRC_optUntill);
			} else { krRTRC_optRcend = '';}
		}

		krRTRC_optNS = $("#rc-options-namespace").val();

		krRTRC_optRcdir = $("input[name='rc-options-rcdir']:checked").val();
		krRTRC_optOrder = krRTRC_optRcdir === 'asc' ? 'newer' : 'older';

		krRTRC_optRInt = parseInt($("#rc-options-interval").val(), 10)*1000;

		krRTRC_optIRCBL = $("#rc-options-ircbl:checked").val() === 'on' ? true : false;

		krRTRC_optAutoDiff = $("#rc-options-autodiff").val();
		krRTRC_AutoDiff = krRTRC_optAutoDiff === 'On' ? true : false;
		krRTRC_optAutoDiffTop = $("#rc-options-autodiff-top:checked").val();
		krRTRC_AutoDiffTop = krRTRC_optAutoDiffTop === 'on' ? true : false;

		krRTRC_RCDataURL = krRTRC_APIURL+"?action=query&format=xml&list=recentchanges"+krRTRC_optUser+''+krRTRC_optPage+"&rctype="+krRTRC_optRctype+"&rcshow=!bot"+krRTRC_optRcshow+"&rcprop=flags|timestamp|user|title|comment|sizes|ids"+krRTRC_optRcprop+"&rcnamespace="+krRTRC_optNS+"&rclimit="+krRTRC_optLimit+"&rcdir="+krRTRC_optOrder+krRTRC_optRcstart+krRTRC_optRcend;
		return krRTRC_RCDataURL;
	}

	function krRTRC_RebindElements() { //called when the list is refreshed

		// Re-apply "skipped" and "patrolled" classes
		$("#krRTRC_RCOutput>.feed div.rcitem").each(function(){

			// Compare each diff-attribute to the array, if match mark item with the class

			if(krInArray($(this).attr("rcid"), krRTRC_SkipDiffs)){
				$(this).addClass("skipped");
			} else if(krInArray($(this).attr("rcid"), krRTRC_MarkPatrolCache)){
				$(this).addClass("patrolled");
			}
		});

		// The current diff in diff-view stays marked
		$("#krRTRC_RCOutput>.feed div[rcid="+window.currentDiffRcid+"]").addClass("indiff");

		// All http-links within the diff-view open in a new window
		$('#krRTRC_DiffFrame>table.diff a[href^="http://"],#krRTRC_DiffFrame>table.diff a[href^="https://"],#krRTRC_DiffFrame>table.diff a[href^="//"]').attr("target", "_blank");

	}

	function krRTRC_PushFrontend(){
		$("#krRTRC_RCOutput").removeClass("placeholder");
		$("#krRTRC_RCOutput>.feed").html(krRTRC_FeedMemHTML);

		krRTRC_RebindElements();// rebind elements
		krRTRC_DayHeadPrev = '';// reset day
		krRTRC_RCTimeout = setTimeout(krRTRC_Refresh, krRTRC_optRInt);
		$("#krRTRC_loader").hide();
	}

	function krRTRC_ApplyIRCBL(){ if (krRTRC_Updating === true){ // Only run if there's an update going on
		krRTRC_FeedMemUidArr = [];

		$(krRTRC_FeedMemHTML).find("div.item").each(function(index, el){
			krRTRC_FeedMemUidArr.push($(el).attr("user"));
		});
		krRTRC_FeedMemUidArr.shift();

		try { // Parsing json could cause fatal error if url is not HTTP 200 OK (ie. HTTP 404 Error)
		$.ajax({
			url: "//toolserver.org/~krinkle/CVN/API/?raw=0&format=json&uid="+krRTRC_FeedMemUidArr.join("|")+"&jsoncallback=?",
			timeout: 500,
			dataType: 'json',
			success: function(data){

				// If none of the users appear in the database at all, then data.users is null
				if(data.users){

					// Loop through all users
					$.each(data.users, function(i, val){ // i=username, val=object

						// Only if blacklisted, otherwise dont highlight
						if(val.usertype === 'bl'){

							var tooltip = '';

							// Get blacklist reason
							if(val.reason){ tooltip += krMsg('reason') + ': '+val.reason+". ";
							} else { tooltip += krMsg('noreasonfound'); }

							// Get blacklist adder
							if(val.adder){ tooltip += krMsg('adder')+": "+val.adder;
							} else { tooltip += krMsg('adder')+": "+krMsg('unknown'); }

							// Apply blacklisted-class, and insert icon with tooltip
							krRTRC_FeedMemHTML = $("<div>"+krRTRC_FeedMemHTML+"</div>").find("div.item[user="+i+"] .user").addClass("blacklisted").prepend('<img src="'+krRTRC_BliconSRC+'" alt="" title="'+tooltip+'" />').attr("title", tooltip).end().html();
						}

					});
				}

				// Either way, push the feed to the frontend
				krRTRC_PushFrontend();
				$("#krRTRC_RCOutput>.feed").append('<small id="krRTRC_Dumpdate">CVN DB ' + krMsg('lastupdate') + ': '+data.dumpdate+' (UTC)</small>');
				krRTRC_Updating = false;
			},
			error: function () {
				// Ignore errors, just push to frontend
				krRTRC_PushFrontend();
				krRTRC_Updating = false;
			}
		});
		} catch(e) {
			// Ignore errors, just push to frontend
			krRTRC_PushFrontend();
			krRTRC_Updating = false;
		}

	} }

	function krRTRC_Refresh(){
		if(krRTRC_RCEnabled === true && krRTRC_Updating === false){

			// Indicate updating
			$("#krRTRC_loader").show();
			krRTRC_Updating = true;
			// Download recent changes
			$.ajax({
				type: "GET",
				url: krRTRC_RCDataURL,
				dataType: "xml",
				success: function(rawback){

					// Last-update heading
						// Get current time + localtime adjustment
						var lastupdate = new Date();
						var msd = krRTRC_TimeDiff*60*1000;
						lastupdate.setTime(lastupdate.getTime()+msd);
						krRTRC_FeedMemHTML = '<div id="krRTRC_lastupdate">' + krMsg('lastupdate') + ': '+lastupdate.toUTCString() + ' | <a href="'+krRTRC_GeneratePermalink() + '">' + krMsg('permalinktext') + '</a></div>';

					// API errors ?
					if( $(rawback).find('error').length > 0 ){

						krLog("krRTRC_GetRCData()-> "+$(rawback).find('rc').length+" errors");
						$("#krRTRC_RCOutput").removeClass("placeholder");

						// Account doesnt have patrol flag
						if($(rawback).find('error').attr("code") === "rcpermissiondenied"){
							krRTRC_FeedMemHTML += '<h3>Downloading recent changes failed</h3><p>Please untick the "Unpatrolled only"-checkbox or request the Patroller-right on <a href="'+wgServer+'">'+wgServer+'</a>';

						// Other error
						} else {

							krRTRC_FeedMemHTML += '<h3>Downloading recent changes failed</h3><p>Please check the settings above and try again. If you believe this is a bug, please <a href="//meta.wikimedia.org/w/index.php?title=User_talk:Krinkle/Tools&action=edit&section=new&editintro=User_talk:Krinkle/Tools/Editnotice&preload=User_talk:Krinkle/Tools/Preload" target="_blank"><strong>let me know</strong></a>.';
						}
						krRTRC_PushFrontend();
						krRTRC_Updating = false;

					// Everything is OK - with results
					} else if( $(rawback).find('rc').length > 0 ){

						var htmloutput = '<div id="krRTRC_list">';
						$(rawback).find('rc').each(function () {
							htmloutput += krRTRC_BuildItem($(this).attr("type"),$(this).attr("title"),$(this).attr("rcid"),$(this).attr("revid"),$(this).attr("old_revid"),$(this).attr("user"),$(this).attr("timestamp"),$(this).attr("comment"),$(this).attr("patrolled"),$(this).attr("anon"),$(this).attr("oldlen"),$(this).attr("newlen"));
						});
						krRTRC_FeedMemHTML += htmloutput+"</div>";
						if(krRTRC_optIRCBL===true){
							krRTRC_ApplyIRCBL();
							//krRTRC_Updating is set to false within krRTRC_ApplyIRCBL()
						} else {
							krRTRC_PushFrontend();
							krRTRC_Updating = false;
						}

					// Everything is OK - no results
					} else {
						krRTRC_FeedMemHTML += '<strong><em>' + krMsg('nomatches') + '</em></strong>';
						krRTRC_PushFrontend();
						krRTRC_Updating = false;
					}

					window.$RCOptions_submit.prop('disabled', false).css('opacity', '1.0');
				}

			});
		}
	}

	function krRTRC_hardRefresh(){

		krRTRC_RCEnabled = true;
		$("#krRTRC_toggleRefresh").val("Off").removeClass("button-on");
		krRTRC_GetRCOptions();
		clearTimeout(krRTRC_RCTimeout);
		krRTRC_Refresh();
	}

	// Checks the GET-parameters and manipulates #krRTRC_RCOptions
	// Also initiates jumpstart
	function krRTRC_ProcesPermalink(l){
		var get = krGetUrlParam('rclimit',l);
			$("#rc-options-limit option[value=" + get + "]").prop("selected", true);
		get = krGetUrlParam('rcshow_anon',l);
			if ( get === "on" ) { $("#rc-options-filter-anons").prop("checked", true);}
		get = krGetUrlParam('rcshow_patrol',l);
			if ( get === "on" ) { $("#rc-options-filter-unpatrolled").prop("checked", true);}
		get = krGetUrlParam('rcuser',l);
			$("#rc-options-rcuser").val(get);
		get = krGetUrlParam('typeedit',l);
			if ( get === "off" ) { $("#rc-options-type-edit").prop("checked", false);}
		get = krGetUrlParam('typenewpage',l);
			if ( get === "off" ) { $("#rc-options-type-newpage").prop("checked");}
		/* RCTITLES DISABLED:
		get = krGetUrlParam('rctitles',l);
		$("#rc-options-rctitle").val(get);
		*/
		get = krGetUrlParam('rcfrom',l);
			$("#rc-options-timeframe-rcfrom").val(get);
		get = krGetUrlParam('rcuntill',l);
			$("#rc-options-timeframe-rcuntill").val(get);
		get = krGetUrlParam('rcnamespace', l);//krRTRC_optNS
			$("#rc-options-namespace option[value="+get+"]").attr("selected", "selected");
		get = krGetUrlParam('rcdir',l);
			if ( get === "asc" ) {
				$("#krRTRC_RCOptions input[name=rc-options-rcdir][value=asc]").prop("checked", true);
				$("#krRTRC_RCOptions input[name=rc-options-rcdir][value=desc]").prop("checked", false);
			}
		get = krGetUrlParam('ajaxint',l);
			if (get !== "" && get !== " " && get !== null && get !== false){ $("#rc-options-interval").val(get);}
		get = krGetUrlParam('ircbl',l);
			if ( get === "on" ) { $("#rc-options-ircbl").prop("checked", true);}
		get = krGetUrlParam('autodiff');
			if ( get === "on" ) { $("#rc-options-autodiff").val("On").addClass("button-on");}
		get = krGetUrlParam('autodiff_top',l);
			if ( get === "on" ) { $("#rc-options-autodiff-top").prop("checked", true);}
		get = krGetUrlParam('jumpstart',l);
			if ( get === "on" ) {
				get = krRTRC_GetRCOptions();
				krRTRC_hardRefresh();
				window.location.hash = '';
				window.location.hash = 'toggleHelp';
			}
	}

	// Checks the settings and returns a the permalink that would reproduce these settings manipulates #krRTRC_RCOptions
	function krRTRC_GeneratePermalink(){
	var a = '&rclimit='+krRTRC_optLimit;
		a += krRTRC_optFiltAnon === 'on' ? '&rcshow_anon=on' : '';
		a += krRTRC_optFiltPatrol === 'on' ? '&rcshow_patrol=on' : '';
		a += krRTRC_optUser || '';
		a += krRTRC_optTypeEdit ? '' : '&typeedit=off';
		a += krRTRC_optTypeNewpage ? '' : '&typenewpage=off';
		a += krRTRC_optPage || '';
		a += krRTRC_optFrom === false ? '' : '&rcfrom='+krRTRC_optFrom;
		a += krRTRC_optUntill === false ? '' : '&rcuntill='+krRTRC_optUntill;
		a += krRTRC_optNS === '' ? '' : '&rcnamespace='+krRTRC_optNS;
		a += '&rcdir=';
			a += krRTRC_optRcdir === 'asc' ? 'asc' : 'desc';
		a += Math.round(krRTRC_optRInt/1000) !== 3 ? '&ajaxint='+Math.round(krRTRC_optRInt/1000) : '';
		a += krRTRC_optIRCBL ? '&ircbl=on' : '';
		a += krRTRC_AutoDiff ? '&autodiff=on' : '';
		a += krRTRC_AutoDiffTop ? '&autodiff_top=on' : '';
		return mw.util.wikiScript() + '?' + $.param({title: wgPageName, jumpstart: 'on' }) + a;
	}

	function krRTRC_NextDiff() {
		var $lis = $("#krRTRC_RCOutput>.feed div.rcitem:not(.indiff,.patrolled,.skipped)");
		if(krRTRC_AutoDiffTop === true) {
			$lis.eq(0).find("a.rcitemlink").click();
		} else {
			// eq(-1) doesn't work somehow..
			$lis.eq($lis.length-1).find(" a.rcitemlink").click();
		}
	}

	function krRTRC_TipIn($targetEl, uid, is_anon){
		var o, links;
		krLog("krRTRC_TipIn()");
		o = $targetEl.offset();
		if(is_anon){
			links = ' · <a target="_blank" title="Whois '+uid+'?" href="//toolserver.org/~chm/whois.php?ip='+uid+'">WHOIS</a>';
		} else {
			links = '';
		}
		links += ' · <a target="_blank" title="View cross-wiki contributions" href="//toolserver.org/~luxo/contributions/contributions.php?user='+uid+'&blocks=true">CrossWiki</a>';
		if(krRTRC_Delhistright === true){
			links += ' · <a target="_blank" title="View deleted contributions" href="'+krRTRC_WikiLink('Special:DeletedContributions/'+uid) + '">DeletedContributions</a>'; 
		}
		$krRTRC_Tiptext.html('<a id="krRTRC_Tip_FilterAdd" onclick="$(\'#rc-options-rcuser\').val(\''+uid+'\'); window.$RCOptions_submit.click();" uid="'+uid+'" title="Filter by '+uid+'">[+<small>filter</small>]</a>'+links);
		$krRTRC_Tip.css({"left" : o.left+"px", "top" : (o.top-23)+"px", "display" : "block"}).show();
		window.krRTRC_TipTime = setTimeout(krRTRC_TipOut,3000);
	}

	function krRTRC_TipOut(){
		if (window.krRTRC_TipTime !== undefined) {
			clearTimeout(window.krRTRC_TipTime);
		}
		$krRTRC_Tip.hide();
	}

	function krRTRC_ToggleMassPatrol(b) {
		if(b === true){
			krRTRC_MassPatrol = true;
			$krRTRC_MassPatrol.val("On").addClass("button-on");
			if(window.currentDiff === ''){
				krRTRC_NextDiff();
			} else {
				$(".patrollink a").click();
			}
		} else {
			krRTRC_MassPatrol = false;
			$krRTRC_MassPatrol.val("Off").removeClass("button-on");
		}

	}

	function krRTRC_GetPatroltoken(){
		$.ajax({
			type: "GET",
			url: krRTRC_APIURL+"?action=query&format=xml&list=recentchanges&rctoken=patrol&rclimit=1&rctype=new", //added rctype=new because several wikis only do newpages, by getting all rcs changes are it'll return an edit and thus error instead of token. Unless there are wikis with RC-patrol but no NP-patrol (as supposed to both or the opposite), this will be just fine. If there are wikis without NP-patrol but with RC-patrol, we'll have to split up somewhere around here.
			dataType: "xml",
			success: function(rawback){
				krRTRC_Patroltoken = $(rawback).find('rc').attr("patroltoken");
				if(krRTRC_Patroltoken){
					krRTRC_Patroltoken = krRTRC_Patroltoken.replace("+","%2B").replace("\\","%5C");
				} else {
					krRTRC_Patroltoken = false;
				}
			}
		});
	}

	// Init Phase 1 : When the DOM is ready
	function krRTRC_init1(){
		krLog("Init Phase 1 started");
		while (krRTRC_initFuncs.length > 0) {
			(krRTRC_initFuncs.shift())();
		}
		krLog("Init Phase 1 done");
	}

	// Init Phase 2 : Called in GetIntMsgs()
	function krRTRC_init2(){
		krLog("Init Phase 2 started");
		while (krRTRC_initFuncs2.length > 0) {
				(krRTRC_initFuncs2.shift())();
		}
		krLog("Init Phase 2 done");
	}


/**
 * App Initiate Functions (Phase 1, pre IntMsg)
 * -------------------------------------------------
 */
	// CheckRights, GetPatrol, GetSiteinfo, GetIntMsg
	var krRTRC_initFuncs = [];

	// function CheckRights()
	//
	// Checks the userrights of the current user via the API
	krRTRC_initFuncs[0] = function () {
		$.ajax({
			type: "GET",
			url: krRTRC_APIURL+"?action=query&meta=userinfo&uiprop=rights&format=xml",
			dataType: "xml",
			success: function(rawback){
				if ($(rawback).find("r:contains('patrol')").length > 0){
					$(rawback).find("r:contains('patrol')").each(function(){
						if ($(this).text() === 'patrol' && krRTRC_Patrolright === false){
							krRTRC_Patrolright = true;
						}
					});
				}
				if ($(rawback).find("r:contains('deletedhistory')").length > 0){
					$(rawback).find("r:contains('deletedhistory')").each(function(){
						if ($(this).text() === 'deletedhistory' && krRTRC_Delhistright === false){
							krRTRC_Delhistright = true;
						}
					});
				}
			}
		});
	};

	// function GetPatroltoken()
	//
	// Requests a patroltoken via the API
	krRTRC_initFuncs[1] = function(){
		krRTRC_GetPatroltoken();
	};

	// function GetSiteInfo()
	//
	// Downloads siteinfo via the API
	krRTRC_initFuncs[2] = function(){
		$.ajax({
			type: "GET",
			url: krRTRC_APIURL+"?action=query&meta=siteinfo&format=xml",
			dataType: "xml",
			success: function(rawback){
				krRTRC_TimeDiff = $(rawback).find('general').attr("timeoffset");
				krRTRC_WikiID = $(rawback).find('general').attr("wikiid");
				document.title = "RTRC: "+krRTRC_WikiID;
			}
		});
	};

	// function GetIntMsgs()
	//
	// Downloads interface messages via the API
	krRTRC_initFuncs[3] = function(){

		$.getJSON(krRTRC_APIURL+"?action=query&format=json&meta=allmessages&amlang="+wgUserLanguage+"&ammessages=show|hide|ascending abbrev|descending abbrev|markaspatrolleddiff|markedaspatrolled|markedaspatrollederror|next|diff|talkpagelinktext|contributions|recentchanges-label-legend|recentchanges-label-bot|recentchanges-label-minor|recentchanges-label-newpage|recentchanges-label-unpatrolled|recentchanges-legend-bot|recentchanges-legend-minor|recentchanges-legend-newpage|recentchanges-legend-unpatrolled|namespaces|namespacesall|blanknamespace&callback=?", function(data) {
			var i;
			krLog("GetIntMsgs->"+data); krLog(data);
			data = data.query.allmessages;
			for(i = 0; i < data.length; i += 1){
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
	var krRTRC_initFuncs2 = [];

	// function BuildPage()
	//
	// Prepares the page
	krRTRC_initFuncs2[0] = function(){
		$("#p-namespaces>ul>li").removeClass("new").find(">a>span").eq(0).html("Tool");
		$("#ca-talk").removeClass("new").find(">a").attr("href", "//meta.wikimedia.org/w/index.php?title=User_talk:Krinkle/Tools&action=edit&section=new&editintro=User_talk:Krinkle/Tools/Editnotice&preload=User_talk:Krinkle/Tools/Preload").attr("target", "_blank").find(">span").html("Feedback");
		$("#footer").remove();
		$("#content").addClass("krRTRC_body");
		krRTRC_RCLegendHTML = '<div id="krRTRC_RCLegend">' + krMsg('recentchanges-label-legend').replace("$1.", '') + ' <abbr class="newpage" title="' + krMsg('recentchanges-label-newpage') + '">N</abbr>' + krMsg('recentchanges-legend-newpage').replace("$1", '') + ', <!--<abbr class="minor" title="'+krMsg('recentchanges-label-minor') + '">m</abbr>'+krMsg('recentchanges-legend-minor').replace("$1", '') + ', <abbr class="bot" title="'+krMsg('recentchanges-label-bot') + '">b</abbr>'+krMsg('recentchanges-legend-bot').replace("$1", '') + ', --><abbr class="unpatrolled" title="'+krMsg('recentchanges-label-unpatrolled') + '">!</abbr>'+krMsg('recentchanges-legend-unpatrolled').replace("$1", '') + '<br />Colors: <div class="item patrolled inline-block">&nbsp;' + krMsg('markedaspatrolled') + '&nbsp;</div>, <div class="item indiff inline-block">&nbsp;' + krMsg('currentedit') + '&nbsp;</div>, <div class="item skipped inline-block">&nbsp;' + krMsg('skippededit') + '&nbsp;</div>, <div class="item aes inline-block">&nbsp;Edit with an Automatic Edit Summary&nbsp;</div><br />' + krMsg('abbreviations') + ': T - ' + krMsg('talkpagelinktext') + ', C - ' + krMsg('contributions') + '</div>';
		krRTRC_RCNamespaceDropdown = '<select id="rc-options-namespace" name="rc-options-namespace">';
		krRTRC_RCNamespaceDropdown += '<option value>' + krMsg('namespacesall') + '</option>';
		krRTRC_RCNamespaceDropdown += '<option value="0">' + krMsg('blanknamespace') + '</option>';

		var fmNs = mw.config.get( 'wgFormattedNamespaces' ), ns;
		for(ns in fmNs){
			if(ns > 0){ krRTRC_RCNamespaceDropdown += '<option value="'+ns+'">'+fmNs[ns]+'</option>'; }
		} krRTRC_RCNamespaceDropdown += '</select>';
		$("#content").html(
		'<div id="content-inner"><div id="krRTRC_PageWrap" class="plainlinks">' +
			'<div id="krRTRC_Topbar">Real-Time Recent Changes <small class="ns">('+krRTRC_appVersion+' as of '+krRTRC_appDate+')</small><small id="toggleHelp">[help]</small><a target="_blank" href="'+krRTRC_WikiLink("Special:Log/patrol") + '?user='+encodeURIComponent(mw.user.name()) + '" style="float:right;font-size:smaller;color:#ccc">&nbsp;[' + krMsg('mypatrollog') + ']&nbsp;</a></div>' +
			'<div id="krRTRC_RCForm"><fieldset id="krRTRC_RCOptions" class="nohelp"><form>' +
				'<div class="panel"><label for="rc-options-limit" class="head">' + krMsg('limit') + '</label><select id="rc-options-limit" name="rc-options-limit"><option value="10">10</option><option selected="" value="25">25</option><option value="50">50</option><option value="75">75</option><option value="100">100</option></select></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label class="head">' + krMsg('filter') + '</label><div style="text-align:left"><input type="checkbox" value="on" id="rc-options-filter-anons" name="rc-options-filter-anons"><label for="rc-options-filter-anons"> ' + krMsg('anononly') + '</label><br /><input type="checkbox" value="on" id="rc-options-filter-unpatrolled" name="rc-options-filter-unpatrolled"><label for="rc-options-filter-unpatrolled"> ' + krMsg('unpatrolledonly') + '</label></div></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label for="rc-options-rcuser" class="head">' + krMsg('userfilter-opt') + ' <span section="Userfilter" class="helpicon"></span></label><div style="text-align:center"><input type="text" value="" size="16" id="rc-options-rcuser" name="rc-options-rcuser" /><br /><input class="button" type="button" id="RCOptions_RcuserClr" value="' + krMsg('clear') + '" /></div></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label class="head">' + krMsg('type') + '</label><div style="text-align:left"><input type="checkbox" value="on" id="rc-options-type-edit" name="rc-options-type-edit" checked="checked"><label for="rc-options-type-edit"> ' + krMsg('edits') + '</label><br /><input type="checkbox" checked="checked" value="on" id="rc-options-type-newpage" name="rc-options-type-newpage"><label for="rc-options-type-newpage"> ' + krMsg('newpages') + '</label></div></div>' +
				'<div class="sep"></div>' +
				// RCTITLES DISABLED: https://bugzilla.wikimedia.org/show_bug.cgi?id=12394#c5
				// '<div class="panel"><label class="head" for="rc-options-rctitle">' + krMsg('pagefilter-opt') + ' <span section="Pagefilter" class="helpicon"></span></label><div style="text-align:center"><input type="text" value="" size="16" id="rc-options-rctitle" name="rc-options-rctitle" /><br /><input class="button" type="button" id="RCOptions_RctitleClr" value="' + krMsg('clear') + '" /></div></div>' +
				//'<div class="sep"></div>' +
				'<div class="panel"><label class="head">' + krMsg('timeframe-opt') + ' <span section="Timeframe" class="helpicon"></span></label><div style="text-align:right"><label for="rc-options-timeframe-rcfrom">' + krMsg('from') + ': </label><input type="text" value="" size="14" id="rc-options-timeframe-rcfrom" name="rc-options-timeframe-rcfrom"><br /><label for="rc-options-timeframe-rcuntill">' + krMsg('untill') + ': </label><input type="text" value="" size="14" id="rc-options-timeframe-rcuntill" name="rc-options-timeframe-rcuntill"></div></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label for="rc-options-namespace" class="head">' + krMsg('namespaces') + '</label>' + krRTRC_RCNamespaceDropdown + '</div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label class="head">' + krMsg('order') + ' <br /><span section="Order" class="helpicon"></span></label><div style="text-align:left"><input type="radio" name="rc-options-rcdir" value="asc"> ' + krMsg('asc') + ' <br /><input type="radio" name="rc-options-rcdir" value="desc" checked="checked"> ' + krMsg('desc') + ' </div></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label for="rc-options-interval" class="head">R <br /><span section="Reload_Interval" class="helpicon"></span></label><input type="text" value="3" size="1" id="rc-options-interval" name="rc-options-interval"></div>' +
				'<div class="sep"></div>' +
				'<div class="panel"><label class="head" for="rc-options-ircbl">IRCBL<br /><span section="IRC_Blacklist" class="helpicon"></span></label><input type="checkbox" value="on" size id="rc-options-ircbl" name="rc-options-ircbl" /></div>' +
				'<div class="sep"></div>' +
				'<div class="panel panel-last"><input class="button" type="button" id="RCOptions_submit" value="' + krMsg('apply') + '" /></div>' +
				'<hr style="clear:both" />' +
				'<div class="panel2"><label for="krRTRC_MassPatrol" class="head">MassPatrol <span section="MassPatrol" class="helpicon"></span></label><input id="krRTRC_MassPatrol" class="button button-off" type="button" value="Off" /></div>' +
				'<div class="sep2"></div>' +
				'<div class="panel2"><label for="rc-options-autodiff" class="head">AutoDiff <span section="AutoDiff" class="helpicon"></span></label><input type="button" class="button button-off" value="Off" id="rc-options-autodiff" /> <input type="checkbox" value="on" id="rc-options-autodiff-top" /> <label for="rc-options-autodiff-top"> ' + krMsg('loadfromtop') + '</label></div>' +
				'<div class="sep2"></div>' +
				'<div class="panel2"><label for="krRTRC_toggleRefresh" class="head">Pause</label><input id="krRTRC_toggleRefresh" class="button button-off" type="button" value="Off" /></div>' +
			'</fieldset></form></div>' +
			'<a name="krRTRC_DiffTop" />' +
			'<div id="krRTRC_DiffFrame" style="display:none"></div>' +
			'<div id="krRTRC_RCOutput" class="placeholder">'+krRTRC_RCLegendHTML+'</div>' +
			'<div style="clear:both"></div>' +
			'<div id="krRTRC_Footer"><div class="inside">' +
				'<span style="float:left"><a href="//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes" class="external text" rel="nofollow">' + krMsg('documentation') + '</a></span>' +
				'Real-Time Recent Changes by <a href="//commons.wikimedia.org/wiki/User:Krinkle" class="external text" rel="nofollow">Krinkle</a> is licensed under a <a href="//creativecommons.org/licenses/by-sa/3.0" class="external text" rel="nofollow">Creative Commons Attribution-Share Alike 3.0 Unported License</a>.' +
				'<span style="float:right"><a href="//meta.wikimedia.org/wiki/User:Krinkle/Tools/Real-Time_Recent_Changes#Changelog" id="krwhosonline" class="external text" rel="nofollow">' + krMsg('whatsnew') + '</a></span>' +
			'</div></div>');
		$("body").append("<div id='krRTRC_Tip'><span id='krRTRC_Tiptext'></span></div>");

		$("#content-inner").css("position", "relative");
		$("#krRTRC_RCOutput").prepend('<div class="feed"></div><img src="'+krRTRC_LoaderSRC+'" id="krRTRC_loader" style="display:none" />');
	};

	// function ProcesPermalink()
	krRTRC_initFuncs2[1] = function(){
		krRTRC_ProcesPermalink();
	};

	// function Bindevents()
	//
	// Binds events to the user interface
	krRTRC_initFuncs2[2] = function(){

		window.$RCOptions_submit = $("#RCOptions_submit");

		// Apply button
		window.$RCOptions_submit.click(function(){
			window.$RCOptions_submit.prop('disabled', true).css('opacity', '0.5');
			krRTRC_GetRCOptions();
			krRTRC_hardRefresh();
			return false;
		});

		// Close Diff
		$("#diffClose").live("click", function(){
			$("#krRTRC_DiffFrame").fadeOut('fast');
			window.currentDiff = '';
			window.currentDiffRcid = '';
		});

		// Load diffview on (diff)-link click
		window.currentDiff = '';
		window.currentDiffRcid = '';
		$("a.diff").live("click", function() {
			window.currentDiff = $(this).attr("diff");
			window.currentDiffRcid = $(this).attr("rcid");
			var title = $(this).parent().find(">a.page").text();
			var href = $(this).parent().find(">a.diff").attr('href');
			$("#krRTRC_DiffFrame").removeAttr('style'/* this resets style="max-height:400" from a.newPage below */).load(mw.util.wikiScript() + '?action=render&diff='+window.currentDiff+'&diffonly=1&uselang='+wgUserLanguage, function() {
				$(this).html($(this).html().replace("diffonly=", "krinkle=").replace("diffonly=", "krinkle="));
				if (krInArray(window.currentDiffRcid, krRTRC_SkipDiffs)){
					krRTRC_SkipButon = '<span class="tab"><a id="diffUnskip">Unskip</a></span>';
				} else {
					krRTRC_SkipButon = '<span class="tab"><a id="diffSkip">Skip</a></span>';
				}
			$("#krRTRC_DiffFrame").fadeIn().prepend('<h3>'+title+'</h3><div id="krRTRC_DiffTools"><span class="tab"><a id="diffClose">X</a></span><span class="tab"><a href="'+href+'" target="_blank" id="diffNewWindow">Open in Wiki</a></span>' + 
			( krRTRC_Patroltoken ? '<span class="tab"><a onclick="(function(){ if($(\'.patrollink a\').length){ $(\'.patrollink a\').click(); } else { $(\'#diffSkip\').click(); } })();">[mark]</a></span>' : '' ) +
			'<span class="tab"><a id="diffNext">' + krMsg('next').ucFirst() + ' &raquo;</a></span>'+krRTRC_SkipButon+'</div>');

				if(krRTRC_MassPatrol === true){
					$(".patrollink a").click();
				}

				$("#krRTRC_RCOutput>.feed div.indiff").removeClass("indiff");
				krRTRC_RebindElements();
			});
			return false;
		});
		$("a.newPage").live("click", function() {
			window.currentDiffRcid = $(this).attr("rcid");
			var title = $(this).parent().find(">a.page").text();
			var href = $(this).parent().find(">a.page").attr('href');
			$("#krRTRC_DiffFrame").css("max-height", "400px").load(href + '&action=render&uselang='+wgUserLanguage, function(){
				if (krInArray(window.currentDiffRcid, krRTRC_SkipDiffs)){
					krRTRC_SkipButon = '<span class="tab"><a id="diffUnskip">Unskip</a></span>';
				} else {
					krRTRC_SkipButon = '<span class="tab"><a id="diffSkip">Skip</a></span>';
				}
				$("#krRTRC_DiffFrame").fadeIn().prepend('<h3>'+title+'</h3><div id="krRTRC_DiffTools"><span class="tab"><a id="diffClose">X</a></span><span class="tab"><a href="'+href+'" target="_blank" id="diffNewWindow">Open in Wiki</a></span><span class="tab"><a onclick="$(\'.patrollink a\').click()">[mark]</a></span><span class="tab"><a id="diffNext">' + krMsg('next').ucFirst() + ' &raquo;</a></span>'+krRTRC_SkipButon+'</div>');
				if(krRTRC_MassPatrol === true){
					$(".patrollink a").click();
				}
				$("#krRTRC_RCOutput>.feed div.indiff").removeClass("indiff");
				krRTRC_RebindElements();
			});
			return false;
		});

		// Mark as patrolled
		$(".patrollink").live("click", function(){
			$(".patrollink>a").html( krMsg('markaspatrolleddiff') + '...' );
			$.ajax({
				type: "POST",
				url: krRTRC_APIURL+'?action=patrol&format=xml&list=recentchanges&rcid=' + window.currentDiffRcid + '&token='+krRTRC_Patroltoken,
				dataType: "xml",
				success: function(rawback){
					if( $(rawback).find('error').length > 0 ){
						$(".patrollink").html('<span style="color:red">' + krMsg('markedaspatrollederror') + '</span>');
						krLog("PatrolError: "+$(rawback).find('error').attr("code")+"; info: "+$(rawback).find('error').attr("info"));
					} else {
						$(".patrollink").html('<span style="color:green">' + krMsg('markedaspatrolled') + '</span>');
						$("#krRTRC_RCOutput>.feed div[rcid="+window.currentDiffRcid+"]").addClass("patrolled");

						// Patrolling/Refreshing sometimes overlap eachother causing patrolled edits to show up in an 'unpatrolled only' feed.
						// Make sure that any patrolled edits stay marked as such to prevent AutoDiff from picking a patrolled edit
						// See also krRTRC_RebindElements()
						krRTRC_MarkPatrolCache.push(window.currentDiffRcid);

						while(krRTRC_MarkPatrolCache.length > krRTRC_MarkPatrolCacheMax){
							krLog('MarkPatrolCache -> Cache array is bigger then cachemax, shifting array('+krRTRC_MarkPatrolCache.length+' vs. '+krRTRC_MarkPatrolCacheMax+'). Current array:');
							krLog(krRTRC_MarkPatrolCache);
							krRTRC_MarkPatrolCache.shift();
							krLog('MarkPatrolCache -> Cache array is shifted. New array:');
							krLog(krRTRC_MarkPatrolCache);
						}

						if (krRTRC_AutoDiff === true) { krRTRC_NextDiff();}
					}
				},
				error: function(){
					$(".patrollink").html('<span style="color:red">' + krMsg('markedaspatrollederror') + '</span>');
				}
			});
			return false;
		});

		// Trigger NextDiff
		$("#diffNext").live("click", function() {
			krRTRC_NextDiff();
		});

		// SkipDiff
		$("#diffSkip").live("click", function(){
			$("#krRTRC_RCOutput>.feed div[rcid="+window.currentDiffRcid+"]").addClass("skipped"); // Add class
			krRTRC_SkipDiffs.push(window.currentDiffRcid); // Add to array, to reAddClass after refresh in krRTRC_RebindElements
			krRTRC_NextDiff(); // Load next
		});

		// UnskipDiff
		$("#diffUnskip").live("click", function(){
			$('#krRTRC_RCOutput>.feed div[rcid='+window.currentDiffRcid+']').removeClass("skipped"); // Remove class
			krRTRC_SkipDiffs.splice(krRTRC_SkipDiffs.indexOf(window.currentDiffRcid), 1); // Remove from array, to no longer reAddClass after refresh
			//krRTRC_NextDiff(); // Load next ?
		});

		// Show helpicons
		$("#toggleHelp").live("click", function(){
			$("#krRTRC_RCOptions").toggleClass('nohelp');
		});

		// Link helpicons
		$("#krRTRC_RCForm .helpicon").attr("title", krMsg('clickforinfo'));
		$("#krRTRC_RCForm .helpicon").live("click", function(){
			window.open(krRTRC_HelpURL+'#'+$(this).attr("section"), "_blank");
			return false;
		});

		// Clear rcuser-field
		// If MassPatrol is active, warn that clearing rcuser will automatically disable MassPatrol f
		$("#RCOptions_RcuserClr").live("click", function(){
			if(krRTRC_MassPatrol === true){
				var a = window.confirm(krMsg('masspatrol_userfilterconfirm'));
				if(a){
					$("#rc-options-rcuser").val('');
					krRTRC_ToggleMassPatrol(false);
				}
			} else {
				$("#rc-options-rcuser").val('');
			}
			window.$RCOptions_submit.click();
		});

		// Clear rctitle-field
		/* RCTITLES DISABLED:
		$("#RCOptions_RctitleClr").live("click", function(){
			if(krRTRC_MassPatrol === true){
				var a = window.confirm(krMsg('masspatrol_userfilterconfirm'));
				if(a){
					krRTRC_ToggleMassPatrol(false);
				}
			}
			$("#rc-options-rctitle").val('');
			window.$RCOptions_submit.click();
		});
		*/

		// Tip
		$krRTRC_Tip = $("#krRTRC_Tip");
		$krRTRC_Tiptext = $("#krRTRC_Tiptext");
		$("#krRTRC_Tip").click(function(){
			krRTRC_TipOut();
		});
		$("#krRTRC_Tip").hover(function(){
			clearTimeout(window.krRTRC_TipTime);
		},function(){
			window.krRTRC_TipTime = setTimeout(krRTRC_TipOut,1000);
		});

		$("#krRTRC_list *").live("mouseover", function(e){
			var $hovEl = false;

			krLog(e); krLog(e.target);
			if ( $(e.target).is(".rcitem") ){
				$hovEl = $(e.target);
			} else if ( $(e.target).parents(".rcitem").is(".rcitem") ){
				$hovEl = $(e.target).parents(".rcitem");
			}

			if($hovEl){
				krRTRC_TipIn($hovEl.find(".user"), $hovEl.find(".user").text(), $hovEl.hasClass("anoncontrib"));
			} else {
				krRTRC_TipOut();
			}

		});

		// Mark as patrolled when rollbacking
		// Note: As of MediaWiki r(unknown) rollbacking does already automatically patrol all reverted revisions. But by doing it anyway it saves a click for the AutoDiff-users
		$(".mw-rollback-link a").live("click", function(){
			$(".patrollink a").click();
		});

		// Button: MassPatrol
		$krRTRC_MassPatrol = $("#krRTRC_MassPatrol");
		$krRTRC_MassPatrol.live("click", function(){
			if(krRTRC_MassPatrol === true){
				krRTRC_ToggleMassPatrol(false);
			} else if(krRTRC_AutoDiff === true) {
				krRTRC_ToggleMassPatrol(true);
			} else {
				var a = window.confirm(krMsg('masspatrol_autodiffneeded'));
				if(a){
					krRTRC_AutoDiff = true;
					$("#rc-options-autodiff").val("On").addClass("button-on");
					krRTRC_ToggleMassPatrol(true);
				}
			}
		});

		// Button: AutoDiff
		$("#rc-options-autodiff").live("click", function(){
			if(krRTRC_AutoDiff === true){
				if(krRTRC_MassPatrol === true){
					var a = window.confirm(krMsg('autodiff_masspatrolneeds'));
					if(a){
						$("#rc-options-autodiff").val("Off").removeClass("button-on");
						krRTRC_AutoDiff = false;
						krRTRC_ToggleMassPatrol(false);
					}
				} else {
					$(this).val("Off").removeClass("button-on");
					krRTRC_AutoDiff = false;
				}
			} else {
				$(this).val("On").addClass("button-on");
				krRTRC_AutoDiff = true;
			}
		});

		// Checkbox: AutoDiff from top
		$("#rc-options-autodiff-top").live("click", function(){
			if(krRTRC_AutoDiffTop === true){
				$(this).prop("checked", false);
				krRTRC_AutoDiffTop = false;
			} else {
				$(this).prop("checked", true);
				krRTRC_AutoDiffTop = true;
			}
		});

		// Button: Pause
		$("#krRTRC_toggleRefresh").live("click", function(){
			krLog("#krRTRC_toggleRefresh clicked");
			if(krRTRC_RCEnabled === true){
				krRTRC_RCEnabled = false;
				$(this).val("On").addClass("button-on");
				clearTimeout(krRTRC_RCTimeout);
			} else if(krRTRC_RCEnabled === false){
				krRTRC_RCEnabled = true;
				$(this).val("Off").removeClass("button-on");
				krRTRC_hardRefresh();
			} else {
				$(this).val("On").addClass("button-on");
				clearTimeout(krRTRC_RCTimeout);
			}
			return false;
		});



	};

/**
 * Fire it off when the DOM is ready...
 * -------------------------------------------------
 */
// If on the right page in the right action...
if( wgTitle === "Krinkle/RTRC" && ( wgAction === 'view' || wgAction === 'edit' ) /* && !krRTRC_Disabled */ ){


mw.loader.load('//meta.wikimedia.org/w/index.php?title=User:Krinkle/RTRC.css&action=raw&ctype=text/css', 'text/css', true);

// Messages
if( typeof window.krMsgs !== 'object' ) {
	$.getScript('//toolserver.org/~krinkle/I18N/export.php?lang=' + wgUserLanguage, function(){

		// Map over months
		krRTRC_Months = krMsg('months').split(',');
		mw.loader.using(['mediawiki.util', 'mediawiki.action.history.diff'], function(){
			var browserName = $.client.profile().name;
			if ( browserName === 'msie' ) {
				var s = "Internet Explorer is not supported. Please use a Mozilla or WebKit-based browser such as Firefox, Chrome or Safari.";
				$("<hr /><p style='color:red'>"+s+"</p>").insertBefore("#catlinks");
				return true;
			}
			if ( browserName === 'opera' ) {
				alert("Opera is currently not supported. Proceed at own risk or use a Mozilla or WebKit-based browser such as Firefox, Chrome or Safari.");
			}
			krRTRC_init1();
		});
	});
}

}
}());
