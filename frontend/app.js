const DEFAULT_API_BASE_URL = 'https://concilia-ia-api.onrender.com';

const state = {
  apiBaseUrl: localStorage.getItem('concilia_api_url') || DEFAULT_API_BASE_URL,
  result: null,
  activeTab: 'reviewFirst'
};

const $ = (id) => document.getElementById(id);

const apiUrlInput = $('apiUrl');
const apiStatus = $('apiStatus');
const processStatus = $('processStatus');
const resultsSection = $('resultsSection');
const summaryGrid = $('summaryGrid');
const tabContent = $('tabContent');
const resultMessage = $('resultMessage');

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

function getAmountTolerance() {
  return Number($('amountTolerance')?.value || 2);
}

function getCriticalThreshold() {
  return Number($('criticalThreshold')?.value || 1000000);
}

$('saveApiBtn').addEventListener('click', () => {
  const url = cleanApiUrl(apiUrlInput.value);
  state.apiBaseUrl = url || DEFAULT_API_BASE_URL;
  localStorage.setItem('concilia_api_url', state.apiBaseUrl);
  setStatus(apiStatus, 'URL guardada.', 'ok');
});

$('testApiBtn').addEventListener('click', async () => {
  try {
    const url = cleanApiUrl(apiUrlInput.value || state.apiBaseUrl);
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
    const url = cleanApiUrl(state.apiBaseUrl || apiUrlInput.value || DEFAULT_API_BASE_URL);
    if (!url) throw new Error('No hay URL de backend configurada.');

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
    state.activeTab = 'reviewFirst';
    renderResults();
    setStatus(processStatus, 'Conciliación procesada correctamente.', 'ok');
  } catch (err) {
    console.error(err);
    setStatus(processStatus, `Error: ${err.message}`, 'error');
  } finally {
    $('reconcileBtn').disabled = false;
  }
});

function kpi(label, value, variant = '') {
  return `<div class="kpi ${variant}"><small>${label}</small><strong>${value}</strong></div>`;
}

function getMovementValue(m) {
  return Math.abs(Number(m?.value || 0));
}

function isBankExpenseItem(x) {
  return x?.status === 'gasto_bancario_detectado';
}

function getResultParts() {
  const r = state.result?.result || {};
  const threshold = getCriticalThreshold();
  const bankOnly = (r.bankOnly || []).filter(x => !isBankExpenseItem(x));
  const internalOnly = r.internalOnly || [];

  const criticalBank = bankOnly.filter(x => getMovementValue(x.bank) >= threshold);
  const criticalInternal = internalOnly.filter(x => getMovementValue(x.internal) >= threshold);
  const minorBank = bankOnly.filter(x => getMovementValue(x.bank) < threshold);
  const minorInternal = internalOnly.filter(x => getMovementValue(x.internal) < threshold);

  return {
    criticalBank,
    criticalInternal,
    critical: [...criticalBank, ...criticalInternal],
    minorBank,
    minorInternal,
    minor: [...minorBank, ...minorInternal],
    probable: r.probable || [],
    bankExpenses: r.bankExpenses || [],
    matches: r.matches || []
  };
}

function getCloseStatus(summary) {
  const diff = Number(summary.diferenciaNeta || 0);
  const tolerance = getAmountTolerance();
  return {
    netOk: Math.abs(diff) <= Math.max(tolerance, 2),
    diff
  };
}

