(function () {
  var socket = null, session = null, reconnectTimer = null;
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
  function connect() {
    var port = Number(portInput.value), secret = secretInput.value.trim();
    if (!port || !secret) return show('Enter port and secret');
    localStorage.setItem('aeBridgePort', String(port)); localStorage.setItem('aeBridgeSecret', secret);
    var allowEdits = document.getElementById('allow-edits').checked;
    localStorage.setItem('aeBridgeAllowEdits', String(allowEdits));
    if (socket) socket.close();
    show('Connecting to local service…');
    var current = new WebSocket('ws://127.0.0.1:' + port + '/panel');
    socket = current;
    current.onopen = function () {
      host('hello', {}, function (result) {
        if (current !== socket) return;
        if (!result.ok) { show('AE scripting unavailable', result.error.message); current.close(); return; }
        current.send(JSON.stringify({ type:'hello', secret:secret, protocolVersion:1, adapterVersion:'0.1.0-cep', aeVersion:result.value.aeVersion, os:navigator.platform, scope:allowEdits ? 'edit' : 'read', sessionNonce:String(Date.now()) + '-' + Math.random() }));
      });
    };
    current.onmessage = function (event) {
      if (current !== socket) return;
      var message;
      try { message = JSON.parse(event.data); } catch (_) { return; }
      if (message.type === 'welcome') {
        session = message.projectSessionId;
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
    current.onerror = function () { if (current === socket) show('Connection error', 'Check the port and bridge service'); };
    current.onclose = function () { if (current !== socket) return; session = null; document.getElementById('disconnect').disabled = true; show('Disconnected'); };
  }
  document.getElementById('connect').onclick = connect;
  document.getElementById('disconnect').onclick = function () { if (socket) socket.close(); socket = null; session = null; this.disabled = true; show('Disconnected'); };
}());
