const state = {
  apiBaseUrl: localStorage.getItem('concilia_api_url') || '',
  result: null,
  activeTab: 'inconsistencies'
};

const $ = (id) => document.getElementById(id);

const apiUrlInput = $('apiUrl');
const apiStatus = $('apiStatus');
const processStatus = $('processStatus');
const resultsSection = $('resultsSection');
const summaryGrid = $('summaryGrid');
const tabContent = $('tabContent');

apiUrlInput.value = state.apiBaseUrl;

function cleanApiUrl(url) {
  return String(url || '').trim().replace(/\/$/, '');
}

function setStatus(el, text, cls = 'muted') {
  el.className = `status ${cls}`;
  el.textContent = text;
}

function formatMoney(value) {
  const n = Number(value || 0);
  return n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 });
}

function formatDate(value) {
  return value || '—';
}

function downloadText(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

$('saveApiBtn').addEventListener('click', () => {
  const url = cleanApiUrl(apiUrlInput.value);
  state.apiBaseUrl = url;
  localStorage.setItem('concilia_api_url', url);
  setStatus(apiStatus, 'URL guardada.', 'ok');
});

$('testApiBtn').addEventListener('click', async () => {
  try {
    const url = cleanApiUrl(apiUrlInput.value);
    if (!url) throw new Error('Pega primero la URL de Render.');
    setStatus(apiStatus, 'Probando backend...', 'muted');
    const res = await fetch(`${url}/health`);
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error('El backend no respondió correctamente.');
    state.apiBaseUrl = url;
    localStorage.setItem('concilia_api_url', url);
    setStatus(apiStatus, `Backend conectado: ${data.timestamp}`, 'ok');
  } catch (err) {
    setStatus(apiStatus, `Error: ${err.message}`, 'error');
  }
});

$('internalFile').addEventListener('change', (e) => {
  $('internalFileName').textContent = e.target.files[0]?.name || 'Ningún archivo seleccionado';
});

$('bankFile').addEventListener('change', (e) => {
  $('bankFileName').textContent = e.target.files[0]?.name || 'Ningún archivo seleccionado';
});

$('resetBtn').addEventListener('click', () => {
  state.result = null;
  resultsSection.classList.add('hidden');
  setStatus(processStatus, 'Resultados limpiados.', 'muted');
});

$('reconcileBtn').addEventListener('click', async () => {
  try {
    const url = cleanApiUrl(apiUrlInput.value || state.apiBaseUrl);
    if (!url) throw new Error('Primero configura la URL del backend Render.');

    const bankFile = $('bankFile').files[0];
    const internalFile = $('internalFile').files[0];
    if (!bankFile) throw new Error('El extracto bancario es obligatorio.');

    const form = new FormData();
    form.append('bankFile', bankFile);
    if (internalFile) form.append('internalFile', internalFile);
    form.append('amountTolerance', $('amountTolerance').value || '2');
    form.append('daysWindow', $('daysWindow').value || '3');
    form.append('minProbableScore', $('minScore').value || '72');

    $('reconcileBtn').disabled = true;
    setStatus(processStatus, 'Procesando archivos y conciliando...', 'muted');

    const res = await fetch(`${url}/api/reconcile`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || 'Error procesando conciliación.');

    state.result = data;
    state.activeTab = 'inconsistencies';
    renderResults();
    setStatus(processStatus, 'Conciliación procesada correctamente.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(processStatus, `Error: ${err.message}`, 'error');
  } finally {
    $('reconcileBtn').disabled = false;
  }
});

function kpi(label, value) {
  return `<div class="kpi"><small>${label}</small><strong>${value}</strong></div>`;
}

function renderResults() {
  if (!state.result) return;
  const s = state.result.result.summary;
  resultsSection.classList.remove('hidden');

  const inconsistenciasCriticas = (s.bancoSinRegistroInterno ?? 0) + (s.registroInternoSinBanco ?? 0);
  const inconsistenciasRevision = inconsistenciasCriticas + (s.coincidenciasProbables ?? 0) + (s.gastosBancariosDetectados ?? s.bankExpenses ?? 0);

  summaryGrid.innerHTML = [
    kpi('Inconsistencias a revisar', inconsistenciasRevision),
    kpi('Banco sin registro interno', s.bancoSinRegistroInterno ?? 0),
    kpi('Interno sin banco', s.registroInternoSinBanco ?? 0),
    kpi('Coincidencias por aprobar', s.coincidenciasProbables ?? 0),
    kpi('Gastos bancarios detectados', s.gastosBancariosDetectados ?? s.bankExpenses ?? 0),
    kpi('Diferencia neta', formatMoney(s.diferenciaNeta ?? 0)),
    kpi('Conciliados exactos', s.conciliadosExactos ?? 0),
    kpi('% banco conciliado', `${s.porcentajeBancoConciliado ?? 0}%`),
    kpi('% interno conciliado', `${s.porcentajeInternoConciliado ?? 0}%`),
    kpi('Mov. banco', s.bankMovements ?? 0),
    kpi('Registros internos', s.internalMovements ?? 0),
    kpi('Neto banco', formatMoney(s.totalNetoBanco ?? 0)),
    kpi('Neto interno', formatMoney(s.totalNetoInterno ?? 0))
  ].join('');

  document.querySelectorAll('.tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });
  renderTab();
}

function badge(status) {
  let cls = 'warn';
  if (/exacto|conciliado/.test(status)) cls = 'good';
  if (/sin|diferencia|revision|bancario/.test(status)) cls = 'bad';
  return `<span class="badge-status ${cls}">${status.replaceAll('_', ' ')}</span>`;
}

function movementCells(m) {
  if (!m) return '<td>—</td><td>—</td><td>—</td><td>—</td>';
  return `
    <td>${formatDate(m.date)}</td>
    <td>${m.description || '—'}<br><small>${m.reference || ''}</small></td>
    <td>${m.type || '—'}</td>
    <td>${formatMoney(m.value)}</td>`;
}

function renderMatchTable(items) {
  if (!items.length) return '<p class="muted">No hay registros en esta categoría.</p>';
  return `
    <table>
      <thead>
        <tr>
          <th>Estado</th><th>Score</th>
          <th>Fecha banco</th><th>Descripción banco</th><th>Tipo banco</th><th>Valor banco</th>
          <th>Fecha interno</th><th>Descripción interno</th><th>Tipo interno</th><th>Valor interno</th>
          <th>Diferencia</th><th>Días</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(x => `
          <tr>
            <td>${badge(x.status)}</td><td>${x.score ?? '—'}</td>
            ${movementCells(x.bank)}
            ${movementCells(x.internal)}
            <td>${formatMoney(x.amountDiff || 0)}</td><td>${x.dateDiff ?? '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function buildInconsistencyRows() {
  if (!state.result) return [];
  const r = state.result.result;
  const rows = [];

  (r.bankOnly || [])
    .filter(x => x.status !== 'gasto_bancario_detectado')
    .forEach(x => rows.push({
      prioridad: 'Alta',
      tipo: 'Movimiento bancario sin registro interno',
      origen: 'Banco',
      movimiento: x.bank,
      accion: 'Revisar si falta contabilizar, si es personal, duplicado o si pertenece a otro periodo.'
    }));

  (r.internalOnly || []).forEach(x => rows.push({
    prioridad: 'Alta',
    tipo: 'Registro interno sin movimiento bancario',
    origen: 'Archivo interno',
    movimiento: x.internal,
    accion: 'Revisar si fue registrado en CONTAI pero no pasó por Bancolombia, si está en otra cuenta o si es error contable.'
  }));

  (r.probable || []).forEach(x => rows.push({
    prioridad: 'Media',
    tipo: 'Coincidencia probable por aprobar',
    origen: 'Banco + interno',
    movimiento: x.bank,
    interno: x.internal,
    score: x.score,
    accion: 'Aprobar o rechazar la coincidencia sugerida.'
  }));

  (r.bankExpenses || [])
    .filter(x => x.status === 'gasto_bancario_detectado')
    .forEach(x => rows.push({
      prioridad: 'Media',
      tipo: 'Gasto bancario detectado',
      origen: 'Banco',
      movimiento: x.bank,
      accion: 'Validar si debe registrarse como gasto bancario o si ya está agrupado en contabilidad.'
    }));

  const order = { Alta: 1, Media: 2, Baja: 3 };
  rows.sort((a, b) => (order[a.prioridad] || 9) - (order[b.prioridad] || 9));
  return rows;
}

function renderInconsistencies() {
  const rows = buildInconsistencyRows();
  if (!rows.length) {
    return '<div class="success-panel"><strong>No se encontraron inconsistencias pendientes.</strong><br>Los archivos quedaron conciliados según las reglas actuales.</div>';
  }

  return `
    <div class="priority-panel">
      <strong>Primero revisar estas inconsistencias.</strong><br>
      Esta es la bandeja principal de trabajo: movimientos del banco sin soporte interno, registros internos sin banco, coincidencias por aprobar y gastos bancarios detectados.
    </div>
    <table>
      <thead>
        <tr>
          <th>Prioridad</th><th>Tipo de inconsistencia</th><th>Origen</th><th>Fecha</th><th>Descripción</th><th>Valor</th><th>Acción sugerida</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(x => `
          <tr>
            <td><span class="priority ${x.prioridad.toLowerCase()}">${x.prioridad}</span></td>
            <td>${x.tipo}${x.score ? `<br><small>Score: ${x.score}</small>` : ''}</td>
            <td>${x.origen}</td>
            <td>${formatDate(x.movimiento?.date)}</td>
            <td>${x.movimiento?.description || '—'}${x.interno ? `<br><small>Interno sugerido: ${x.interno.description || '—'} · ${formatMoney(x.interno.value)}</small>` : ''}</td>
            <td>${formatMoney(x.movimiento?.value || 0)}</td>
            <td>${x.accion}</td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function renderDiagnostics() {
  if (!state.result) return '<p class="muted">No hay diagnóstico disponible.</p>';
  const s = state.result.result.summary || {};
  const d = state.result.result.diagnostics || {};
  const rows = [
    ['Ingresos banco', d.totalIngresosBanco ?? s.totalIngresosBanco],
    ['Egresos banco', d.totalEgresosBanco ?? s.totalEgresosBanco],
    ['Neto banco', d.totalNetoBanco ?? s.totalNetoBanco],
    ['Ingresos interno', d.totalIngresosInterno ?? s.totalIngresosInterno],
    ['Egresos interno', d.totalEgresosInterno ?? s.totalEgresosInterno],
    ['Neto interno', d.totalNetoInterno ?? s.totalNetoInterno],
    ['Diferencia neta', d.diferenciaNeta ?? s.diferenciaNeta],
    ['Gastos bancarios ingresos banco', d.gastosBancariosIngresosBanco],
    ['Gastos bancarios egresos banco', d.gastosBancariosEgresosBanco],
    ['Gastos bancarios neto banco', d.gastosBancariosNetoBanco ?? s.gastosBancariosNetoBanco]
  ].filter(([_, v]) => v !== undefined && v !== null);

  return `
    <div class="diagnostics-note">
      <strong>Lectura de control:</strong> estos totales sirven para validar si los dos archivos fueron interpretados correctamente antes de revisar movimientos uno a uno.
    </div>
    <table>
      <thead><tr><th>Concepto</th><th>Valor</th></tr></thead>
      <tbody>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${formatMoney(value)}</td></tr>`).join('')}</tbody>
    </table>`;
}

function renderSingleTable(items, source) {
  if (!items.length) return '<p class="muted">No hay registros en esta categoría.</p>';
  return `
    <table>
      <thead><tr><th>Estado</th><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Valor</th><th>Fila</th></tr></thead>
      <tbody>
        ${items.map(x => {
          const m = x[source];
          return `<tr><td>${badge(x.status)}</td>${movementCells(m)}<td>${m?.rowNumber || '—'}</td></tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderTab() {
  const r = state.result.result;
  const tab = state.activeTab;
  if (tab === 'inconsistencies') tabContent.innerHTML = renderInconsistencies();
  if (tab === 'matches') tabContent.innerHTML = renderMatchTable(r.matches || []);
  if (tab === 'probable') tabContent.innerHTML = renderMatchTable(r.probable || []);
  if (tab === 'bankOnly') tabContent.innerHTML = renderSingleTable(r.bankOnly || [], 'bank');
  if (tab === 'internalOnly') tabContent.innerHTML = renderSingleTable(r.internalOnly || [], 'internal');
  if (tab === 'bankExpenses') tabContent.innerHTML = renderSingleTable(r.bankExpenses || [], 'bank');
  if (tab === 'diagnostics') tabContent.innerHTML = renderDiagnostics();
}

document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    state.activeTab = btn.dataset.tab;
    renderResults();
  });
});

function csvEscape(v) {
  const s = String(v ?? '');
  if (/[";\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function flattenRows() {
  if (!state.result) return [];
  const r = state.result.result;
  const rows = [];
  const addMatch = (x) => rows.push({
    categoria: x.status,
    score: x.score ?? '',
    fecha_banco: x.bank?.date || '',
    descripcion_banco: x.bank?.description || '',
    tipo_banco: x.bank?.type || '',
    valor_banco: x.bank?.value || '',
    fecha_interno: x.internal?.date || '',
    descripcion_interno: x.internal?.description || '',
    tipo_interno: x.internal?.type || '',
    valor_interno: x.internal?.value || '',
    diferencia_valor: x.amountDiff || '',
    diferencia_dias: x.dateDiff ?? ''
  });
  (r.matches || []).forEach(addMatch);
  (r.probable || []).forEach(addMatch);
  (r.bankOnly || []).forEach(x => rows.push({ categoria: x.status, fecha_banco: x.bank?.date || '', descripcion_banco: x.bank?.description || '', tipo_banco: x.bank?.type || '', valor_banco: x.bank?.value || '' }));
  (r.internalOnly || []).forEach(x => rows.push({ categoria: x.status, fecha_interno: x.internal?.date || '', descripcion_interno: x.internal?.description || '', tipo_interno: x.internal?.type || '', valor_interno: x.internal?.value || '' }));
  (r.bankExpenses || []).forEach(x => rows.push({ categoria: x.status, fecha_banco: x.bank?.date || '', descripcion_banco: x.bank?.description || '', tipo_banco: x.bank?.type || '', valor_banco: x.bank?.value || '' }));
  return rows;
}

$('exportCsvBtn').addEventListener('click', () => {
  const rows = flattenRows();
  const headers = ['categoria','score','fecha_banco','descripcion_banco','tipo_banco','valor_banco','fecha_interno','descripcion_interno','tipo_interno','valor_interno','diferencia_valor','diferencia_dias'];
  const csv = [headers.join(';'), ...rows.map(r => headers.map(h => csvEscape(r[h])).join(';'))].join('\n');
  downloadText('concilia-ia-resultado.csv', csv, 'text/csv;charset=utf-8');
});

$('downloadJsonBtn').addEventListener('click', () => {
  if (!state.result) return;
  downloadText('concilia-ia-resultado.json', JSON.stringify(state.result, null, 2), 'application/json;charset=utf-8');
});
