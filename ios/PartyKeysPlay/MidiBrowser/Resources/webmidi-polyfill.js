(function () {
  'use strict';
  if (navigator.requestMIDIAccess) return;
  var handler = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.midiBridge;
  if (!handler) return;

  var pending = Object.create(null);
  var nextId = 1;

  function post(cmd, payload) {
    var id = nextId++;
    return new Promise(function (resolve, reject) {
      pending[id] = { resolve: resolve, reject: reject };
      handler.postMessage({ id: id, cmd: cmd, payload: payload || {} });
    });
  }

  // Bridges the gap between spec iteration and older runtimes.
  function MidiMessageEvent(data, timestamp) {
    this.data = data;            // Uint8Array per spec; we use a plain Array for portability
    this.receivedTime = timestamp;
    this.timeStamp = timestamp;
    this.type = 'midimessage';
  }
  MidiMessageEvent.prototype.data = null;
  MidiMessageEvent.prototype.receivedTime = 0;
  MidiMessageEvent.prototype.bubbles = false;
  MidiMessageEvent.prototype.cancelable = false;

  function PortMap(ports) {
    this._ports = ports || {};
  }
  PortMap.prototype.size = function () { return Object.keys(this._ports).length; };
  PortMap.prototype.keys = function () { return Object.keys(this._ports)[Symbol.iterator](); };
  PortMap.prototype.entries = function () {
    var arr = this; var ks = Object.keys(arr._ports);
    var i = 0;
    return (function* () { for (; i < ks.length; i++) yield [ks[i], arr._ports[ks[i]]]; })();
  };
  PortMap.prototype.values = function () {
    var self = this; var ks = Object.keys(self._ports); var i = 0;
    return (function* () { for (; i < ks.length; i++) yield self._ports[ks[i]]; })();
  };
  PortMap.prototype.get = function (id) { return this._ports[id] || null; };
  PortMap.prototype.has = function (id) { return id in this._ports; };
  PortMap.prototype.forEach = function (fn) { for (var k in this._ports) fn(this._ports[k], k, this); };

  function makePort(info, type) {
    return {
      id: info.id,
      name: info.name,
      manufacturer: info.manufacturer,
      version: info.version,
      type: type,
      state: info.state || 'connected',
      connection: 'closed',
      onstatechange: null,
      onmidimessage: null
    };
  }

  var access = {
    sysexEnabled: false,
    inputs: new PortMap({}),
    outputs: new PortMap({}),
    onstatechange: null
  };

  function rebuildMaps(snapshot) {
    var newInputs = {}; var newOutputs = {};
    (snapshot.inputs || []).forEach(function (i) { newInputs[i.id] = access.inputs.get(i.id) || makePort(i, 'input'); });
    (snapshot.outputs || []).forEach(function (o) { newOutputs[o.id] = access.outputs.get(o.id) || makePort(o, 'output'); });
    access.inputs = new PortMap(newInputs);
    access.outputs = new PortMap(newOutputs);
    if (access.onstatechange) access.onstatechange({ type: 'statechange', port: null });
  }

  window.__webMIDIBridge = {
    _resolve: function (msg) {
      var p = pending[msg.id]; if (!p) return; delete pending[msg.id];
      msg.ok ? p.resolve(msg.payload) : p.reject(msg.payload);
    },
    _deliverInput: function (entries) {
      entries.forEach(function (e) {
        var port = access.inputs.get(e.id);
        if (!port || !port.onmidimessage) return;
        port.onmidimessage(new MidiMessageEvent(e.data, e.time));
      });
    },
    _statechange: function (snapshot) {
      rebuildMaps(snapshot);
    },
    // DIAG: expose polyfill state so native can log what the page actually holds.
    _debug: function () {
      return {
        inputs: access.inputs.size(),
        outputs: access.outputs.size(),
        inputIds: Array.from(access.inputs.keys()),
        inputNames: access.inputs.values() ? Array.from(access.inputs.values()).map(function (p) { return p.name; }) : []
      };
    }
  };

  navigator.requestMIDIAccess = function (options) {
    options = options || {};
    return post('access', { sysex: !!options.sysex }).then(function (snapshot) {
      access.sysexEnabled = !!options.sysex;
      rebuildMaps(snapshot);
      return access;
    });
  };

  // Wire output send on outputs created lazily after access resolves.
  // ponytail: patch send/open/close onto every port the first time rebuild touches it;
  // simpler than a Proxy and enough for the spec surface we support.
  var origRebuild = rebuildMaps;
  rebuildMaps = function (snapshot) {
    origRebuild(snapshot);
    access.outputs.forEach(function (port) {
      if (port.send) return;
      port.send = function (data, timestamp) {
        var bytes = data instanceof Uint8Array ? Array.from(data) : Array.prototype.slice.call(data);
        post('send', { portId: port.id, data: bytes, timestamp: timestamp || 0 });
      };
      port.open = function () { post('open', { portId: port.id }); return Promise.resolve(port); };
      port.close = function () { post('close', { portId: port.id }); return Promise.resolve(port); };
    });
    access.inputs.forEach(function (port) {
      if (port._wired) return;
      port._wired = true;
      port.open = function () { post('open', { portId: port.id }); return Promise.resolve(port); };
      port.close = function () { post('close', { portId: port.id }); return Promise.resolve(port); };
    });
  };
})();
