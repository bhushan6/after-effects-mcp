(function () {
  var socket = null, session = null, reconnectTimer = null, retries = 0;
  var portInput = document.getElementById('port'), secretInput = document.getElementById('secret');
  var status = document.getElementById('status'), details = document.getElementById('details');
  portInput.value = localStorage.getItem('aeBridgePort') || '';
  secretInput.value = localStorage.getItem('aeBridgeSecret') || '';
  document.getElementById('allow-edits').checked = localStorage.getItem('aeBridgeAllowEdits') === 'true';
  function show(message, extra) { status.textContent = message; details.textContent = extra || ''; }
  function host(method, params, callback) {
    var payload = JSON.stringify({ method:method, params:params || {} });
    var expression = 'Bridge.dispatch(' + JSON.stringify(payload) + ')';
    window.__adobe_cep__.evalScript(expression, function (raw) {
      try { callback(JSON.parse(raw)); }
      catch (e) { callback({ ok:false, error:{ code:'AE_UNRESPONSIVE', message:'Host returned no valid response: ' + String(raw).slice(0,120) } }); }
    });
  }
  // Re-evaluate host.jsx from disk so an updated install takes effect on every (re)connect without reloading the panel.
  function reloadHost(callback) {
    var root = decodeURI(window.__adobe_cep__.getSystemPath('extension')).replace(/^file:\/\//, '');
    window.__adobe_cep__.evalScript('$.evalFile(' + JSON.stringify(root + '/host.jsx') + ')', function () { callback(); });
  }
  function cancelReconnect() { if (reconnectTimer) clearTimeout(reconnectTimer); reconnectTimer = null; }
  // Retry with exponential backoff (1s doubling to 30s) while the bridge service restarts; settings come from storage.
  function scheduleReconnect(reason) {
    cancelReconnect();
    var delay = Math.min(30000, 1000 * Math.pow(2, Math.min(retries, 5)));
    retries++;
    show('Reconnecting in ' + Math.round(delay / 1000) + 's…', reason + '\nAttempt ' + retries + '. Press Disconnect to stop.');
    document.getElementById('disconnect').disabled = false;
    reconnectTimer = setTimeout(function () { reconnectTimer = null; connect(true); }, delay);
  }
  function connect(auto) {
    cancelReconnect();
    if (!auto) {
      retries = 0;
      localStorage.setItem('aeBridgePort', String(Number(portInput.value)));
      localStorage.setItem('aeBridgeSecret', secretInput.value.trim());
      localStorage.setItem('aeBridgeAllowEdits', String(document.getElementById('allow-edits').checked));
    }
    var port = Number(localStorage.getItem('aeBridgePort')), secret = localStorage.getItem('aeBridgeSecret') || '';
    var allowEdits = localStorage.getItem('aeBridgeAllowEdits') === 'true';
    if (!port || !secret) return show('Enter port and secret');
    localStorage.setItem('aeBridgeAutoConnect', 'true');
    if (socket) { var old = socket; socket = null; old.close(); }
    show(auto ? 'Reconnecting to local service…' : 'Connecting to local service…');
    var current = new WebSocket('ws://127.0.0.1:' + port + '/panel'), welcomed = false;
    socket = current;
    current.onopen = function () {
      reloadHost(function () { host('hello', {}, function (result) {
        if (current !== socket) return;
        if (!result.ok) { show('AE scripting unavailable', result.error.message); current.close(); return; }
        current.send(JSON.stringify({ type:'hello', secret:secret, protocolVersion:1, adapterVersion:'0.1.0-cep', aeVersion:result.value.aeVersion, os:navigator.platform, scope:allowEdits ? 'edit' : 'read', sessionNonce:String(Date.now()) + '-' + Math.random() }));
      }); });
    };
    current.onmessage = function (event) {
      if (current !== socket) return;
      var message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.type === 'welcome') {
        session = message.projectSessionId; welcomed = true; retries = 0;
        document.getElementById('disconnect').disabled = false;
        host('inspect', { id:'panel-context-' + Date.now(), params:{} }, function (result) {
          if (current !== socket) return;
          var comp = result.ok && result.value.activeComp ? result.value.activeComp.name : 'No active composition';
          show('Connected · ' + (allowEdits ? 'Edit' : 'Read only'), 'Session: ' + session + '\nComposition: ' + comp);
        });
      }
      if (message.type === 'command') {
        if (!session) return;
        show('Running ' + message.method, 'Request: ' + message.id);
        host(message.method, { id:message.id, params:message.params }, function (result) {
          if (current === socket && current.readyState === 1) current.send(JSON.stringify({ type:'result', id:message.id, ok:result.ok, value:result.value, error:result.error }));
          show(result.ok ? 'Connected' : 'AE command failed', result.ok ? 'Session: ' + session : result.error.message);
        });
      }
    };
    current.onerror = function () {};
    current.onclose = function (event) {
      if (current !== socket) return;
      socket = null; session = null;
      // 1008: the service rejected the secret; 1001: another panel took over. Retrying would not help in either case.
      if (event.code === 1008) { document.getElementById('disconnect').disabled = true; return show('Pairing rejected', 'Run npm run cli -- panel-config and check the port and secret'); }
      if (event.code === 1001) { document.getElementById('disconnect').disabled = true; return show('Disconnected', 'Another panel connected to the bridge'); }
      scheduleReconnect(welcomed ? 'Bridge service closed the connection' : 'Bridge service not reachable on port ' + port);
    };
  }
  document.getElementById('connect').onclick = function () { connect(false); };
  document.getElementById('disconnect').onclick = function () {
    cancelReconnect(); localStorage.setItem('aeBridgeAutoConnect', 'false');
    var old = socket; socket = null; session = null; if (old) old.close();
    this.disabled = true; show('Disconnected');
  };
  // Reopening the panel (or AE) resumes a connection the user did not end with Disconnect.
  if (localStorage.getItem('aeBridgeAutoConnect') === 'true' && portInput.value && secretInput.value) connect(true);
}());
