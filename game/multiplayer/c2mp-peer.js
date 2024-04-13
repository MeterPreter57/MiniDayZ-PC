"use strict";

(function () {
	
	// Polyfill string.trim if missing
	if (!String.prototype.trim)
	{
		String.prototype.trim = function () {
			return this.replace(/^\s+|\s+$/g, '');
		};
	}

	var RTCPeerConnection = window["RTCPeerConnection"] || window["webkitRTCPeerConnection"] || window["mozRTCPeerConnection"] || window["msRTCPeerConnection"];

	var MAGIC_NUMBER = 0x63326D70;	// to identify non-fragmented messages originating from this protocol
	
	// In some circumstances calling close() can throw an exception (e.g. if it already got closed by system sleep).
	// Avoid this crashing the game by swallowing any exceptions.
	function closeIgnoreException(o)
	{
		if (!o)
			return;
		
		try {
			o.close();
		}
		catch (e)
		{
		}
	};
	
	function Peer(mp_, id_, alias_)
	{
		this.mp = mp_;
		
		this.id = id_;					// signalling-assigned ID
		this.nid = 0;					// network ID
		this.alias = alias_;
		
		this.pc = null;					// WebRTC peer connection
		
		this.dco = null;				// Reliable and ordered channel
		this.isOOpen = false;
		
		this.dcr = null;				// Reliable and unordered datachannel
		this.isROpen = false;
		
		this.dcu = null;				// Unreliable and unordered datachannel
		this.isUOpen = false;
		
		this.firedOpen = false;			// for firing onOpen
		this.firedClose = false;		// for firing onClose
		this.wasRemoved = false;
		this.hasConfirmed = false;
		
		this.lastHeardFrom = 0;			// last heard from in local time for timing out unreachable peers
		this.connectTime = 0;			// time host tried to connect to (will kick after a timeout)
		this.errorCount = 0;			// too many errors will remove a client
		
		this.localClientState = [];
		this.lastStateChange = 0;
		this.lastStateTransmit = 0;
		
		this.clientStateUpdates = [];	// netupdates for received client states
		this.priorUpdate2 = null;		// the second update before interp time
		this.priorUpdate = null;		// the first update before interp time
		this.nextUpdate = null;			// the first update after interp time
		
		// Latency measurement
		this.lastPingSent = 0;
		this.awaitingPong = false;
		this.lastSentPingId = 1;
		this.lastPingTimes = [];
		this.latency = 0;
		this.pdv = 0;					// packet delay variation
		
		// Add self to the multiplayer object peer list
		this.mp.peers.push(this);
		this.mp.peers_by_id[this.id] = this;
	};
	
	Peer.prototype.attachDatachannelHandlers = function (dc, type)
	{
		var self = this;
		
		dc.binaryType = "arraybuffer";
		
		dc.onopen = function ()
		{
			if (type === "o")
				self.isOOpen = true;
			else if (type === "r")
				self.isROpen = true;
			else if (type === "u")
				self.isUOpen = true;
			
			self.maybeFireOpen();
		};
		
		dc.onmessage = function (m)
		{
			self.onMessage(type, m);
		};
	
		dc.onerror = function (e)
		{
			console.error("Peer '" + self.id + "' datachannel '" + type + "' error: ", e);
			
			if (self.mp.onpeererror)
				self.mp.onpeererror(self, e);
			
			// Host removes any datachannel which encounters an error.
			if (self.mp.me === self.mp.host && self !== self.mp.host)
			{
				self.remove("network error");
			}
		};
		
		dc.onclose = function ()
		{
			self.remove("disconnect");
		};
	};
	
	Peer.prototype.connect = function ()
	{
		if (this.mp.me === this)
			return;		// cannot connect to self!
		
		// Host creates offer, peer responds with answer
		var iamhost = (this.mp.me === this.mp.host);
		
		var self = this;
		this.isOOpen = false;
		this.isROpen = false;
		this.isUOpen = false;
		this.firedOpen = false;
		this.firedClose = false;
		this.connectTime = window.cr_performance_now();
		
		// Create the peer connection. Enable Google's experimental IPv6 support.
		this.pc = new RTCPeerConnection({"iceServers": this.mp.getIceServerList()}, {"optional": [{"googIPv6": true}]});
		
		// Forward ICE candidates to this peer via signalling
		this.pc.onicecandidate = function (e)
		{
			if (e.candidate)
			{
				self.mp.signallingSend({
					message: "icecandidate",
					toclientid: self.id,
					icecandidate: e.candidate
				});
			}
		};
		
		// Detect if peerconnection closes
		this.pc.onsignalingstatechange = function ()
		{
			if (!self.pc)
				return;
			
			if (self.pc.signalingState === "closed")
			{
				self.remove("disconnect");
			}
		};
		
		// Detect if ICE connection closes
		this.pc.oniceconnectionstatechange = function ()
		{
			if (!self.pc)
				return;
			
			if (self.pc.iceConnectionState === "connected")
			{
				//self.isConnected = true;
			}
			else if (self.pc.iceConnectionState === "disconnected" || self.pc.iceConnectionState === "failed" || self.pc.iceConnectionState === "closed")
			{
				self.remove("disconnect");
			}
		};
		
		var dc_protocol = "c2mp_" + this.mp.game + "_" + this.mp.gameinstance + "_" + this.mp.room;
		
		if (iamhost)
		{
			this.nid = this.mp.allocatePeerNid();
			
			// 'reliable' property not in spec but is present in some code samples, so may still be understood by browsers
			this.dco = this.pc.createDataChannel("o", {ordered: true, protocol: dc_protocol});
			this.attachDatachannelHandlers(this.dco, "o");
			
			this.dcr = this.pc.createDataChannel("r", {ordered: false, protocol: dc_protocol});
			this.attachDatachannelHandlers(this.dcr, "r");
			
			this.dcu = this.pc.createDataChannel("u", {ordered: false, maxRetransmits: 0, protocol: dc_protocol});
			this.attachDatachannelHandlers(this.dcu, "u");
			
			// Create an offer and dispatch it to the peer
			this.pc.createOffer(function (offer)
			{
				self.pc.setLocalDescription(offer);
				
				self.mp.signallingSend({
					message: "offer",
					toclientid: self.id,
					offer: offer
				});
			}, function (err)
			{
				console.error("Host error creating offer for peer '" + self.id + "': " + err);
				
				if (self.mp.onpeererror)
					self.mp.onpeererror(self, "could not create offer for peer");
			});
		}
		// I am not the host
		else
		{
			// Fires when connection established and datachannel received
			this.pc.ondatachannel = function (e)
			{
				if (e.channel.protocol !== dc_protocol)
				{
					console.error("Unexpected datachannel protocol '" + e.channel.protocol + "', should be '" + expect_protocol + "'");
				
					if (self.mp.onpeererror)
					{
						self.mp.onpeererror(self, "unexpected datachannel protocol '" + e.channel.protocol + "', should be '" + expect_protocol + "'");
					}
					
					return;
				}
				
				var label = e.channel.label;
				
				if (label === "o")
					self.dco = e.channel;
				else if (label === "r")
					self.dcr = e.channel;
				else if (label === "u")
					self.dcu = e.channel;
				else
				{
					console.error("Unknown datachannel label: " + e.channel.label);
				
					if (self.mp.onpeererror)
					{
						self.mp.onpeererror(self, "unknown datachannel label '" + e.channel.label + "'");
					}
				}
					
				self.attachDatachannelHandlers(e.channel, label);
			};
		}
	};
	
	Peer.prototype.maybeFireOpen = function ()
	{
		if (this.firedOpen)
			return;
		
		// Only ready to fire open event when all datachannels are open		
		if (this.isROpen && this.isUOpen && this.isOOpen)
		{
			this.onOpen();
			
			this.firedOpen = true;
			this.firedClose = false;
		}
	};
	
	Peer.prototype.onOpen = function ()
	{
		this.lastHeardFrom = window.cr_performance_now();
		
		// If host, notify other peers of join, and notify the joining peer of the other peers
		if (this.mp.me === this.mp.host)
		{
			this.mp.hostBroadcast("o", JSON.stringify({
				"c": "j",
				"i": this.id,
				"n": this.nid,
				"a": this.alias
			}), this);
			
			this.send("o", JSON.stringify({
				"c": "hi",
				"hn": this.mp.host.nid,						// host NID
				"n": this.nid,								// client's assigned NID
				"d": this.mp.clientDelay,					// mandatory client-side delay
				"u": this.mp.peerUpdateRateSec,				// advised upload rate
				"objs": this.mp.getRegisteredObjectsMap(),	// registered objects SID map
				"cvs": this.mp.getClientValuesJSON()		// client values host is expecting
			}));
			
			var i, len, p;
			for (i = 0, len = this.mp.peers.length; i < len; ++i)
			{
				p = this.mp.peers[i];
				
				if (p === this.mp.host || p === this || !p.isOpen())
					continue;
				
				this.send("o", JSON.stringify({
					"c": "j",
					"i": p.id,
					"n": p.nid,
					"a": p.alias
				}));
			}
		}
		else
		{
			// No need to confirm peers when not host
			this.hasConfirmed = true;
			
			// I am not host, but need to know host clock/latency info ASAP: ping
			// the host upon connection
			if (this === this.mp.host)
				this.sendPing(window.cr_performance_now(), true);
		}
		
		if (this.mp.onpeeropen)
			this.mp.onpeeropen(this);
	};
	
	Peer.prototype.maybeFireClose = function (reason)
	{
		if (this.firedClose || !this.firedOpen)
			return;
		
		this.onClose(reason);
			
		this.firedClose = true;
		this.firedOpen = false;
	};
	
	Peer.prototype.onClose = function (reason)
	{
		// If host, notify other peers of this peer leaving (unless it's host leaving, in which case it'll send disconnect instead)
		if (this.mp.me === this.mp.host && this !== this.mp.me)
		{
			this.mp.hostBroadcast("o", JSON.stringify({
				"c": "l",
				"i": this.id,
				"a": this.alias,
				"r": reason
			}), this);
		}
		
		// Don't fire close event for local client
		if (this.mp.onpeerclose && this !== this.mp.me)
			this.mp.onpeerclose(this, reason);
	};
	
	Peer.prototype.isOpen = function ()
	{
		return this.firedOpen && !this.firedClose;
	};
	
	Peer.prototype.send = function (type, m)
	{
		// Track outbound messages and bandwidth for statistics
		this.mp.stats.outboundCount++;
		
		if (m.length)
			this.mp.stats.outboundBandwidthCount += m.length;
		else if (m.byteLength)
			this.mp.stats.outboundBandwidthCount += m.byteLength;
		
		// Simulate packet loss on the unreliable channel by simply
		// ignoring sends in some cases
		if (this.mp.simPacketLoss > 0 && type === "u")
		{
			if (Math.random() < this.mp.simPacketLoss)
				return;
		}
		
		// No latency simulation: dispatch immediately
		if (this.mp.simLatency === 0 && this.mp.simPdv === 0)
		{
			this.doSend(type, m);
		}
		// Otherwise simulate a latency in this packet being sent outbound
		else
		{
			var self = this;
			
			// For the reliable channels, if we are simulating packet loss then we multiply up
			// the simulated latency when a packet is "lost". This is to simulate a lost packet,
			// a response from the other end indicating it's missing, then retransmission. Thus
			// instead of a one-way journey there is a three-way journey, so we multiply by 3.
			var multiplier = 1;
			
			if (type !== "u" && Math.random() < this.mp.simPacketLoss)
				multiplier = 3;
			
			setTimeout(function () {
				self.doSend(type, m);
			}, this.mp.simLatency * multiplier + Math.random() * this.mp.simPdv * multiplier);
		}
	};
	
	Peer.prototype.doSend = function (type, m)
	{
		try {
			if (type === "o")
			{
				if (this.isOOpen && this.dco)
					this.dco.send(m);
			}
			else if (type === "r")
			{
				if (this.isROpen && this.dcr)
					this.dcr.send(m);
			}
			else if (type === "u")
			{
				if (this.isUOpen && this.dcu)
					this.dcu.send(m);
			}
		}
		catch (e)
		{
			// Ignore errors if peer already removed
			if (this.wasRemoved)
				return;
			
			// If host, remove peers that encounter errors
			if (this.mp.me === this.mp.host)
			{
				// Since the O and R channels are meant to be reliable, remove the peer if there's an error sending down
				// these, since the message will have been lost. On the other hand U errors are acceptable (counts as packet
				// loss), but in some cases unreachable peers will throw an error on every send(). In this case, remove
				// the peer if an error limit is exceeded.
				if (type === "o" || type === "r")
				{
					if (typeof m === "string")
					{
						console.error("Error sending " + m.length + "-char string on '" + type + "' to '" + this.alias + "', host kicking: ", e);
						console.log("String that failed to send from previous error was: " + m);
					}
					else
					{
						console.error("Error sending " + (m.length || m.byteLength) + "-byte binary on '" + type + "' to '" + this.alias + "', host kicking: ", e);
					}
					
					this.remove("network error");
				}
				else
				{
					this.errorCount++;
					
					if (this.errorCount >= 10)		// too many errors, assume peer is no longer reachable
					{
						if (typeof m === "string")
						{
							console.error("Too many errors (" + this.errorCount + ") sending data on '" + type + "' to '" + this.alias + "', kicking; last error was for sending " + m.length + "-char string: ", e);
							console.log("String that failed to send from previous error was: " + m);
						}
						else
						{
							console.error("Too many errors (" + this.errorCount + ") sending data on '" + type + "' to '" + this.alias + "', kicking; last error was for sending " + (m.length || m.byteLength) + "-byte binary: ", e);
						}
						
						this.remove("network error");
					}
				}
			}
			else
			{
				// Log an error but try to keep things going
				console.error("Error sending data on '" + type + "': ", e);
			}
		}
	};
	
	Peer.prototype.sendPing = function (nowtime, force)
	{
		if (this.wasRemoved)
			return;
		
		// If not connected and has been unable to establish connection after 25 sec, time out the peer.
		// Note signalling ought to send us quit notifications anyway if they don't get a confirmation
		// within the signalling server's own time limit, but in some cases the host seems to be left
		// with a timed out peer anyway, so this additional timeout is a backup.
		if (!force && !this.isOpen() && this.pc && (nowtime - this.connectTime > 25000))
		{
			console.warn("Timed out '" + this.alias + "', could not establish connection after 25sec");
			this.remove("timeout");
			return;
		}
		
		// If connected but not heard from for 20 sec, time out the peer
		if (!force && this.isOpen() && (nowtime - this.lastHeardFrom > 20000))
		{
			console.warn("Timed out '" + this.alias + "', not heard from for 20sec");
			this.remove("timeout");
			return;
		}
		
		this.lastPingSent = nowtime;
		this.awaitingPong = true;
		this.lastSentPingId++;
		this.send("u", "ping:" + this.lastSentPingId);
	};
	
	Peer.prototype.sendPong = function (pingstr)
	{
		// Respond with the same ping ID as was sent, i.e. "ping:8" responds "pong:8"
		var response = "pong:" + pingstr.substr(5);
		
		// Is host: include current time in pong response for clock synchronisation, e.g. "pong:8/12045"
		if (this.mp.host === this.mp.me)
		{
			response += "/";
			response += Math.round(window.cr_performance_now()).toString();
		}

		this.send("u", response);
	};
	
	var tempArray = [];
	
	function compareNumbers(a, b)
	{
		return a - b;
	}

	Peer.prototype.onPong = function (str)
	{
		if (!this.awaitingPong)
			return;		// ignore spurious or late pongs which could throw off measurements
		
		// Check the pong returned the same ID we sent it with. This ensures we received the response
		// to the last sent ping and not some other late or mixed up response.
		var colon = str.indexOf(":");
		
		if (colon > -1)
		{
			var pongId = parseFloat(str.substr(colon + 1));
			
			if (pongId !== this.lastSentPingId)
				return;		// ignore
		}
		else
		{
			console.warn("Cannot parse off ping ID from pong");
			return;
		}
		
		// Estimate the one-way transmission time. The packet has gone both ways, so we estimate the latency is half the round-trip time.
		var nowtime = window.cr_performance_now();
		
		this.awaitingPong = false;
		
		var lastlatency = (nowtime - this.lastPingSent) / 2;		
		this.lastPingTimes.push(lastlatency);
		
		// Keep last 10 pings
		if (this.lastPingTimes.length > 10)
			this.lastPingTimes.shift();
		
		// Copy the last ping times, sort them, and remove the top and bottom two
		// to eliminate any outliers. Take the latency as the average of the remaining
		// six ping measurements.
		window.cr_shallowAssignArray(tempArray, this.lastPingTimes);
		
		tempArray.sort(compareNumbers);
		
		// Update packet delay variation, including all values (outliers will be counted)
		this.pdv = tempArray[tempArray.length - 1] - tempArray[0];
		
		// If we're still getting going, the ping buffer won't be full. Remove the
		// top and bottom entries depending on how many there are.
		var start = 0;
		var end = tempArray.length;
		
		if (tempArray.length >= 4 && tempArray.length <= 6)
		{
			++start;
			--end;
		}
		else if (tempArray.length > 6)
		{
			start += 2;
			end -= 2;
		}
		
		// Set estimated latency to the average of the middle values.
		var i, sum = 0;
		for (i = start; i < end; ++i)
			sum += tempArray[i];
		
		this.latency = (sum / (end - start));
		
		// If not the host, then parse off the host clock time to estimate the clock difference.
		if (this.mp.host !== this.mp.me)
		{
			var slash = str.indexOf("/");
			
			if (slash > -1)
			{
				var hosttime = parseFloat(str.substr(slash + 1));
				
				if (isFinite(hosttime))
				{
					this.mp.addHostTime(hosttime, nowtime, lastlatency, this.latency);
				}
				else
					console.warn("Invalid host time from pong response");
			}
			else
				console.warn("Cannot parse off host time from pong response");
		}
	};
	
	Peer.prototype.onMessage = function (type, m)
	{
		// Simulate packet loss on unreliable channel
		if (this.mp.simPacketLoss > 0 && type === "u")
		{
			if (Math.random() < this.mp.simPacketLoss)
				return;
		}
		
		// No latency simulation: dispatch immediately
		if (this.mp.simLatency === 0 && this.mp.simPdv === 0)
		{
			this.doOnMessage(type, m);
		}
		// Otherwise simulate a latency in this packet being sent outbound
		else
		{
			var self = this;
			
			var multiplier = 1;
			
			if (type !== "u" && Math.random() < this.mp.simPacketLoss)
				multiplier = 3;
			
			setTimeout(function () {
				self.doOnMessage(type, m);
			}, this.mp.simLatency * multiplier + Math.random() * this.mp.simPdv * multiplier);
		}
	};
	
	Peer.prototype.doOnMessage = function (type, m)
	{
		// Ignore messages received after removing a peer
		if (this.wasRemoved)
			return;
		
		this.lastHeardFrom = window.cr_performance_now();
		
		// Track inbound count and bandwidth for statistics
		this.mp.stats.inboundCount++;
		
		if (m.data.length)
			this.mp.stats.inboundBandwidthCount += m.data.length;
		else if (m.data.byteLength)
			this.mp.stats.inboundBandwidthCount += m.data.byteLength;
		
		// Handle text message
		if (typeof m.data === "string")
		{
			// Sometimes browsers seem to send empty or whitespace-only string messages on connection.
			// Ignore any such whitespace messages or anything that looks too short to be a valid message.
			if (m.data.trim() === "" || m.data.length < 4)
				return;
			
			// Respond to pings with pongs
			var first4 = m.data.substr(0, 4);
			
			if (first4 === "ping")
			{
				this.sendPong(m.data);
				return;
			}
			
			if (first4 === "pong")
			{
				this.onPong(m.data);
				return;
			}

			var o;
			
			try {
				o = JSON.parse(m.data);
			}
			catch (e)
			{				
				if (this.mp.onpeererror)
					this.mp.onpeererror(this, e);
				
				if (this.mp.me === this.mp.host)
				{
					console.error("Error parsing message as JSON for peer '" + this.id + "', host kicking: ", e);
					this.remove("data error");
				}
				else
				{
					console.error("Error parsing message as JSON for peer '" + this.id + "': ", e);
				}
				
				console.log("String that failed to parse from previous error: " + m.data);
				
				return;
			}
			
			if (!o)
				return;
			
			// control message
			try {
				if (o["c"] && o["c"] !== "m")
				{
					this.onControlMessage(o);
				}
				// user message
				else
				{
					if (this.mp.onpeermessage)
						this.mp.onpeermessage(this, o);
				}
			}
			catch (e)
			{
				if (this.mp.onpeererror)
					this.mp.onpeererror(this, e);
				
				if (this.mp.me === this.mp.host)
				{
					console.error("Error handling message for peer '" + this.id + "', host kicking: ", e);
					this.remove("data error");
				}
				else
				{
					console.error("Error handling message for peer '" + this.id + "': ", e);
				}
			}
			
			return;
		}
		// Handle binary message
		else
		{
			// Confirm peer to server on first binary update on the "u" channel. Some peers appear to
			// connect OK but then fail to receive any binary updates. Not sure why this is.
			if (!this.hasConfirmed && this.mp.me === this.mp.host && type === "u")
			{
				// Tell signalling server we successfully connected to this peer
				this.hasConfirmed = true;
				this.mp.signallingConfirmPeer(this.id);
			}
			
			try {
				this.onBinaryMessage(m.data);
			}
			catch (e) {
				if (this.mp.onpeererror)
					this.mp.onpeererror(this, e);
				
				if (this.mp.me === this.mp.host)
				{
					console.error("Error handling binary update for peer '" + this.id + "', host kicking: ", e);
					this.remove("data error");
				}
				else
				{
					console.error("Error handling binary update for peer '" + this.id + "': ", e);
				}
				return;
			}
		}
	};
	
	Peer.prototype.onControlMessage = function (o)
	{
		var peer;
		var leave_room;
		
		switch (o["c"]) {
		case "disconnect":		// connection being closed from other end
			
			// If not the host, we've lost the host connection and are therefore no longer
			// in the room. So also leave the room on the signalling server too.
			// This must be checked before remove() since it will clear the me/host peers.
			leave_room = (this.mp.me !== this.mp.host && this === this.mp.host)
			
			this.remove(o["r"]);
			
			if (leave_room)
				this.mp.signallingLeaveRoom();
			
			break;
		case "hi":				// welcome message from host
			if (this.mp.me !== this.mp.host)
			{
				this.mp.host.nid = o["hn"];
				this.mp.me.nid = o["n"];

				// adopt host-advised config
				this.mp.clientDelay = o["d"];
				this.mp.peerUpdateRateSec = o["u"];
				
				// map object NIDs to SIDs
				this.mp.mapObjectNids(o["objs"]);
				
				// override client values with what the host advises
				this.mp.mapClientValues(o["cvs"]);
			}
			break;
		case "j":				// peer joined (only valid if not host)
			if (this.mp.me !== this.mp.host)
			{
				peer = new Peer(this.mp, o["i"], o["a"]);
				peer.nid = o["n"];
				
				// We don't really connect to them but fire the open event so client knows they're here
				if (this.mp.onpeeropen)
					this.mp.onpeeropen(peer);
			}
			break;
		case "l":				// peer left (only valid if not host)
			if (this.mp.me !== this.mp.host)
			{
				peer = this.mp.peers_by_id[o["i"]];
				
				if (peer)
				{
					if (this.mp.onpeerclose && peer !== this.mp.me)
						this.mp.onpeerclose(peer, o["r"]);
					
					peer.remove(o["r"]);
				}
			}
			break;
		default:
			console.error("Unknown control message from peer '" + this.id + "': " + o["c"]);
			
			if (this.mp.onpeererror)
				this.mp.onpeererror(this, "unknown control message '" + o["c"] + "'");
				
			break;
		}
	};
	
	var value_arrs = [];
	
	function allocValueArr()
	{
		if (value_arrs.length)
			return value_arrs.pop();
		else
			return [];
	};
	
	function freeValueArr(a)
	{
		a.length = 0;
		
		if (value_arrs.length < 10000)
			value_arrs.push(a);
	};
	
	window["allocValueArr"] = allocValueArr;
	window["freeValueArr"] = freeValueArr;
	
	Peer.prototype.onBinaryMessage = function (buffer)
	{
		if (this.mp.me === this.mp.host)
			this.onHostUpdate(buffer);
		else
			this.onPeerUpdate(buffer);
	};
	
	Peer.prototype.onHostUpdate = function (buffer)
	{
		var i, len, cv, value;
		
		/* Net format:
		uint32		MAGIC_NUMBER
		float64		timestamp
		uint8		flags (reserved)
		uint8		client state value count
		float32		client state 0
		float32		client state 1
		...
		float32		client state N
		*/
		
		var view = new DataView(buffer);
		var ptr = 0;
		
		var magic_number = view.getUint32(ptr);			ptr += 4;
		
		if (magic_number !== MAGIC_NUMBER)
		{
			console.warn("Rejected packet with incorrect magic number (received '" + magic_number + "', expected '" + MAGIC_NUMBER + "'");
			return;
		}
		
		var timestamp = view.getFloat64(ptr);			ptr += 8;
		
		// The timestamp is what the peer estimated the host's clock to be at the time it was sent.
		// However it will be delayed in transmission, so add the peer's estimated latency on top of that.
		// This means client input state packets should end up with timestamps close to the host time
		// they were actually received, but varying by the network PDV which interpolation can then compensate for.
		timestamp += this.latency;
		
		// The peer could possibly try to manipulate the game by varying the timestamp deliberately. To try to
		// avoid this, reject any incoming client state packets which are more than 3 seconds off the host time.
		if (Math.abs(timestamp - window.cr_performance_now()) >= 3000)
			return;
		
		var flags = view.getUint8(ptr);					ptr += 1;
		
		// Number of client state values
		var len = view.getUint8(ptr);					ptr += 1;
		
		var arr = allocValueArr();
		arr.length = len;
		
		var clientvalues = this.mp.clientvalues;
		
		for (i = 0; i < len; ++i)
		{
			if (i >= clientvalues.length)
			{
				arr[i] = 0;
				continue;
			}
			
			cv = clientvalues[i];
			
			switch (cv.precision) {
			case 0:		// high, double
				value = view.getFloat64(ptr);
				ptr += 8;
				break;
			case 1:		// normal, float
				value = view.getFloat32(ptr);
				ptr += 4;
				break;
			case 2:		// low, int16
				value = cv.maybeUnpack(view.getInt16(ptr));
				ptr += 2;
				break;
			case 3:		// very low, uint8
				value = cv.maybeUnpack(view.getUint8(ptr));
				ptr += 1;
				break;
			default:
				value = view.getFloat32(ptr);
				ptr += 4;
				break;
			}
			
			arr[i] = value;
		}
		
		this.addClientUpdate(timestamp, arr);
	};
	
	Peer.prototype.addClientUpdate = function (timestamp_, data_)
	{
		// Insert the new update in to the correct place in the updates queue
		// using its timestamp
		var i, len, u;
		for (i = 0, len = this.clientStateUpdates.length; i < len; ++i)
		{
			u = this.clientStateUpdates[i];
			
			// Timestamp matches another update exactly: must be a duplicate packet; discard it
			if (u.timestamp === timestamp_)
			{
				freeValueArr(data_);
				return;
			}
			
			if (u.timestamp > timestamp_)
			{
				this.clientStateUpdates.splice(i, 0, allocNetUpdate(timestamp_, data_));
				return;
			}
		}
		
		// If not inserted by above loop, must be latest update so add to end
		this.clientStateUpdates.push(allocNetUpdate(timestamp_, data_));
	};
	
	Peer.prototype.tick = function (simTime)
	{
		if (this.clientStateUpdates.length === 0)
			return;
		
		// Expire all client updates older than the 2nd last prior update
		while (this.clientStateUpdates.length > 2 && this.clientStateUpdates[0] !== this.priorUpdate2 && this.clientStateUpdates[0] !== this.priorUpdate && this.clientStateUpdates[0] !== this.nextUpdate)
		{
			freeNetUpdate(this.clientStateUpdates.shift());
		}
		
		// If the sim time is still between the prior and next updates, we don't need to do anything
		if (this.nextUpdate && this.nextUpdate.timestamp > simTime && this.priorUpdate && this.priorUpdate.timestamp < simTime)
		{
			return;
		}
		
		// Search through updates to find the updates either side of the simulation time.
		// Keep priorUpdate in case there is no newer data.
		this.nextUpdate = null;
		
		var i, len, u;
		for (i = 0, len = this.clientStateUpdates.length; i < len; ++i)
		{
			u = this.clientStateUpdates[i];
			
			if (u.timestamp <= simTime)
			{
				if (!this.priorUpdate || u.timestamp > this.priorUpdate.timestamp)
				{
					this.priorUpdate2 = this.priorUpdate;
					this.priorUpdate = u;
				}
			}
			else
			{
				this.nextUpdate = u;
				break;
			}
		}
	};
	
	Peer.prototype.onPeerUpdate = function (buffer)
	{
		var view = new DataView(buffer);
		var ptr = 0;
		
		var magic_number = view.getUint32(ptr);			ptr += 4;
		
		if (magic_number !== MAGIC_NUMBER)
		{
			console.warn("Rejected packet with incorrect magic number (received '" + magic_number + "', expected '" + MAGIC_NUMBER + "'");
			return;
		}
		
		var flags = view.getUint32(ptr);				ptr += 4;
		
		if (flags === 0)
			this.handlePeerUpdate(view, ptr);
		else if (flags === 1)
			this.handlePeerEvents(view, ptr);
		else
			console.warn("Ignoring packet with incorrect flags (received " + flags + ", expected 0 or 1");
	};
	
	Peer.prototype.handlePeerUpdate = function (view, ptr)
	{
		var i, j, k, nid, ro, count, valuesize, netvalues, nv, valuecount, value, instnid, arr, flags;
		var vptr = 0;
		
		/* Net format:
		uint32		MAGIC_NUMBER
		uint32		flags: 0 for host update
		float64		timestamp
		uint16		registered object count

		for each registered object:
			uint16		nid
			uint8		flags
			uint16		instance count
			uint16		byte count for each net instance's net values
			
			for each instance:
				uint16		nid
				float32		netvalue0
				float32		netvalue1
				...
				float32		netvalueN
		*/
		
		var timestamp = view.getFloat64(ptr);			ptr += 8;
		
		var robjcount = view.getUint16(ptr);			ptr += 2;
		
		for (i = 0; i < robjcount; ++i)
		{
			nid = view.getUint16(ptr);					ptr += 2;
			flags = view.getUint8(ptr);					ptr += 1;
			
			ro = this.mp.objectsByNid[nid];
			
			if (ro)
			{
				netvalues = ro.netvalues;
				valuecount = netvalues.length;
				
				if (flags === 1)
					ro.hasOverriddenNids = true;
			}
			else
			{
				console.warn("Don't know which object corresponds to NID " + nid);
			}
			
			count = view.getUint16(ptr);				ptr += 2;
			valuesize = view.getUint16(ptr);			ptr += 2;
			
			for (j = 0; j < count; ++j)
			{
				// read instance nid
				instnid = view.getUint16(ptr);			ptr += 2;
				
				// read instance net values
				if (ro)
				{
					arr = allocValueArr();
					arr.length = valuecount;
					vptr = ptr;
					
					for (k = 0; k < valuecount; ++k)
					{
						nv = netvalues[k];
						switch (nv.precision) {
						case 0:		// high, double
							value = view.getFloat64(vptr);
							vptr += 8;
							break;
						case 1:		// normal, float
							value = view.getFloat32(vptr);
							vptr += 4;
							break;
						case 2:		// low, int16
							value = nv.maybeUnpack(view.getInt16(vptr));
							vptr += 2;
							break;
						case 3:		// very low, uint8
							value = nv.maybeUnpack(view.getUint8(vptr));
							vptr += 1;
							break;
						default:
							value = view.getFloat32(vptr);
							vptr += 4;
							break;
						}
						
						arr[k] = value;
					}
					
					ro.addUpdate(timestamp, instnid, arr);
				}
				
				ptr += valuesize;		// skip over the size of the value data
			}
		}
	};
	
	Peer.prototype.handlePeerEvents = function (view, ptr)
	{
		var i, ro, ro_nid, j, lenj, dead_nid;
		
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
		
		var timestamp = view.getFloat64(ptr);			ptr += 8;
		var robjcount = view.getUint16(ptr);			ptr += 2;
		
		for (i = 0; i < robjcount; ++i)
		{
			ro_nid = view.getUint16(ptr);				ptr += 2;
			ro = this.mp.objectsByNid[ro_nid];
			
			if (!ro)
			{
				console.warn("Don't know which object corresponds to NID " + ro_nid);
			}
			
			lenj = view.getUint16(ptr);					ptr += 2;
			
			for (j = 0; j < lenj; ++j)
			{
				dead_nid = view.getUint16(ptr);			ptr += 2;
				
				if (!ro)
					continue;
					
				// Don't fire destroy events for peer associated objects: the peer leave
				// event handles that instead.
				if (ro.hasOverriddenNids)
					continue;
				
				if (this.mp.oninstancedestroyed)
					this.mp.oninstancedestroyed(ro, dead_nid, timestamp);
				
				ro.removeObjectNid(dead_nid);
			}
		}
	};
	
	Peer.prototype.remove = function (reason)
	{
		// If the peerconnection is closed in this call, later calls to onclose could try to remove it
		// again, by which time the peer could have joined again. So ensure we only ever remove the peer once.
		if (this.wasRemoved)
			return;

		this.wasRemoved = true;
		
		this.maybeFireClose(reason);
		
		// Send disconnect notification if possible.
		// send() could throw and try to remove the peer again, but the wasRemoved check will catch that.
		this.send("o", JSON.stringify({
			"c": "disconnect",
			"r": reason
		}));
		
		closeIgnoreException(this.dco);
		closeIgnoreException(this.dcr);
		closeIgnoreException(this.dcu);
		closeIgnoreException(this.pc);
		
		this.dco = null;
		this.dcr = null;
		this.dcu = null;
		this.pc = null;
		this.isOOpen = false;
		this.isROpen = false;
		this.isUOpen = false;
		
		if (this.mp.me === this.mp.host)
		{
			this.mp.freePeerNid(this.nid);
			this.nid = -1;
		}
		
		var i = this.mp.peers.indexOf(this);
		
		if (i > -1)
			this.mp.peers.splice(i, 1);
		
		if (this.mp.peers_by_id.hasOwnProperty(this.id))
			delete this.mp.peers_by_id[this.id];
		
		if (this.mp.host === this)
		{
			this.mp.host = null;
			this.mp.removeAllPeers("host quit");
		}
		
		if (this.mp.me === this)
		{
			this.mp.me = null;
			this.mp.room = "";
			this.mp.removeAllPeers("disconnect");
		}
	};
	
	Peer.prototype.hasClientState = function (tag)
	{
		return this.mp.clientvalue_by_tag.hasOwnProperty(tag);
	}
	
	Peer.prototype.getClientState = function (tag)
	{
		var cv = this.mp.clientvalue_by_tag[tag];
		
		if (!cv)
			return 0;
		
		var i = cv.index;
		
		if (this.clientStateUpdates.length === 0)
			return 0;
		
		// Return latest value only
		var arr = this.clientStateUpdates[this.clientStateUpdates.length - 1].data;
		
		if (i < 0 || i >= arr.length)
			return 0;
		
		return arr[i];
	};
	
	var interpNetValue = window["interpNetValue"];
	
	Peer.prototype.getInterpClientState = function (tag)
	{
		var cv = this.mp.clientvalue_by_tag[tag];
		
		if (!cv)
			return;
		
		var i = cv.index;
		
		var arr, fromTime, fromVal, toTime, toVal, x, aheadTime;
		
		if (!this.nextUpdate && !this.priorUpdate)
			return 0;		// no data
		
		// only got next data: return just that with no interp
		if (this.nextUpdate && !this.priorUpdate)
		{
			arr = this.nextUpdate.data;
			
			if (i < 0 || i >= arr.length)
				return 0;
			else
				return arr[i];
		}
		
		var simTime = this.mp.getSimulationTime();
		
		// only got prior data: return just that with no interp.
		// note we never extrapolate ahead with client input.
		if (!this.nextUpdate && this.priorUpdate)
		{
			// got prior data before that as well
			if (this.priorUpdate2)
			{
				// Extrapolate up to a maximum of 250ms ahead based on interpolating where
				// priorUpdate2 and priorUpdate are going. After 1s just stop, there's no
				// point continuing off forever without any data, this is just to paper over gaps.
				fromTime = this.priorUpdate2.timestamp;
				fromVal = this.priorUpdate2.data[i];
				
				toTime = this.priorUpdate.timestamp;
				toVal = this.priorUpdate.data[i];
				
				aheadTime = simTime;
				
				if (aheadTime > this.priorUpdate.timestamp + 250)
					aheadTime = this.priorUpdate.timestamp + 250;
				
				x = window.cr_unlerp(fromTime, toTime, aheadTime);
				
				return interpNetValue(this.mp.clientvalues[i].interp, fromVal, toVal, x, true);
			}
			// No prior data before that: can only return priorUpdate
			else
			{
				arr = this.priorUpdate.data;
				
				if (i < 0 || i >= arr.length)
					return 0;
				else
					return arr[i];
			}
		}
		
		// Otherwise got both: interpolate
		fromTime = this.priorUpdate.timestamp;
		fromVal = this.priorUpdate.data[i];
		
		toTime = this.nextUpdate.timestamp;
		toVal = this.nextUpdate.data[i];
		
		x = window.cr_unlerp(fromTime, toTime, simTime);
		
		return interpNetValue(this.mp.clientvalues[i].interp, fromVal, toVal, x, false);
	};
	
	// Expose to global namespace
	window["C2Peer"] = Peer;

})();