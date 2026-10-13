const state = {
  apiBaseUrl: localStorage.getItem('concilia_api_url') || '',
  result: null,
  activeTab: 'matches'
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
    state.activeTab = 'matches';
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

  summaryGrid.innerHTML = [
    kpi('Modo', state.result.mode === 'conciliacion_completa' ? 'Completa' : 'Solo banco'),
    kpi('Mov. banco', s.bankMovements ?? 0),
    kpi('Registros internos', s.internalMovements ?? 0),
    kpi('Conciliados exactos', s.conciliadosExactos ?? 0),
    kpi('Probables', s.coincidenciasProbables ?? 0),
    kpi('Banco sin interno', s.bancoSinRegistroInterno ?? 0),
    kpi('Interno sin banco', s.registroInternoSinBanco ?? 0),
    kpi('Gastos bancarios', s.gastosBancariosDetectados ?? s.bankExpenses ?? 0),
    kpi('Neto banco', formatMoney(s.totalNetoBanco ?? 0)),
    kpi('Neto interno', formatMoney(s.totalNetoInterno ?? 0)),
    kpi('Diferencia neta', formatMoney(s.diferenciaNeta ?? 0)),
    kpi('% banco conciliado', `${s.porcentajeBancoConciliado ?? 0}%`)
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
  if (tab === 'matches') tabContent.innerHTML = renderMatchTable(r.matches || []);
  if (tab === 'probable') tabContent.innerHTML = renderMatchTable(r.probable || []);
  if (tab === 'bankOnly') tabContent.innerHTML = renderSingleTable(r.bankOnly || [], 'bank');
  if (tab === 'internalOnly') tabContent.innerHTML = renderSingleTable(r.internalOnly || [], 'internal');
  if (tab === 'bankExpenses') tabContent.innerHTML = renderSingleTable(r.bankExpenses || [], 'bank');
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
