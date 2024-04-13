"use strict";

(function () {

	function NetValue(index_, interp_, precision_, tag_, userdata_, clientvaluetag_)
	{
		this.index = index_;
		this.interp = interp_;
		this.precision = precision_;
		this.tag = tag_;
		this.userdata = userdata_;
		this.clientvaluetag = clientvaluetag_;
	};
	
	window["C2NetValue"] = NetValue;
	
	var f32arr = null;
	
	if (typeof Float32Array !== "undefined")
		f32arr = new Float32Array(1);
	
	function toFloat32(x)
	{
		if (Math.fround)
			return Math.fround(x);
		else if (f32arr)
		{
			// cast using typed array if supported
			f32arr[0] = x;
			return f32arr[0];
		}
		else
			return x;	// leave as double, don't have a way to cast
	};
	
	NetValue.prototype.clamp = function (x)
	{
		switch (this.precision) {
		case 0:				// high, 8 byte double
			return x;		// JS numbers are already double
			
		case 1:				// normal, 4 byte float
			return toFloat32(x);
			
		case 2:				// low, 2 byte int16
			// If using angular interpolation, clamp the angle to range (-32767, 32767)
			if (this.interp === 2)	// INTERP_ANGULAR
			{
				x = window.cr_clamp_angle(x);	// [0, 2pi)
				x /= Math.PI;			// [0, 2)
				x -= 1;					// [-1, 1)
				x *= 32767;				// [-32767, 32767)
			}
			
			x = x | 0;		// cast to int
				
			if (x < -32768)
				x = -32768;
			else if (x > 32767)
				x = 32767;
				
			return x;
			
		case 3:				// very low, 1 byte uint8
			// If using angular interpolation, clamp the angle to range (0, 255)
			if (this.interp === 2)	// INTERP_ANGULAR
			{
				x = window.cr_clamp_angle(x);	// [0, 2pi)
				x /= 2 * Math.PI;		// [0, 1)
				x *= 255;				// [0, 255)
			}
			
			x = x | 0;		// case to int
			
			if (x < 0)
				x = 0;
			else if (x > 255)
				x = 255;
				
			return x;
			
		default:
			return x;
		};
	};
	
	NetValue.prototype.write = function (dv, ptr, x)
	{
		switch (this.precision) {
		case 0: // high, double
			dv.setFloat64(ptr, x);
			ptr += 8;
			break;
		case 1:	// normal, float
			dv.setFloat32(ptr, x);
			ptr += 4;
			break;
		case 2:	// low, int16
			dv.setInt16(ptr, x);
			ptr += 2;
			break;
		case 3:	// very low, uint8
			dv.setUint8(ptr, x);
			ptr += 1;
			break;
		default:
			dv.setFloat32(ptr, x);
			ptr += 4;
			break;
		}
		
		return ptr;
	};
	
	NetValue.prototype.maybeUnpack = function (x)
	{
		if (this.interp !== 2)
			return x;		// not angular interpolation, no need to unpack
		
		if (this.precision === 2)
		{
			// unpack int16 to radians
			x /= 32767;			// [-1, 1]
			x += 1;				// [0, 2]
			x *= Math.PI;		// [0, 2pi]
			return x;
		}
		else if (this.precision === 3)
		{
			// unpack uint8 to radians
			x /= 255;					// [0, 1]
			x *= 2 * Math.PI;			// [0, 2pi]
			return x;
		}
		else
			return x;
	};
	
	var netupdates_cache = [];
	
	function allocNetUpdate(timestamp_, data_)
	{
		var ret;
		
		if (netupdates_cache.length)
		{
			ret = netupdates_cache.pop();
			ret.timestamp = timestamp_;
			ret.data = data_;
			return ret;
		}
		else
			return new NetUpdate(timestamp_, data_);
	};
	
	function freeNetUpdate(u)
	{
		freeValueArr(u.data);
		u.data = null;
		u.timestamp = 0;
		
		if (netupdates_cache.length < 10000)
			netupdates_cache.push(u);
	};
	
	window["allocNetUpdate"] = allocNetUpdate;
	window["freeNetUpdate"] = freeNetUpdate;
	
	function NetUpdate(timestamp_, data_)
	{
		this.timestamp = timestamp_;
		this.data = data_;
	};
	
	var netinstances_cache = [];
	
	function allocNetInstance(ro_, id_, nid_)
	{
		var ret;
		
		if (netinstances_cache.length)
		{
			ret = netinstances_cache.pop();
			ret.ro = ro_;
			ret.id = id_;
			ret.nid = nid_;
			ret.data = allocValueArr();
			ret.data.length = ret.ro.netvalues.length;
			return ret;
		}
		else
			return new NetInstance(ro_, id_, nid_);
	};
	
	function freeNetInstance(inst)
	{
		inst.ro = null;
		
		freeValueArr(inst.data);
		inst.data = null;
		
		var i, len;
		for (i = 0, len = inst.updates.length; i < len; ++i)
			freeNetUpdate(inst.updates[i]);
		
		inst.updates.length = 0;
		
		inst.last_changed = 0;
		inst.last_transmitted = 0;
		inst.transmit_me = false;
		inst.alive = true;
		inst.priorUpdate2 = null;
		inst.priorUpdate = null;
		inst.nextUpdate = null;
		
		if (netinstances_cache.length < 1000)
			netinstances_cache.push(inst);
	};
	
	function NetInstance(ro_, id_, nid_)
	{
		this.ro = ro_;
		this.mp = ro_.mp;
		this.id = id_;
		this.nid = nid_;
		
		// Host state tracking
		this.data = allocValueArr();
		this.data.length = this.ro.netvalues.length;
		
		this.last_changed = 0;
		this.last_transmitted = 0;
		this.transmit_me = false;
		
		this.alive = true;				// for mark-and-sweep to remove destroyed objects
		
		// Peer interpolation for updates
		this.updates = [];
		this.priorUpdate2 = null;		// the second update before interp time
		this.priorUpdate = null;		// the first update before interp time
		this.nextUpdate = null;			// the first update after interp time
	};
	
	NetInstance.prototype.getData = function (index, nowtime)
	{
		var i, value;
		var netvalues = this.ro.netvalues;
		var valuecount = netvalues.length;
		this.transmit_me = false;
		var nv;
		
		// Get the latest values
		for (i = 0; i < valuecount; ++i)
		{
			nv = netvalues[i];
			value = nv.clamp(this.mp.ongetobjectvalue(this.ro.obj, index, nv));
			
			// If value has changed, update the last changed time so it gets retransmitted
			if (this.data[i] !== value)
			{
				this.data[i] = value;
				this.last_changed = nowtime;
				this.ro.last_changed = nowtime;
			}
		}
		
		// Bandwidth reduction:
		// If a value stops changing, transmit it every update for another 100ms
		// to try to make sure the latest value arrives at the other end.
		// After 100ms, transmit it every 100ms until 1 second has passed.
		// After that, only transmit it every 500ms. This reduces the bandwidth,
		// but allows severe packet loss or newly joining players to quickly
		// get new data.
		// Low bandwidth mode instead transmits at most every 100ms, and
		// very low bandwidth mode just uses the every 500ms mode.
		var time_since_changed = nowtime - this.last_changed;
		var time_since_transmit = nowtime - this.last_transmitted;
		
		// Bandwidth modes:
		// 0: normal (max every update)
		// 1: low (max every 100ms)
		// 2: very low (max every 500ms)
		var bandwidth = this.ro.bandwidth;
		
		if (time_since_changed < 100 && bandwidth === 0)
		{
			this.transmit_me = true;
		}
		else if (time_since_changed < 1000 && bandwidth <= 1)
		{
			this.transmit_me = (time_since_transmit >= 95);
		}
		else
			this.transmit_me = (time_since_transmit >= 495);
		
		if (this.transmit_me)
			this.ro.number_to_transmit++;
	};
	
	NetInstance.prototype.writeData = function (dv, ptr, nowtime)
	{
		var i, len, nv, value;
		var netvalues = this.ro.netvalues;
		
		this.last_transmitted = nowtime;
		dv.setUint16(ptr, this.nid);	ptr += 2;
		
		for (i = 0, len = this.data.length; i < len; ++i)
		{
			ptr = netvalues[i].write(dv, ptr, this.data[i]);
		}
		
		return ptr;
	};
	
	NetInstance.prototype.addUpdate = function (timestamp_, data_)
	{
		// Insert the new update in to the correct place in the updates queue
		// using its timestamp
		var i, len, u;
		for (i = 0, len = this.updates.length; i < len; ++i)
		{
			u = this.updates[i];
			
			// Timestamp matches another update exactly: must be a duplicate packet; discard it
			if (u.timestamp === timestamp_)
			{
				freeValueArr(data_);
				return;
			}
			
			if (u.timestamp > timestamp_)
			{
				this.updates.splice(i, 0, allocNetUpdate(timestamp_, data_));
				return;
			}
		}
		
		// If not inserted by above loop, must be latest update so add to end
		this.updates.push(allocNetUpdate(timestamp_, data_));
	};
	
	NetInstance.prototype.isTimedOut = function (simTime)
	{
		// If the last update was over 3 seconds ago, time out this instance.
		// Don't try to time out if no data though.
		if (!this.updates.length)
			return false;
		
		return (this.updates[this.updates.length - 1].timestamp < simTime - 3000);
	};
	
	NetInstance.prototype.tick = function ()
	{
		// Expire all updates older than the 2nd last prior update
		while (this.updates.length > 2 && this.updates[0] !== this.priorUpdate2 && this.updates[0] !== this.priorUpdate && this.updates[0] !== this.nextUpdate)
		{
			freeNetUpdate(this.updates.shift());
		}
		
		var simTime = this.ro.simTime;
		
		// If the sim time is still between the prior and next updates, we don't need to do anything
		if (this.nextUpdate && this.nextUpdate.timestamp > simTime && this.priorUpdate && this.priorUpdate.timestamp < simTime)
		{
			return;
		}
		
		// Search through updates to find the updates either side of the simulation time.
		// Keep priorUpdate in case there is no newer data.
		this.nextUpdate = null;
		
		var i, len, u;
		for (i = 0, len = this.updates.length; i < len; ++i)
		{
			u = this.updates[i];
			
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
	
	NetInstance.prototype.getLatestUpdate = function (valueindex)
	{
		if (this.updates.length === 0)
			return null;
		
		return this.updates[this.updates.length - 1];
	};
	
	NetInstance.prototype.getInterp = function (simTime, valueindex, noextrapolate)
	{
		var fromTime, fromVal, toTime, toVal, x, aheadTime;
		
		if (!this.nextUpdate && !this.priorUpdate)
			return 0;		// no data
		
		// only got next data
		if (this.nextUpdate && !this.priorUpdate)
			return this.nextUpdate.data[valueindex];
		
		var netvalues = this.ro.netvalues;
		
		// only got prior data
		if (!this.nextUpdate && this.priorUpdate)
		{
			// got prior data before that as well
			if (this.priorUpdate2 && !noextrapolate)
			{
				// Extrapolate up to a maximum of ro.extrapolateLimit ahead based on interpolating where
				// priorUpdate2 and priorUpdate are going. After 1s just stop, there's no
				// point continuing off forever without any data, this is just to paper over gaps.
				fromTime = this.priorUpdate2.timestamp;
				fromVal = this.priorUpdate2.data[valueindex];
				
				toTime = this.priorUpdate.timestamp;
				toVal = this.priorUpdate.data[valueindex];
				
				aheadTime = simTime;
				
				if (aheadTime > this.priorUpdate.timestamp + this.ro.extrapolateLimit)
					aheadTime = this.priorUpdate.timestamp + this.ro.extrapolateLimit;
				
				x = window.cr_unlerp(fromTime, toTime, aheadTime);
				
				return interpNetValue(netvalues[valueindex].interp, fromVal, toVal, x, true);
			}
			// No prior data before that: can only return priorUpdate
			else
				return this.priorUpdate.data[valueindex];
		}

		// Otherwise got both: interpolate
		fromTime = this.priorUpdate.timestamp;
		fromVal = this.priorUpdate.data[valueindex];
		
		toTime = this.nextUpdate.timestamp;
		toVal = this.nextUpdate.data[valueindex];
		
		x = window.cr_unlerp(fromTime, toTime, simTime);
		
		return interpNetValue(netvalues[valueindex].interp, fromVal, toVal, x, false);
	};
	
	function interpNetValue(interp, fromVal, toVal, x, extrapolating)
	{
		switch (interp) {
		case 0:					// INTERP_NONE
			return extrapolating ? toVal : fromVal;
		case 1:					// INTERP_LINEAR
			return window.cr_lerp(fromVal, toVal, x);
		case 2:					// INTERP_ANGULAR
			return window.cr_anglelerp(fromVal, toVal, x);
		default:
			return extrapolating ? toVal : fromVal;
		};
	};
	
	window["interpNetValue"] = interpNetValue;
	
	function RegisteredObject(mp_, obj_, sid_, bandwidth_)
	{
		this.mp = mp_;
		this.obj = obj_;
		this.sid = sid_;
		this.nid = this.mp.nextObjectNid++;
		this.bandwidth = bandwidth_;		// 0 = normal, 1 = low, 2 = very low
		this.userdata = {};
		this.instanceByteSize = 0;			// total byte size of all netvalues
		
		this.extrapolateLimit = 250;		// default max 250ms extrapolate ahead without data (for normal bandwidth mode)
		
		switch (this.bandwidth) {
		case 1:		// low bandwidth
			this.extrapolateLimit = 500;	// extrapolate up to 500ms ahead when low bandwidth mode (updates every 100ms)
			break;
		case 2:		// very low bandwidth
			this.extrapolateLimit = 2500;	// extrapolate up to 2500ms ahead in very low bandwidth mode (updates every 500ms)
			break;
		}
		
		this.netvalues = [];
		this.netinstances = [];
		
		// For server-side state tracking
		this.idToNetInst = {};
		this.usedNids = {};
		this.nextNid = 0;
		this.last_changed = 0;
		this.last_transmitted = 0;
		this.number_to_transmit = 0;
		
		this.hasOverriddenNids = false;
		
		// Host will broadcast destroy notifications for these net instance NIDs
		this.dead_nids = [];
		
		// For associating objects with peers: map of instance id-to-nid to force to use
		this.overrideNids = {};
		
		// For client-side interpolation
		this.nidToNetInst = {};
		this.simTime = 0;
		
		this.mp.registeredObjects.push(this);
		this.mp.objectsByNid[this.nid] = this;
	};
	
	RegisteredObject.prototype.addValue = function (interp, precision, tag, userdata, clientvaluetag_)
	{
		var nv = new NetValue(this.netvalues.length, interp, precision, tag, userdata, clientvaluetag_);
		
		switch (precision) {
		case 0:		// high, 8 byte double
			this.instanceByteSize += 8;
			break;
		case 1:		// normal, 4 byte float
			this.instanceByteSize += 4;
			break;
		case 2:		// low, 2 byte int16
			this.instanceByteSize += 2;
			break;
		case 3:		// very low, 1 byte uint8
			this.instanceByteSize += 1;
			break;
		}
		
		this.netvalues.push(nv);
	};
	
	RegisteredObject.prototype.addUpdate = function (timestamp_, instnid_, arr_)
	{
		var inst = this.getNetInstForNid(instnid_);
		
		inst.addUpdate(timestamp_, arr_);
	};
	
	RegisteredObject.prototype.tick = function ()
	{
		this.simTime = this.mp.getSimulationTime();
		
		var i, len;
		for (i = 0, len = this.netinstances.length; i < len; ++i)
		{
			this.netinstances[i].tick();
		}
	};
	
	RegisteredObject.prototype.getCount = function ()
	{
		return this.netinstances.length;
	};
	
	RegisteredObject.prototype.getNetInstAt = function (index)
	{
		return this.netinstances[index];
	};
	
	RegisteredObject.prototype.getNetValuesJson = function ()
	{
		var nv = [];
		var i, len, v, o;
		for (i = 0, len = this.netvalues.length; i < len; ++i)
		{
			v = this.netvalues[i];
			
			o = {
				"tag": v.tag,
				"precision": v.precision,
				"interp": v.interp,
				"clientvaluetag": v.clientvaluetag
			};
			
			if (typeof v.userdata !== "undefined")
				o["userdata"] = v.userdata;
			
			nv.push(o);
		}
		
		return nv;
	};
	
	RegisteredObject.prototype.setNetValuesFrom = function (nvs)
	{
		this.netvalues.length = 0;
		this.instanceByteSize = 0;
		
		var i, len, v;
		for (i = 0, len = nvs.length; i < len; ++i)
		{
			v = nvs[i];
			
			this.addValue(v["interp"], v["precision"], v["tag"], v["userdata"], v["clientvaluetag"]);
		}
	};
	
	RegisteredObject.prototype.getNetInstForNid = function (nid)
	{
		// Already know about this one: return the existing instance
		if (this.nidToNetInst.hasOwnProperty(nid))
			return this.nidToNetInst[nid];
		
		// Don't know about this NID yet: create a new net instance
		var ret = allocNetInstance(this, -1, nid);
		this.nidToNetInst[nid] = ret;
		this.netinstances.push(ret);
		return ret;
	};
	
	RegisteredObject.prototype.getNetInstForId = function (id)
	{
		// Already know about this one: return the existing instance
		if (this.idToNetInst.hasOwnProperty(id))
			return this.idToNetInst[id];
		
		// Don't know about this ID yet: create a new net instance
		var ret = allocNetInstance(this, id, this.allocateInstanceNid());
		this.idToNetInst[id] = ret;
		this.netinstances.push(ret);
		return ret;
	};
	
	RegisteredObject.prototype.allocateInstanceNid = function ()
	{
		this.nextNid++;
		
		// Keep NIDs small enough to fit in a uint16
		if (this.nextNid > 65535)
			this.nextNid = 0;
		
		// Skip over any used values to the next free value
		while (this.usedNids.hasOwnProperty(this.nextNid))
		{
			this.nextNid++;
			
			if (this.nextNid > 65535)
				this.nextNid = 0;
		}
		
		// We can now use this NID
		var nid = this.nextNid;
		this.usedNids[nid] = true;
		return nid;
	};
	
	RegisteredObject.prototype.removeNetInstance = function (netinst)
	{
		var id = netinst.id;
		var nid = netinst.nid;
		
		// If host, send a destroy notification for this instance if not associated with peers
		// (in which case the peer leave notification is used instead)
		if (this.mp.me === this.mp.host && !this.hasOverriddenNids)
			this.dead_nids.push(nid);
		
		if (this.idToNetInst.hasOwnProperty(id))
			delete this.idToNetInst[id];
		
		if (this.nidToNetInst.hasOwnProperty(nid))
			delete this.nidToNetInst[nid];
		
		if (this.usedNids.hasOwnProperty(nid))
			delete this.usedNids[nid];
		
		var i = this.netinstances.indexOf(netinst);
		
		if (i > -1)
			this.netinstances.splice(i, 1);
		
		freeNetInstance(netinst);
	};
	
	var toRemove = [];
	
	RegisteredObject.prototype.getData = function (count_, nowtime)
	{
		var i, len, id, inst;
		this.number_to_transmit = 0;
		
		// First mark all net instances dead
		for (i = 0, len = this.netinstances.length; i < len; ++i)
		{
			this.netinstances[i].alive = false;
		}
		
		// Now get data for all active objects, marking those that still exist as alive
		for (i = 0, len = count_; i < len; ++i)
		{
			id = this.mp.ongetobjectvalue(this.obj, i, null);
			inst = this.getNetInstForId(id);
			inst.alive = true;
			inst.getData(i, nowtime);			// increments number_to_transmit if wanting transmit
		}
		
		// Now sweep for dead instances and remove them
		for (i = 0, len = this.netinstances.length; i < len; ++i)
		{
			inst = this.netinstances[i];
			
			if (!inst.alive)
				toRemove.push(inst);
		}
		
		for (i = 0, len = toRemove.length; i < len; ++i)
		{
			this.removeNetInstance(toRemove[i]);
		}
		
		toRemove.length = 0;
	};
	
	RegisteredObject.prototype.writeData = function (dv, ptr, nowtime)
	{
		var i, len, inst;
		
		dv.setUint16(ptr, this.nid);						ptr += 2;
		
		var flags = 0;
		
		if (this.hasOverriddenNids)
			flags = 1;
		
		dv.setUint8(ptr, flags);							ptr += 1;
		
		dv.setUint16(ptr, this.number_to_transmit);			ptr += 2;
		dv.setUint16(ptr, this.instanceByteSize);			ptr += 2;
		
		for (i = 0, len = this.netinstances.length; i < len; ++i)
		{
			inst = this.netinstances[i];
			
			if (inst.transmit_me)
				ptr = inst.writeData(dv, ptr, nowtime);
		}
		
		return ptr;
	};
	
	RegisteredObject.prototype.overrideNid = function (id, nid)
	{
		if (this.idToNetInst.hasOwnProperty(id))
		{
			console.warn("overrideNid passed id " + id + " which is already in use and cannot be overridden");
			return;
		}
		
		if (this.usedNids[nid])
		{
			console.warn("overrideNid passed nid " + nid + " which is already in use and cannot be overridden");
			return;
		}
		
		// Don't know about this ID yet: create a new net instance
		var ret = allocNetInstance(this, id, nid);
		this.idToNetInst[id] = ret;
		this.usedNids[nid] = true;
		this.netinstances.push(ret);
		this.hasOverriddenNids = true;
		return ret;
	};
	
	RegisteredObject.prototype.removeObjectId = function (id)
	{
		if (this.idToNetInst.hasOwnProperty(id))
			this.removeNetInstance(this.idToNetInst[id]);
	};
	
	RegisteredObject.prototype.removeObjectNid = function (nid)
	{
		if (this.nidToNetInst.hasOwnProperty(nid))
			this.removeNetInstance(this.nidToNetInst[nid]);
	};
	
	// Expose to global namespace
	window["C2RegisteredObject"] = RegisteredObject;

})();