function renderResults() {
  if (!state.result) return;
  const s = state.result.result.summary;
  const parts = getResultParts();
  const close = getCloseStatus(s);
  resultsSection.classList.remove('hidden');

  resultMessage.innerHTML = close.netOk
    ? `<div class="success-panel"><strong>Cierre neto cuadrado.</strong><br>La diferencia neta es ${formatMoney(close.diff)}. No debes revisar todo: empieza por las partidas de alto valor en “Revisar primero”.</div>`
    : `<div class="priority-panel"><strong>Atención: diferencia neta significativa.</strong><br>La diferencia neta es ${formatMoney(close.diff)}. Revisa primero las partidas críticas y el diagnóstico de lectura.</div>`;

  summaryGrid.innerHTML = [
    kpi('Estado del cierre', close.netOk ? 'Neto cuadrado' : 'Con diferencia', close.netOk ? 'good-kpi' : 'bad-kpi'),
    kpi('Diferencia neta', formatMoney(s.diferenciaNeta ?? 0), close.netOk ? 'good-kpi' : 'bad-kpi'),
    kpi('Revisar primero', parts.critical.length, parts.critical.length ? 'bad-kpi' : 'good-kpi'),
    kpi('Confirmar sugerencias', parts.probable.length),
    kpi('Pendientes menores', parts.minor.length),
    kpi('Gastos bancarios informativos', parts.bankExpenses.length),
    kpi('Conciliados automáticos', s.conciliadosExactos ?? 0, 'good-kpi'),
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
  if (/sin|diferencia|revision/.test(status)) cls = 'bad';
  if (/bancario/.test(status)) cls = 'info';
  return `<span class="badge-status ${cls}">${String(status || '').replaceAll('_', ' ')}</span>`;
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
  if (!items.length) return '<p class="muted empty-state">No hay registros en esta categoría.</p>';
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

function priorityTag(label) {
  return `<span class="priority ${label.toLowerCase()}">${label}</span>`;
}

function renderReviewRows(rows, title, note) {
  if (!rows.length) {
    return `<div class="success-panel"><strong>${title}</strong><br>No hay partidas en esta categoría.</div>`;
  }
  return `
    <div class="priority-panel">
      <strong>${title}</strong><br>${note}
    </div>
    <table>
      <thead>
        <tr>
          <th>Prioridad</th><th>Tipo</th><th>Origen</th><th>Fecha</th><th>Descripción</th><th>Valor</th><th>Acción sugerida</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(x => `
          <tr>
            <td>${priorityTag(x.prioridad)}</td>
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

function buildCriticalRows() {
  const rows = [];
  const parts = getResultParts();

  parts.criticalBank.forEach(x => rows.push({
    prioridad: 'Alta',
    tipo: 'Banco sin registro interno',
    origen: 'Banco',
    movimiento: x.bank,
    accion: 'Revisar solo si no aparece una coincidencia sugerida. Si existe un registro interno del mismo valor y fecha equivalente, aprobarlo; la descripción del banco puede ser genérica.'
  }));

  parts.criticalInternal.forEach(x => rows.push({
    prioridad: 'Alta',
    tipo: 'Interno sin movimiento bancario',
    origen: 'Archivo interno',
    movimiento: x.internal,
    accion: 'Revisar solo si no aparece un movimiento bancario equivalente. Si el valor coincide y la fecha está invertida por formato, aprobar la sugerencia.'
  }));

  rows.sort((a, b) => getMovementValue(b.movimiento) - getMovementValue(a.movimiento));
  return rows;
}

function buildMinorRows() {
  const rows = [];
  const parts = getResultParts();

  parts.minorBank.forEach(x => rows.push({
    prioridad: 'Baja',
    tipo: 'Banco sin registro interno menor',
    origen: 'Banco',
    movimiento: x.bank,
    accion: 'Revisar después de las partidas críticas. Puede ser agrupación, gasto menor o movimiento de bajo impacto.'
  }));

  parts.minorInternal.forEach(x => rows.push({
    prioridad: 'Baja',
    tipo: 'Interno sin banco menor',
    origen: 'Archivo interno',
    movimiento: x.internal,
    accion: 'Revisar después de las partidas críticas. Puede estar agrupado, redondeado o en otra cuenta.'
  }));

  rows.sort((a, b) => getMovementValue(b.movimiento) - getMovementValue(a.movimiento));
  return rows;
}

function buildConfirmRows() {
  return getResultParts().probable.map(x => ({
    prioridad: 'Media',
    tipo: 'Coincidencia probable por aprobar',
    origen: 'Banco + interno',
    movimiento: x.bank,
    interno: x.internal,
    score: x.score,
    accion: 'Aprobar si corresponde al mismo movimiento. Si no, rechazar y revisar por separado.'
  }));
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
      <strong>Lectura de control:</strong> estos totales validan si ambos archivos fueron interpretados correctamente antes de revisar movimiento por movimiento.
    </div>
    <table>
      <thead><tr><th>Concepto</th><th>Valor</th></tr></thead>
      <tbody>${rows.map(([label, value]) => `<tr><td>${label}</td><td>${formatMoney(value)}</td></tr>`).join('')}</tbody>
    </table>`;
}

function renderSingleTable(items, source, mode = 'default') {
  if (!items.length) return '<p class="muted empty-state">No hay registros en esta categoría.</p>';
  return `
    <table>
      <thead><tr><th>Estado</th><th>Fecha</th><th>Descripción</th><th>Tipo</th><th>Valor</th><th>Fila</th><th>Nota</th></tr></thead>
      <tbody>
        ${items.map(x => {
          const m = x[source];
          const note = mode === 'expenses'
            ? 'Gasto propio del uso de la cuenta. Validar si ya está registrado o agrupado en contabilidad.'
            : '';
          return `<tr><td>${badge(x.status)}</td>${movementCells(m)}<td>${m?.rowNumber || '—'}</td><td>${note}</td></tr>`;
        }).join('')}
      </tbody>
    </table>`;
}

function renderTab() {
  const r = state.result.result;
  const tab = state.activeTab;
  if (tab === 'reviewFirst') tabContent.innerHTML = renderReviewRows(
    buildCriticalRows(),
    'Revisar primero: partidas de alto valor o alto impacto.',
    'Esta es la lista prioritaria. La idea es que la secretaria no revise todo, sino que empiece por lo que puede afectar el cierre.'
  );
  if (tab === 'confirm') tabContent.innerHTML = renderReviewRows(
    buildConfirmRows(),
    'Confirmar sugerencias de conciliación.',
    'La app encontró movimientos que probablemente son el mismo registro aunque la descripción sea distinta o la fecha venga en formato diferente. Solo requieren aprobar o rechazar.'
  );
  if (tab === 'minor') tabContent.innerHTML = renderReviewRows(
    buildMinorRows(),
    'Pendientes menores o agrupables.',
    'No son la primera prioridad. Revisar después de las partidas críticas.'
  );
  if (tab === 'matches') tabContent.innerHTML = renderMatchTable(r.matches || []);
  if (tab === 'bankExpenses') tabContent.innerHTML = renderSingleTable(r.bankExpenses || [], 'bank', 'expenses');
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
