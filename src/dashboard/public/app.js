/* Dashboard de WebMCPcss: sondea /api/state cada 2 s y pinta la UI. */
/* global document, fetch, setInterval */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  function esc(s) {
    var div = document.createElement('div');
    div.textContent = s == null ? '' : String(s);
    return div.innerHTML;
  }

  function renderStats(stats) {
    $('stat-exec').textContent = stats.executions.total;
    $('stat-exec-detail').textContent =
      stats.executions.ok + ' ✔ · ' + stats.executions.failed + ' ✖';
    $('stat-repair').textContent = stats.repairs.total;
    $('stat-repair-detail').textContent =
      stats.repairs.ok + ' ✔ · ' + stats.repairs.failed + ' ✖';
    $('stat-validate').textContent = stats.validations.total;
    $('stat-validate-detail').textContent =
      stats.validations.ok + ' ✔ · ' + stats.validations.failed + ' ✖';
  }

  function renderTools(toolMap, cssPath) {
    var tbody = $('tools-table').querySelector('tbody');
    tbody.innerHTML = '';
    var names = toolMap ? Object.keys(toolMap.tools) : [];
    $('stat-tools').textContent = names.length;
    $('stat-css').textContent = cssPath || '';
    $('tools-empty').hidden = names.length > 0;
    names.forEach(function (name) {
      var t = toolMap.tools[name];
      var trigger = t.trigger ? t.trigger.event + (t.trigger.selector ? ' on ' + t.trigger.selector : '') : 'click';
      var row = document.createElement('tr');
      row.innerHTML =
        '<td><strong>' + esc(name) + '</strong><br><small>' + esc(t.description || '') + '</small></td>' +
        '<td><span class="selector">' + esc(t.selector) + '</span></td>' +
        '<td>' + esc(Object.keys(t.params).join(', ') || '—') + '</td>' +
        '<td><span class="badge type">' + esc(trigger) + '</span></td>';
      tbody.appendChild(row);
    });
  }

  function renderHistory(history) {
    var tbody = $('history-table').querySelector('tbody');
    tbody.innerHTML = '';
    $('history-empty').hidden = history.length > 0;
    history.forEach(function (e) {
      var row = document.createElement('tr');
      row.innerHTML =
        '<td>' + esc(new Date(e.ts).toLocaleTimeString()) + '</td>' +
        '<td><span class="badge type">' + esc(e.type) + '</span></td>' +
        '<td>' + esc(e.tool || e.url || '—') + '</td>' +
        '<td><span class="badge ' + (e.ok ? 'ok">✔ ok' : 'bad">✖ fallo') + '</span></td>' +
        '<td><small>' + esc(e.details ? JSON.stringify(e.details) : '') + '</small></td>';
      tbody.appendChild(row);
    });
  }

  function refresh() {
    fetch('/api/state')
      .then(function (r) { return r.json(); })
      .then(function (state) {
        renderStats(state.stats);
        renderTools(state.toolMap, state.cssPath);
        renderHistory(state.history);
        $('meta').textContent = state.parseError
          ? '⚠ ' + state.parseError
          : state.cssPath
            ? state.cssPath
            : 'sin CSS cargado';
        $('last-update').textContent = new Date(state.now).toLocaleTimeString();
      })
      .catch(function () {
        $('meta').textContent = '⚠ sin conexión con el servidor';
      });
  }

  refresh();
  setInterval(refresh, 2000);
})();
