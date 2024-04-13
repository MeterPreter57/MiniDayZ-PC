"use strict";

(function () {

	// Get unprefixed versions of the classes we use
	var RTCPeerConnection = window["RTCPeerConnection"] || window["webkitRTCPeerConnection"] || window["mozRTCPeerConnection"] || window["msRTCPeerConnection"];
	var RTCSessionDescription = window["RTCSessionDescription"] || window["webkitRTCSessionDescription"] || window["mozRTCSessionDescription"] || window["msRTCSessionDescription"];
	var RTCIceCandidate = window["RTCIceCandidate"] || window["webkitRTCIceCandidate"] || window["mozRTCIceCandidate"] || window["msRTCIceCandidate"];
	
	var Peer = window["C2Peer"];
	var RegisteredObject = window["C2RegisteredObject"];
	var NetValue = window["C2NetValue"];
	
	// Config options
	var DEFAULT_SERVER_LIST_URL = "http://www.scirra.com/multiplayer/serverlist.json";
	var SIGNALLING_WEBSOCKET_PROTOCOL = "c2multiplayer";
	var SIGNALLING_PROTOCOL_REVISION = 1;
	var MAGIC_NUMBER = 0x63326D70;	// to identify non-fragmented messages originating from this protocol
	var DEFAULT_ICE_SERVER_LIST = [
		{ "urls": "stun:stun.l.google.com:19302" },
		{ "urls": "stun:stun1.l.google.com:19302" },
		{ "urls": "stun:stun2.l.google.com:19302" },
		{ "urls": "stun:stun3.l.google.com:19302" },
		{ "urls": "stun:stun4.l.google.com:19302" },
		{ "urls": "stun:23.21.150.121" }		// mozilla-operated server
	];
	
	window["C2Multiplayer_IsSupported"] = function ()
	{
		return !!RTCPeerConnection && typeof ArrayBuffer !== "undefined" && typeof DataView !== "undefined";
	};
	
	// Multiplayer object
	function C2Multiplayer()
	{
		this.INTERP_NONE = 0;
		this.INTERP_LINEAR = 1;
		this.INTERP_ANGULAR = 2;
		
		this.PRECISION_HIGH = 0;		// 8 bytes double
		this.PRECISION_NORMAL = 1;		// 4 bytes float
		this.PRECISION_LOW = 2;			// 2 bytes int16
		this.PRECISION_VERYLOW = 3;		// 1 byte uint8
	
		this.ice_servers = [];
		
		this.server_list = [];			// Server list if any after requestServerList()
		this.sigws = null;				// WebSocket to signalling server
		this.signalling_connected = false;
		this.signalling_loggedin = false;
		
		// Signalling server info
		this.sigserv_protocolrev = 0;
		this.sigserv_version = 0;
		this.sigserv_name = "";
		this.sigserv_operator = "";
		this.sigserv_motd = "";
		
		this.myid = "";
		this.myalias = "";
		
		this.game = "";					// Game name joined if any
		this.gameinstance = "";			// Game instance name joined if any
		this.room = "";					// Room name joined if any
		
		this.peers = [];				// List of peers in room
		this.peers_by_id = {};
		this.nextPeerNid = 0;
		this.usedPeerNids = {};
		
		this.me = null;					// Peer representing local user
		this.host = null;				// Peer representing host
		
		// Overridable events
		this.onserverlist = null;		// Fires after requestServerList() completes
		
		this.onsignallingopen = null;	// Fires when connection to signalling server opens
		this.onsignallingerror = null;	// Fires when error in connection to signalling server
		this.onsignallingclose = null;	// Fires when connection to signalling server closes
		
		this.onsignallingwelcome = null;	// Fires when welcome message received
		this.onsignallinglogin = null;
		this.onsignallingjoin = null;
		this.onsignallingleave = null;
		this.onsignallingkicked = null;
		
		this.onsignallinginstancelist = null;
		this.onsignallingroomlist = null;
		
		this.onbeforeclientupdate = null;
		
		this.onpeeropen = null;				// function (peer)
		this.onpeerclose = null;			// function (peer)
		this.onpeererror = null;			// function (peer, e)
		this.onpeermessage = null;			// function (peer, type, m)
		this.oninstancedestroyed = null;	// function (ro, nid)
		
		this.ongetobjectcount = null;		// function (obj)
		this.ongetobjectvalue = null;		// function (obj, index, netvalue)
		
		this.clientDelay = 80;				// client-side delay (ms)
		this.hostUpdateRateSec = 30;		// number of times to send outbound updates as host
		this.peerUpdateRateSec = 30;		// number of times to send outbound updates as peer
		
		this.lastUpdateTime = 0;
		
		this.stats = {
			lastSecondTime: 0,				// for measuring the per second counts
			outboundPerSec: 0,				// number of messages outbound per second
			outboundCount: 0,
			outboundBandwidthPerSec: 0,		// uploaded payload bytes per second
			outboundBandwidthCount: 0,
			inboundPerSec: 0,				// number of messages inbound per second
			inboundCount: 0,
			inboundBandwidthPerSec: 0,		// downloaded payload bytes per second
			inboundBandwidthCount: 0
		};
		
		// Array buffer for generating outbound updates
		this.dataBuffer = new ArrayBuffer(262144);		// 256kb max size per message; use views to reduce transmitted size
		this.dataView = new DataView(this.dataBuffer);
		
		// Object tracking
		this.registeredObjects = [];
		this.nextObjectNid = 1;
		this.objectsByNid = {};
		
		// Latency simulation
		this.simLatency = 0;
		this.simPdv = 0;
		this.simPacketLoss = 0;
		
		// Clock synchronisation
		this.lastTimeDiffs = [];
		this.targetHostTimeDiff = 0;
		this.hostTimeDiff = 0;
		
		this.targetSimDelay = this.clientDelay;
		this.simDelay = this.clientDelay;
		
		// Client input state values
		this.clientvalues = [];
		this.clientvalue_by_tag = {};
		this.receivedClientValues = false;
		
		this.mergeIceServerList(DEFAULT_ICE_SERVER_LIST);
		
		var self = this;
		
		// Update pings every 2 seconds
		setInterval(function () {
			self.doPings();
		}, 2000);
		
		// Closing browser window doesn't appear to close connections - the other
		// end just times out. So onunload force disconnect, which sends notifications.
		window.addEventListener("unload", function ()
		{
			self.removeAllPeers("quit");
		});
	};
	
	C2Multiplayer.prototype.isConnected = function ()
	{
		return this.signalling_connected;
	};
	
	C2Multiplayer.prototype.isLoggedIn = function ()
	{
		return this.isConnected() && this.signalling_loggedin;
	};
	
	C2Multiplayer.prototype.isInRoom = function ()
	{
		return this.isLoggedIn() && this.room;
	};
	
	C2Multiplayer.prototype.isHost = function ()
	{
		return this.isInRoom() && this.me && (this.host === this.me);
	};
	
	C2Multiplayer.prototype.getMyID = function ()
	{
		return this.isLoggedIn() ? this.myid : "";
	};
	
	C2Multiplayer.prototype.getMyAlias = function ()
	{
		return this.isLoggedIn() ? this.myalias : "";
	};
	
	C2Multiplayer.prototype.getCurrentGame = function ()
	{
		return this.isLoggedIn() ? this.game : "";
	};
	
	C2Multiplayer.prototype.getCurrentGameInstance = function ()
	{
		return this.isLoggedIn() ? this.gameinstance : "";
	};
	
	C2Multiplayer.prototype.getCurrentRoom = function ()
	{
		return this.isInRoom() ? this.room : "";
	};
	
	C2Multiplayer.prototype.getHostID = function ()
	{
		return this.host ? this.host.id : "";
	};
	
	C2Multiplayer.prototype.getHostAlias = function ()
	{
		return this.host ? this.host.alias : "";
	};
	
	C2Multiplayer.prototype.setLatencySimulation = function (latency_, pdv_, loss_)
	{
		this.simLatency = latency_;
		this.simPdv = pdv_;
		this.simPacketLoss = loss_;
		
		if (this.simLatency < 0)
			this.simLatency = 0;
		
		if (this.simPdv < 0)
			this.simPdv = 0;
		
		if (this.simPacketLoss < 0)
			this.simPacketLoss = 0;
	};
	
	C2Multiplayer.prototype.requestServerList = function (url_)
	{
		var self = this;
		
		var xhr = new XMLHttpRequest();
		
		// If anything goes wrong, call onserverlist with null argument
		var errorFunc = function (e)
		{
			console.error("Error requesting server list");
			
			if (self.onsignallingerror)
				self.onsignallingerror(e);
		};
		
		xhr.onerror = errorFunc;
		xhr.ontimeout = errorFunc;
		xhr.onabort = errorFunc;
		xhr.onload = function ()
		{
			var o;
			
			try {
				o = JSON.parse(xhr.responseText);
			}
			catch (e) {
				errorFunc(e);
				return;
			}
			
			self.server_list = o["server_list"];
			
			if (self.onserverlist)
				self.onserverlist(self.server_list);
			else
				errorFunc("response did not contain a server list");
		};
		
		xhr.open("GET", url_ || DEFAULT_SERVER_LIST_URL);
		
		try {
			xhr.responseType = "text";
		} catch (e) {}
		
		xhr.timeout = 10000;		// 10 second timeout
		
		xhr.send();
	};
	
	C2Multiplayer.prototype.signallingConnect = function (url_)
	{
		// Ignore if already connected
		if (this.sigws || this.signalling_connected)
			return;
		
		var self = this;
		
		try {
			this.sigws = new WebSocket(url_, SIGNALLING_WEBSOCKET_PROTOCOL);
		}
		catch (e) {
			// May be unable to parse URL address
			this.sigws = null;
			
			if (this.onsignallingerror)
				this.onsignallingerror(e);
			
			return;
		}
		
		this.sigws.onopen = function ()
		{
			// Check server websocket supports this protocol
			if (self.sigws.protocol.indexOf(SIGNALLING_WEBSOCKET_PROTOCOL) === -1)
			{
				if (self.onsignallingerror)
					self.onsignallingerror("server does not support '" + SIGNALLING_WEBSOCKET_PROTOCOL + "' protocol");
				
				self.sigws.close(1002, "'" + SIGNALLING_WEBSOCKET_PROTOCOL + "' protocol required");
				self.sigws = null;
				self.signalling_connected = false;
				return;
			}
			
			self.signalling_connected = true;
			
			if (self.onsignallingopen)
				self.onsignallingopen();
		};
		
		this.sigws.onclose = function (e)
		{
			if (self.onsignallingclose)
				self.onsignallingclose(e);
			
			self.signalling_connected = false;
			self.signalling_loggedin = false;
			self.sigws = null;
		};
		
		this.sigws.onerror = function (e)
		{
			console.error("Signalling server error: ", e);
			
			if (self.onsignallingerror)
				self.onsignallingerror(e);
		};
		
		this.sigws.onmessage = function (m)
		{
			self.onSignallingMessage(m);
		};
	};
	
	C2Multiplayer.prototype.signallingDisconnect = function ()
	{
		if (!this.sigws || !this.signalling_connected)
			return;
		
		this.sigws.close();
		this.sigws = null;
		this.signalling_connected = false;
	};
	
	C2Multiplayer.prototype.onSignallingMessage = function (m)
	{
		var o;
		
		try {
			o = JSON.parse(m.data);
		}
		catch (e) {
			if (this.onsignallingerror)
				this.onsignallingerror(e);
			return;
		}
		
		switch (o.message) {
		case "welcome":
			this.onSignallingReceiveWelcome(o);
			break;
		case "login-ok":
			this.onSignallingReceiveLoginOK(o);
			break;
		case "join-ok":
			this.onSignallingReceiveJoinOK(o);
			break;
		case "leave-ok":
			this.onSignallingReceiveLeaveOK(o);
			break;
		case "kicked":
			this.onSignallingReceiveKicked(o);
			break;
		case "peer-joined":
			this.onSignallingReceivePeerJoined(o);
			break;
		case "peer-quit":
			this.onSignallingReceivePeerQuit(o);
			break;
		case "icecandidate":
			this.onSignallingReceiveIceCandidate(o);
			break;
		case "offer":
			this.onSignallingReceiveOffer(o);
			break;
		case "answer":
			this.onSignallingReceiveAnswer(o);
			break;
		case "instance-list":
			this.onSignallingReceiveInstanceList(o);
			break;
		case "room-list":
			this.onSignallingReceiveRoomList(o);
			break;
		case "error":
			if (this.onsignallingerror)
				this.onsignallingerror(o.details);
			break;
		default:
			if (this.onsignallingerror)
				this.onsignallingerror("received unknown signalling message");
			break;
		}
	};
	
	C2Multiplayer.prototype.hasIceServerUrl = function (server)
	{
		var i, len, s;
		for (i = 0, len = this.ice_servers.length; i < len; ++i)
		{
			s = this.ice_servers[i];
			
			if (s["urls"] === server["urls"])
				return true;
		}
		
		return false;
	};
	
	C2Multiplayer.prototype.mergeIceServerList = function (arr)
	{
		if (!arr)
			return;
		
		var i, len, o;
		for (i = 0, len = arr.length; i < len; ++i)
		{
			o = arr[i];
			
			if (typeof arr[i] === "string")		// old style signalling server sending string URLs instead of objects
			{
				// Make in to object instead
				o = { "urls": arr[i] };
			}
			
			if (!this.hasIceServerUrl(o))
			{
				// Make sure the "urls" property is duplicated as "url" for compatibility with Firefox
				if (!o.hasOwnProperty("url"))
					o["url"] = o["urls"];
				
				this.ice_servers.push(o);
			}
		}
	};
	
	C2Multiplayer.prototype.getIceServerList = function ()
	{
		return this.ice_servers;
	};
	
	C2Multiplayer.prototype.onSignallingReceiveWelcome = function (o)
	{
		if (o.protocolrev < 1 || o.protocolrev > SIGNALLING_PROTOCOL_REVISION)
		{
			if (this.onsignallingerror)
				this.onsignallingerror("signalling server protocol revision not supported");
			
			this.signallingDisconnect();
			return;
		}
		
		this.myid = o.clientid;
		
		this.sigserv_protocolrev = o.protocolrev;
		this.sigserv_version = o.version;
		this.sigserv_name = o.name;
		this.sigserv_operator = o.operator;
		this.sigserv_motd = o.motd;
		
		this.mergeIceServerList(o.ice_servers);
		
		if (this.onsignallingwelcome)
			this.onsignallingwelcome();
	};
	
	C2Multiplayer.prototype.onSignallingReceiveLoginOK = function (o)
	{
		this.myalias = o.alias;
		this.signalling_loggedin = true;
		
		if (this.onsignallinglogin)
			this.onsignallinglogin();
	};
	
	C2Multiplayer.prototype.allocatePeerNid = function ()
	{
		if (this.me !== this.host)
			return;		// peers cannot allocate nids
		
		this.nextPeerNid++;
		
		if (this.nextPeerNid > 65535)
			this.nextPeerNid = 0;
		
		// Skip over any used values to the next free value
		while (this.usedPeerNids.hasOwnProperty(this.nextPeerNid))
		{
			this.nextPeerNid++;
			
			if (this.nextPeerNid > 65535)
				this.nextPeerNid = 0;
		}
		
		// We can now use this NID
		var nid = this.nextPeerNid;
		this.usedPeerNids[nid] = true;
		return nid;
	};
	
	C2Multiplayer.prototype.freePeerNid = function (nid)
	{
		if (this.me !== this.host)
			return;
		
		if (this.usedPeerNids.hasOwnProperty(nid))
			delete this.usedPeerNids[nid];
	};
	
	C2Multiplayer.prototype.onSignallingReceiveJoinOK = function (o)
	{
		// Disconnect from any existing peers if still running old room
		this.removeAllPeers("disconnect");
		
		this.game = o.game;
		this.gameinstance = o.instance;
		this.room = o.room;
		
		this.me = new Peer(this, this.myid, this.myalias);
		
		// Local client was assigned host
		if (o.host)
		{
			this.host = this.me;
			
			this.nextPeerNid = 0;
			this.usedPeerNids = {};
			this.host.nid = this.allocatePeerNid();
		}
		else
		{
			this.lastTimeDiffs.length = 0;
			this.targetHostTimeDiff = 0;
			this.hostTimeDiff = 0;
			
			// Reset to conservative bandwidth profile and await updated settings from host
			this.clientDelay = 80;
			this.hostUpdateRateSec = 30;
			this.peerUpdateRateSec = 30;
			
			this.targetSimDelay = this.clientDelay;
			this.simDelay = this.clientDelay;
			
			this.host = new Peer(this, o.hostid, o.hostalias);
			this.host.connect();
		}
		
		if (this.onsignallingjoin)
			this.onsignallingjoin(!!o.host);
	};
	
	C2Multiplayer.prototype.onSignallingReceiveLeaveOK = function (o)
	{
		this.room = "";
		
		if (this.onsignallingleave)
			this.onsignallingleave();
	};
	
	C2Multiplayer.prototype.onSignallingReceiveKicked = function (o)
	{
		this.disconnectRoom(false);
		this.room = "";
		
		if (this.onsignallingkicked)
			this.onsignallingkicked();
	};
	
	C2Multiplayer.prototype.onSignallingReceivePeerJoined = function (o)
	{
		if (!this.signalling_loggedin || !this.room || this.me !== this.host)
			return;

		// If the same peer ID is timing out, it's possible the same peer ID can join twice.
		// Make sure we forcibly remove the old peer first
		if (this.peers_by_id.hasOwnProperty(o.peerid))
			this.peers_by_id[o.peerid].remove("rejoin");
		
		var peer = new Peer(this, o.peerid, o.peeralias);
		peer.connect();
	};
	
	C2Multiplayer.prototype.onSignallingReceivePeerQuit = function (o)
	{
		if (!this.signalling_loggedin || !this.room || this.me !== this.host)
			return;
		
		// Signalling server has indicated for us to remove this peer
		if (this.peers_by_id.hasOwnProperty(o.id))
			this.peers_by_id[o.id].remove(o.reason);
	};
	
	C2Multiplayer.prototype.onSignallingReceiveIceCandidate = function (o)
	{
		if (!this.signalling_loggedin || !this.room)
			return;
		
		var peer = this.peers_by_id[o.from];
	
		if (peer && peer.pc)
		{
			peer.pc.addIceCandidate(new RTCIceCandidate(o.icecandidate));
		}
	};
	
	C2Multiplayer.prototype.onSignallingReceiveOffer = function (o)
	{
		if (!this.signalling_loggedin || !this.room || this.me === this.host || !this.me || !this.host || !this.host.pc)
			return;
		
		if (o.from !== this.host.id)
			return;
			
		var self = this;
		
		this.host.pc.setRemoteDescription(new RTCSessionDescription(o.offer), function ()
		{
			self.host.pc.createAnswer(function (answer)
			{
				self.host.pc.setLocalDescription(answer);
				
				self.signallingSend({
					message: "answer",
					toclientid: self.host.id,
					answer: answer
				});
			}, function (err)
			{
				console.error("Peer error creating answer: ", err);
				
				if (self.onpeererror)
					self.onpeererror(self.me, "could not create answer to host offer");
			});
		}, function (err) 
		{
			console.error("Peer error setting remote description: ", err);
			
			if (self.onpeererror)
					self.onpeererror(self.me, "could not set remote description");
		});
	};
	
	C2Multiplayer.prototype.onSignallingReceiveAnswer = function (o)
	{
		if (!this.signalling_loggedin || !this.room || this.me !== this.host)
			return;
		
		var peer = this.peers_by_id[o.from];
		
		if (!peer)
			return;
		
		peer.pc.setRemoteDescription(new RTCSessionDescription(o.answer), function ()
		{
			// success callback: required, but ignore
		}, function (err) {
			console.error("Host error setting remote description: ", err);
		});
	};
	
	C2Multiplayer.prototype.onSignallingReceiveInstanceList = function (o)
	{
		if (this.onsignallinginstancelist)
			this.onsignallinginstancelist(o["list"]);
	};
	
	C2Multiplayer.prototype.onSignallingReceiveRoomList = function (o)
	{
		if (this.onsignallingroomlist)
			this.onsignallingroomlist(o["list"]);
	};
	
	C2Multiplayer.prototype.signallingSend = function (o)
	{
		if (this.sigws && this.signalling_connected)
			this.sigws.send(JSON.stringify(o));
	};
	
	C2Multiplayer.prototype.signallingLogin = function (alias_)
	{
		if (this.signalling_loggedin)
			return;
		
		this.signallingSend({
			message: "login",
			protocolrev: SIGNALLING_PROTOCOL_REVISION,
			alias: alias_
		});
	};
	
	C2Multiplayer.prototype.signallingJoinGameRoom = function (game_, instance_, room_, max_clients_)
	{
		if (!this.signalling_loggedin || this.room)
			return;
		
		this.signallingSend({
			message: "join",
			game: game_,
			instance: instance_,
			room: room_,
			max_clients: max_clients_
		});
	};
	
	C2Multiplayer.prototype.signallingAutoJoinGameRoom = function (game_, instance_, room_, max_clients_, lock_when_full_)
	{
		if (!this.signalling_loggedin || this.room)
			return;
		
		this.signallingSend({
			message: "auto-join",
			game: game_,
			instance: instance_,
			room: room_,
			max_clients: max_clients_,
			lock_when_full: lock_when_full_
		});
	};
	
	C2Multiplayer.prototype.signallingLeaveRoom = function ()
	{
		if (!this.signalling_loggedin)
			return;
		
		this.signallingSend({
			message: "leave"
		});
	};
	
	C2Multiplayer.prototype.signallingConfirmPeer = function (id_)
	{
		if (!this.signalling_loggedin || !this.isHost())
			return;
		
		this.signallingSend({
			message: "confirm-peer",
			id: id_
		});
	};
	
	C2Multiplayer.prototype.signallingRequestGameInstanceList = function (game_)
	{
		if (!this.sigws || !this.signalling_connected)
			return;
		
		this.signallingSend({
			message: "list-instances",
			game: game_
		});
	};
	
	C2Multiplayer.prototype.signallingRequestRoomList = function (game_, instance_, which_)
	{
		if (!this.sigws || !this.signalling_connected)
			return;
		
		this.signallingSend({
			message: "list-rooms",
			game: game_,
			instance: instance_,
			which: which_
		});
	};
	
	C2Multiplayer.prototype.disconnectRoom = function (signalling_leave_room)
	{
		this.lastTimeDiffs.length = 0;
		this.targetHostTimeDiff = 0;
		this.hostTimeDiff = 0;
		
		this.removeAllPeers("disconnect");
		
		if (signalling_leave_room)
			this.signallingLeaveRoom();
	};
	
	var isRemovingAllPeers = false;
	
	C2Multiplayer.prototype.removeAllPeers = function (reason)
	{
		// Prevent recursion since removing key peers will also call removeAllPeers()
		if (isRemovingAllPeers)
			return;
		
		isRemovingAllPeers = true;
		
		while (this.peers.length)
			this.peers[0].remove(reason);
		
		isRemovingAllPeers = false;
	};
	
	C2Multiplayer.prototype.getPeerById = function (id)
	{
		if (this.peers_by_id.hasOwnProperty(id))
			return this.peers_by_id[id];
		else
			return null;
	};
	
	C2Multiplayer.prototype.getAliasFromId = function (id)
	{
		if (this.peers_by_id.hasOwnProperty(id))
			return this.peers_by_id[id].alias;
		else
			return "";
	};
	
	C2Multiplayer.prototype.getPeerByNid = function (nid)
	{
		var i, len, p;
		
		for (i = 0, len = this.peers.length; i < len; ++i)
		{
			p = this.peers[i];
			
			if (p.nid === nid)
				return p;
		}
		
		return null;
	};
	
	var tmpArr = [];
	
	C2Multiplayer.prototype.hostBroadcast = function (type, m, skip_peer)
	{
		if (this.me !== this.host)
			return;
		
		var i, len, p;
		
		// send() can fail and remove the peer, which crashes while iterating the peers array.
		// To avoid this, shallow copy the peers to broadcast to so any getting removed during
		// broadcast don't matter.
		window.cr_shallowAssignArray(tmpArr, this.peers);
		
		for (i = 0, len = tmpArr.length; i < len; ++i)
		{
			p = tmpArr[i];
			
			if (!p)
				continue;
			
			if ((p !== this.me) && (p !== skip_peer))
				p.send(type, m);
		}
		
		tmpArr.length = 0;
	};
	
	C2Multiplayer.prototype.doPings = function ()
	{
		var i, len, p;
		var nowtime = window.cr_performance_now();
		
		// Host: ping everybody but me
		if (this.me === this.host)
		{
			// sendPing() can fail and remove the peer, which crashes while iterating the peers array.
			// Same workaround as hostBroadcast used here.
			window.cr_shallowAssignArray(tmpArr, this.peers);
			
			for (i = 0, len = tmpArr.length; i < len; ++i)
			{
				p = tmpArr[i];
				
				if (!p)
					continue;
				
				if (p !== this.me)
					p.sendPing(nowtime, false);
			}
			
			tmpArr.length = 0;
		}
		// Peer: only ping host
		else
		{
			if (this.host)
				this.host.sendPing(nowtime, false);
		}
	};
	
	C2Multiplayer.prototype.registerObject = function (obj, sid, bandwidth)
	{
		return new RegisteredObject(this, obj, sid, bandwidth);
	};
	
	C2Multiplayer.prototype.getRegisteredObjectsMap = function ()
	{
		var ret = {};
		var p, ro;
		for (p in this.objectsByNid)
		{
			if (this.objectsByNid.hasOwnProperty(p))
			{
				ro = this.objectsByNid[p];
				
				ret[ro.sid] = {
					"nid": parseInt(p, 10),
					"nvs": ro.getNetValuesJson()
				};
			}
		}
		
		return ret;
	};
	
	C2Multiplayer.prototype.mapObjectNids = function (objs)
	{
		// Run through all our registered objects and update their NIDs from what the host
		// told us they are
		this.objectsByNid = {};		// override with what host tells us
		var i, len, ro, o;
		for (i = 0, len = this.registeredObjects.length; i < len; ++i)
		{
			ro = this.registeredObjects[i];
			
			if (objs.hasOwnProperty(ro.sid.toString()))
			{
				o = objs[ro.sid.toString()];
				ro.nid = o["nid"];
				this.objectsByNid[ro.nid] = ro;
				ro.setNetValuesFrom(o["nvs"]);
			}
			else
			{
				console.warn("Could not map object SID '" + ro.sid + "' - host did not send NID for it");
				ro.nid = -1;
			}
		}
	};
	
	C2Multiplayer.prototype.tick = function (dt)
	{
		if (!this.isInRoom())
			return;
		
		var nowtime = window.cr_performance_now();
		
		// Aim to reach the target rate of updates per second.
		// Allow a 5ms inaccuracy in the timer, since ticking at 60 Hz could drop an update
		// that was a tiny bit early.
		var updateRate = (this.me === this.host ? this.hostUpdateRateSec : this.peerUpdateRateSec);
		
		if ((nowtime - this.lastUpdateTime) >= ((1000 / updateRate) - 5))
		{
			this.sendUpdate(nowtime);
			this.lastUpdateTime = nowtime;
		}
		
		// Stat tracking per second
		if ((nowtime - this.stats.lastSecondTime) >= 1000)
		{
			this.stats.outboundPerSec = this.stats.outboundCount;
			this.stats.outboundBandwidthPerSec = this.stats.outboundBandwidthCount;
			this.stats.inboundPerSec = this.stats.inboundCount;
			this.stats.inboundBandwidthPerSec = this.stats.inboundBandwidthCount;
			
			this.stats.outboundCount = 0;
			this.stats.outboundBandwidthCount = 0;
			this.stats.inboundCount = 0;
			this.stats.inboundBandwidthCount = 0;
			
			this.stats.lastSecondTime += 1000;
			
			// If fallen more than 500ms behind, just update to current time
			if (nowtime - this.lastSecondTime > 500)
				this.stats.lastSecondTime = nowtime;
		}
		
		// If not host, to prevent simulation jank smoothly slide the host time difference to the
		// target host time difference by up to 10ms per second (1% speed variation). This should smooth
		// out any variance in the sometimes inaccurate host time measurements.
		if (this.host !== this.me)
		{
			if (this.hostTimeDiff < this.targetHostTimeDiff)
			{
				this.hostTimeDiff += 10 * dt;
				
				if (this.hostTimeDiff > this.targetHostTimeDiff)
					this.hostTimeDiff = this.targetHostTimeDiff;
			}
			else if (this.hostTimeDiff > this.targetHostTimeDiff)
			{
				this.hostTimeDiff -= 10 * dt;
				
				if (this.hostTimeDiff < this.targetHostTimeDiff)
					this.hostTimeDiff = this.targetHostTimeDiff;
			}
			
			// Also slide the simulation delay towards the target, but at a slightly faster rate.
			// In theory the host time difference should never change by much, since it's supposed
			// to be a constant value. However the network conditions can change, and possibly rapidly.
			// As a result, we can change the simulation delay by up to 30ms per second (3% speed variation).
			// This means if the ping suddenly doubles from 200ms to 400ms, we will reach the new latency
			// time in about 7 seconds. Things could be janky for those 7 seconds, but then it should clear up.
			if (this.simDelay < this.targetSimDelay)
			{
				this.simDelay += 30 * dt;
				
				if (this.simDelay > this.targetSimDelay)
					this.simDelay = this.targetSimDelay;
			}
			else if (this.simDelay > this.targetSimDelay)
			{
				this.simDelay -= 30 * dt;
				
				if (this.simDelay < this.targetSimDelay)
					this.simDelay = this.targetSimDelay;
			}
		}
		
		// Tick all peers
		var simTime = this.getSimulationTime();
		
		var i, len;
		for (i = 0, len = this.peers.length; i < len; ++i)
		{
			this.peers[i].tick(simTime);
		}
	};
	
	C2Multiplayer.prototype.sendUpdate = function (nowtime)
	{
		if (this.me === this.host)
		{
			this.sendHostUpdate(nowtime);
			this.sendHostEvents(nowtime);
		}
		else
			this.sendClientUpdate(nowtime);
	};
	
	C2Multiplayer.prototype.sendClientUpdate = function (nowtime)
	{
		if (this.onbeforeclientupdate && this.isReadyForInput())
			this.onbeforeclientupdate();
		
		// Don't send any client state until we receive from the host what the expected client state
		// values are, since they might be different
		if (!this.me || !this.receivedClientValues)
			return;
		
		var i, len, cv, value;
		var dv = this.dataView;
		var ptr = 0;
		var clientvalues = this.clientvalues;
		var clientState = this.me.localClientState;
		
		// Bandwidth reduction:
		// If client state stops changing, transmit it every update for another 100ms
		// to try to make sure the latest value arrives at the other end.
		// After 100ms, transmit it every 100ms until 1 second has passed.
		// After that, only transmit it every 500ms. This reduces the bandwidth,
		// but providing packet loss is not severe, still ensures low-latency
		// arrival of changes to the host.
		var time_since_changed = nowtime - this.me.lastStateChange;
		var time_since_transmit = nowtime - this.me.lastStateTransmit;
		var transmit = false;
		
		if (time_since_changed < 100)
			transmit = true;
		else if (time_since_changed < 1000)
			transmit = (time_since_transmit >= 95);
		else
			transmit = (time_since_transmit >= 495);
		
		if (!transmit)
			return;		// skip this transmission
		
		/* Net format:
		uint32		MAGIC_NUMBER
		float64		timestamp
		uint8		flags (reserved)
		uint8		client state value count
		t			client state 0
		t			client state 1
		...
		t			client state N
		*/
		
		// Write packet header
		dv.setUint32(ptr, MAGIC_NUMBER);		ptr += 4;
		
		// Send timestamp as our best guess of what the host time currently is. This
		// lets the host compensate for PDV in the client input values.
		dv.setFloat64(ptr, nowtime + this.hostTimeDiff);	ptr += 8;
		
		// Flags (reserved)
		dv.setUint8(ptr, 0);					ptr += 1;
		
		// Write client state values
		dv.setUint8(ptr, clientvalues.length);	ptr += 1;
		
		for (i = 0, len = clientvalues.length; i < len; ++i)
		{
			cv = clientvalues[i];
			value = 0;
			
			if (i < clientState.length)
			{
				// get value clamped to appropriate precision
				value = cv.clamp(clientState[i]);
			}
			
			ptr = cv.write(dv, ptr, value);
		}
		
		// Transmit to host on unreliable channel
		this.me.lastStateTransmit = nowtime;
		this.host.send("u", new Uint8Array(this.dataBuffer, 0, ptr));
	};
	
	C2Multiplayer.prototype.sendHostUpdate = function (nowtime)
	{
		var i, len, j, k, ro, count, index, netvalues, valuecount, value;
		var dv = this.dataView;
		var ptr = 0;
		var ro_to_transmit = 0;
		
		// Update registered objects' data
		// For each registered object
		for (i = 0, len = this.registeredObjects.length; i < len; ++i)
		{
			ro = this.registeredObjects[i];
			
			count = 0;
			
			if (this.ongetobjectcount)
				count = this.ongetobjectcount(ro.obj);
			
			ro.getData(count, nowtime);
			
			if (ro.number_to_transmit > 0)
				ro_to_transmit++;
		}
		
		if (ro_to_transmit === 0)
			return;		// nothing needs updating
		
		/* Net format:
		uint32		MAGIC_NUMBER
		uint32		flags: 0 for host update
		float64		timestamp
		uint16		registered object count

		for each registered object:
			uint16		nid
			uint16		instance count
			uint16		net value count
			
			for each instance:
				uint16		nid
				float32		netvalue0
				float32		netvalue1
				...
				float32		netvalueN
		*/
		
		// Write packet header
		dv.setUint32(ptr, MAGIC_NUMBER);		ptr += 4;
		dv.setUint32(ptr, 0);					ptr += 4;		// flags = 0 for host update
		dv.setFloat64(ptr, nowtime);			ptr += 8;
		dv.setUint16(ptr, ro_to_transmit);		ptr += 2;
		
		// For each registered object
		for (i = 0, len = this.registeredObjects.length; i < len; ++i)
		{
			ro = this.registeredObjects[i];
			
			if (ro.number_to_transmit > 0)
				ptr = ro.writeData(dv, ptr, nowtime);
		}
		
		this.hostBroadcast("u", new Uint8Array(this.dataBuffer, 0, ptr), null);
	};
	
	C2Multiplayer.prototype.sendHostEvents = function (nowtime)
	{
		var i, len, ro, j, lenj;
		var dv = this.dataView;
		var ptr = 0;
		var ro_to_transmit = 0;
		
		// Update registered objects' data
		// For each registered object
		for (i = 0, len = this.registeredObjects.length; i < len; ++i)
		{
			ro = this.registeredObjects[i];
			
			if (ro.dead_nids.length)
				ro_to_transmit++;
		}
		
		if (ro_to_transmit === 0)
			return;		// no events to be sent
		
		/* Net format:
		uint32		MAGIC_NUMBER
		uint32		flags: 1 for host events
		float64		timestamp
		uint16		registered object count

		for each registered object:
			uint16		ro nid
			uint16		dead_nids count
				uint16		dead_nid 0
				uint16		dead_nid 1
				...
				uint16		dead_nid N
		*/
		
		// Write packet header
		dv.setUint32(ptr, MAGIC_NUMBER);		ptr += 4;
		dv.setUint32(ptr, 1);					ptr += 4;		// flags = 1 for host events
		dv.setFloat64(ptr, nowtime);			ptr += 8;
		dv.setUint16(ptr, ro_to_transmit);		ptr += 2;
		
		// For each registered object
		for (i = 0, len = this.registeredObjects.length; i < len; ++i)
		{
			ro = this.registeredObjects[i];
			
			if (!ro.dead_nids.length)
				continue;
			
			dv.setUint16(ptr, ro.nid);					ptr += 2;
			dv.setUint16(ptr, ro.dead_nids.length);		ptr += 2;
			
			for (j = 0, lenj = ro.dead_nids.length; j < lenj; ++j)
			{
				dv.setUint16(ptr, ro.dead_nids[j]);		ptr += 2;
			}
			
			ro.dead_nids.length = 0;
		}
		
		// Note we send over the reliable unordered channel - this update should not be dropped
		this.hostBroadcast("r", new Uint8Array(this.dataBuffer, 0, ptr), null);
	};
	
	var tempArray = [];
	
	function compareNumbers(a, b)
	{
		return a - b;
	}
	
	C2Multiplayer.prototype.addHostTime = function (hosttime, nowtime, lastlatency, latency)
	{
		// Ignore if host
		if (this.host === this.me)
			return;
		
		// Update the target simulation delay based on latest latency measurement.
		this.targetSimDelay = latency + this.clientDelay;
		
		// The host time was correct the time it was sent, but then there is the added time it has
		// taken to be transmitted over the network and received. So hosttime was correct after an
		// estimated delay of 'lastlatency'. So we can estimate the current host time to be (hosttime + lastlatency).
		var timediff = (hosttime + lastlatency) - nowtime;
		
		// If this is the first measurement, start the host time difference on this value.
		// In tick(), it will slowly slide towards the target value to avoid janky simulation.
		// The same applies to the simulation delay.
		if (this.lastTimeDiffs.length === 0)
		{
			this.hostTimeDiff = timediff;
			this.simDelay = this.targetSimDelay;
		}
		
		// For client simulation to be accurate, we must track and average the time difference over
		// time in a similar manner to how the latency is measured.
		this.lastTimeDiffs.push(timediff);
		
		// Keep last 30 measurements (as opposed to 10 for pings). In theory the time diff is a constant
		// value, so in theory the more measurements the more accurate a result we'll get. However it's
		// possible the local and remote clocks will very slightly drift apart over time. So to ensure
		// we're not caught out, the time difference is still constantly re-measured.
		if (this.lastTimeDiffs.length > 30)
			this.lastTimeDiffs.shift();
		
		window.cr_shallowAssignArray(tempArray, this.lastTimeDiffs);
		tempArray.sort(compareNumbers);
		
		var start = 0;
		var end = tempArray.length;
		
		if (tempArray.length >= 4 && tempArray.length <= 6)
		{
			++start;
			--end;
		}
		else if (tempArray.length > 6 && tempArray.length <= 19)
		{
			start += 2;
			end -= 2;
		}
		else if (tempArray.length > 19)
		{
			start += 5;
			end -= 5;
		}
		
		// Set estimated latency to the average of the middle values.
		var i, sum = 0;
		for (i = start; i < end; ++i)
			sum += tempArray[i];
		
		this.targetHostTimeDiff = (sum / (end - start));
	};
	
	C2Multiplayer.prototype.getSimulationTime = function ()
	{
		if (this.host === this.me)
			return window.cr_performance_now() - this.clientDelay;
		else
			return window.cr_performance_now() + this.hostTimeDiff - this.simDelay;
	};
	
	C2Multiplayer.prototype.getHostTime = function ()
	{
		if (this.host === this.me)
			return window.cr_performance_now();
		else
			return window.cr_performance_now() + this.hostTimeDiff;
	};
	
	// Estimate the host time when a message arrives with input feedback if sent from a peer now
	C2Multiplayer.prototype.getHostInputArrivalTime = function ()
	{
		if (this.host === this.me)
			return window.cr_performance_now();
		else
			return window.cr_performance_now() + this.hostTimeDiff + this.simDelay;
	};
	
	C2Multiplayer.prototype.setClientState = function (tag, x)
	{
		// Ignore if host
		if (this.host === this.me || !this.me || !this.receivedClientValues)
			return;
		
		var cv = this.clientvalue_by_tag[tag];
		
		if (!cv)
			return;
		
		var i = cv.index;
		var clientState = this.me.localClientState;
		
		// Ensure client state long enough
		if (clientState.length < i + 1)
			clientState.length = i + 1;
		
		if (clientState[i] !== x)
		{
			clientState[i] = x;
			this.me.lastStateChange = window.cr_performance_now();
		}
	};
	
	C2Multiplayer.prototype.addClientInputValue = function (tag_, precision_, interp_)
	{
		var cv = new NetValue(this.clientvalues.length, interp_, precision_, tag_, null);
		
		this.clientvalue_by_tag[tag_] = cv;
		this.clientvalues.push(cv);
	};
	
	C2Multiplayer.prototype.getClientValuesJSON = function ()
	{
		var ret = [];
		var i, len, v;
		for (i = 0, len = this.clientvalues.length; i < len; ++i)
		{
			v = this.clientvalues[i];
			
			ret.push({
				"tag": v.tag,
				"precision": v.precision,
				"interp": v.interp
			});
		}
		
		return ret;
	};
	
	C2Multiplayer.prototype.mapClientValues = function (arr)
	{
		// Override the client values with what the host advises
		this.clientvalue_by_tag = {};
		this.clientvalues.length = 0;
		
		var i, len, v, cv;
		for (i = 0, len = arr.length; i < len; ++i)
		{
			v = arr[i];
			
			cv = new NetValue(i, v["interp"], v["precision"], v["tag"], null);
			
			this.clientvalue_by_tag[v["tag"]] = cv;
			this.clientvalues.push(cv);
		}
		
		this.receivedClientValues = true;
	};
	
	C2Multiplayer.prototype.removeObjectId = function (id)
	{
		var i, len;
		for (i = 0, len = this.registeredObjects.length; i < len; ++i)
		{
			this.registeredObjects[i].removeObjectId(id);
		}
	};
	
	C2Multiplayer.prototype.getPeerCount = function ()
	{
		if (!this.isInRoom())
			return 0;
		
		return this.peers.length;
	};
	
	C2Multiplayer.prototype.getPeerAt = function (i)
	{
		if (!this.isInRoom() || i < 0 || i >= this.peers.length)
			return null;
		
		return this.peers[i];
	};
	
	C2Multiplayer.prototype.isReadyForInput = function ()
	{
		if (!this.isInRoom())
			return false;
		
		if (this.isHost())
			return true;
		
		// Not ready until we have at least the first idea what the host time is
		return this.targetHostTimeDiff !== 0;
	};
	
	C2Multiplayer.prototype.setBandwidthSettings = function (updateRate_, delay_)
	{
		// Cannot set while already in a room
		if (this.isInRoom())
			return;
		
		this.hostUpdateRateSec = updateRate_;
		this.peerUpdateRateSec = updateRate_;
		this.clientDelay = delay_;
	};
	
	// Utility functions
	var startup_time = +(new Date());
	
	window.cr_performance_now = function()
	{
		if (typeof window["performance"] !== "undefined")
		{
			var winperf = window["performance"];
			
			if (typeof winperf.now !== "undefined")
				return winperf.now();
			else if (typeof winperf["webkitNow"] !== "undefined")
				return winperf["webkitNow"]();
			else if (typeof winperf["mozNow"] !== "undefined")
				return winperf["mozNow"]();
			else if (typeof winperf["msNow"] !== "undefined")
				return winperf["msNow"]();
		}
		
		return Date.now() - startup_time;
	};
	
	window.cr_shallowAssignArray = function (dest, src)
	{
		dest.length = src.length;
		
		var i, len;
		for (i = 0, len = src.length; i < len; i++)
			dest[i] = src[i];
	};
	
	window.cr_lerp = function (a, b, x)
	{
		return a + (b - a) * x;
	};
	
	window.cr_unlerp = function (a, b, c)
	{
		if (a === b)
			return 0;		// avoid divide by 0
		
		return (c - a) / (b - a);
	};
	
	 function angleDiff(a1, a2)
	{
		if (a1 === a2)
			return 0;

		var s1 = Math.sin(a1);
		var c1 = Math.cos(a1);
		var s2 = Math.sin(a2);
		var c2 = Math.cos(a2);
		var n = s1 * s2 + c1 * c2;
		
		// Prevent NaN results
		if (n >= 1)
			return 0;
		if (n <= -1)
			return Math.PI;
			
		return Math.acos(n);
	};
	
	function angleClockwise(a1, a2)
	{
		var s1 = Math.sin(a1);
		var c1 = Math.cos(a1);
		var s2 = Math.sin(a2);
		var c2 = Math.cos(a2);
		return c1 * s2 - s1 * c2 <= 0;
	};
	
	window.cr_anglelerp = function (a, b, x)
	{
		var diff = angleDiff(a, b);
		
		// b clockwise from a
		if (angleClockwise(b, a))
		{
			return a + diff * x;
		}
		else
		{
			return a - diff * x;
		}
	};
	
	window.cr_clamp_angle = function (a)
	{
		// Clamp in radians
		a %= 2 * Math.PI;       // now in (-2pi, 2pi) range

		if (a < 0)
			a += 2 * Math.PI;   // now in [0, 2pi) range

		return a;
	};
	
	// Expose to global namespace
	window["C2Multiplayer"] = C2Multiplayer;

})();