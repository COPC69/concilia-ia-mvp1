const XLSX = require('xlsx');

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isLikelyEmptyRow(row) {
  return !row || row.every(cell => String(cell ?? '').trim() === '');
}

function safeCell(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function looksLikeDateNoYear(value) {
  return /^\d{1,2}[\/-]\d{1,2}$/.test(String(value ?? '').trim());
}

function looksLikeDateWithYear(value) {
  return /^(\d{1,2}[\/-]\d{1,2}[\/-](19|20)\d{2})$|^((19|20)\d{2}[\/-]\d{1,2}[\/-]\d{1,2})$/.test(String(value ?? '').trim());
}

function looksLikeMoney(value) {
  const s = String(value ?? '').trim();
  if (!s) return false;
  if (/^#/.test(s)) return false;
  return /^-?\$?\s*[\d.,]+$/.test(s);
}

function keywordScore(row, role) {
  const text = normalizeText(row.join(' | '));
  let score = 0;
  const common = ['fecha', 'descripcion', 'detalle', 'valor', 'debito', 'debitos', 'credito', 'creditos', 'saldo', 'documento', 'comprobante', 'referencia'];
  for (const k of common) if (text.includes(k)) score += 1;
  if (role === 'bank') {
    for (const k of ['movimientos', 'saldo', 'oficina', 'canal', 'banco', 'abonos', 'cargos']) if (text.includes(k)) score += 1;
  }
  if (role === 'internal') {
    for (const k of ['tercero', 'nit', 'nuevo saldo', 'comprobante', 'cuenta']) if (text.includes(k)) score += 1;
  }
  return score;
}

function findHeaderRow(rows, role) {
  if (role === 'bank') {
    const limit = Math.min(rows.length, 100);
    for (let i = 0; i < limit; i++) {
      const rowText = normalizeText((rows[i] || []).join(' | '));
      if (
        rowText.includes('fecha') &&
        rowText.includes('descripcion') &&
        rowText.includes('valor') &&
        !rowText.includes('total abonos') &&
        !rowText.includes('total cargos') &&
        !rowText.includes('saldo anterior')
      ) {
        return i;
      }
    }
  }

  let best = { index: 0, score: -1 };
  const limit = Math.min(rows.length, 60);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    if (isLikelyEmptyRow(row)) continue;
    const text = normalizeText(row.join(' | '));
    if (role === 'bank' && /saldo anterior|total abonos|total cargos|resumen/.test(text)) continue;
    const score = keywordScore(row, role);
    if (score > best.score) best = { index: i, score };
  }
  return best.index;
}

function detectDefaultYear(rows) {
  for (const row of rows.slice(0, 120)) {
    for (const cell of row || []) {
      const text = String(cell ?? '');
      const match = text.match(/(20\d{2}|19\d{2})/);
      if (match) return Number(match[1]);
    }
  }
  return null;
}

function monthNameToNumber(text) {
  const t = normalizeText(text);
  const months = [
    ['enero', 'ene', 'jan', 'january'],
    ['febrero', 'feb', 'february'],
    ['marzo', 'mar', 'march'],
    ['abril', 'abr', 'apr', 'april'],
    ['mayo', 'may'],
    ['junio', 'jun', 'june'],
    ['julio', 'jul', 'july'],
    ['agosto', 'ago', 'aug', 'august'],
    ['septiembre', 'setiembre', 'sep', 'sept', 'september'],
    ['octubre', 'oct', 'october'],
    ['noviembre', 'nov', 'november'],
    ['diciembre', 'dic', 'dec', 'december']
  ];
  for (let i = 0; i < months.length; i++) {
    if (months[i].some(m => t.includes(m))) return i + 1;
  }
  return null;
}

function detectDefaultMonth(rows) {
  const votes = new Map();
  const add = (m, weight = 1) => {
    const n = Number(m);
    if (n >= 1 && n <= 12) votes.set(n, (votes.get(n) || 0) + weight);
  };

  for (const row of rows.slice(0, 140)) {
    for (const cell of row || []) {
      const text = String(cell ?? '').trim();
      if (!text) continue;

      const named = monthNameToNumber(text);
      if (named) add(named, 5);

      // yyyy/mm/dd o yyyy-mm-dd
      let m = text.match(/(?:19|20)\d{2}[-/](\d{1,2})[-/]\d{1,2}/);
      if (m) add(m[1], 3);

      // mm/dd/yyyy en exportaciones Excel de algunos auxiliares contables.
      m = text.match(/^(\d{1,2})[-/]\d{1,2}[-/](?:19|20)\d{2}$/);
      if (m) add(m[1], 1);
    }
  }

  if (!votes.size) return null;
  return [...votes.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

function isBankMovementHeader(row) {
  const text = normalizeText((row || []).join(' | '));
  return text.includes('fecha') && text.includes('descripcion') && text.includes('valor');
}

function isNonMovementBankRow(row) {
  const text = normalizeText((row || []).join(' | '));
  if (!text) return true;
  return /informacion cliente|informacion general|cliente\s*\||direccion|desde\s*\||hasta\s*\||tipo cuenta|resumen|saldo anterior|total abonos|total cargos|movimientos:|fin estado de cuenta/.test(text);
}

function sheetToStructuredRows(ws, sheetName, role) {
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false
  });

  const cleanedRows = rows.map(r => (r || []).map(safeCell));
  const defaultYear = detectDefaultYear(cleanedRows);
  const defaultMonth = detectDefaultMonth(cleanedRows);

  if (role === 'bank') {
    const headerIndex = findHeaderRow(cleanedRows, role);
    const headerRow = cleanedRows[headerIndex] || [];
    if (isBankMovementHeader(headerRow)) {
      const headers = headerRow.map((h, idx) => safeCell(h) || `Columna ${idx + 1}`);
      const dateIndex = headers.findIndex(h => normalizeText(h).includes('fecha'));
      const valueIndex = headers.findIndex(h => normalizeText(h) === 'valor' || normalizeText(h).includes('valor'));
      const dataRows = [];

      for (let idx = headerIndex + 1; idx < cleanedRows.length; idx++) {
        const row = cleanedRows[idx] || [];
        if (isLikelyEmptyRow(row)) continue;
        if (isBankMovementHeader(row)) continue;
        if (isNonMovementBankRow(row)) continue;

        // En extractos Bancolombia reales, un movimiento válido debe tener fecha y valor.
        // Esto evita leer encabezados de página, saldos y bloques informativos como movimientos,
        // sin perder pagos grandes como PAGO DE TERC NESTLE.
        const dateCell = row[dateIndex >= 0 ? dateIndex : 0];
        const valueCell = row[valueIndex >= 0 ? valueIndex : 4];
        if (!(looksLikeDateNoYear(dateCell) || looksLikeDateWithYear(dateCell))) continue;
        if (!looksLikeMoney(valueCell)) continue;

        const obj = { __rowNumber: idx + 1, __defaultYear: defaultYear, __defaultMonth: defaultMonth };
        headers.forEach((h, colIdx) => { obj[h] = row[colIdx] ?? ''; });
        dataRows.push(obj);
      }

      return {
        name: sheetName,
        rows: dataRows,
        headerRowIndex: headerIndex,
        headers,
        defaultYear,
        defaultMonth,
        preview: dataRows.slice(0, 5)
      };
    }
  }

  const headerRowIndex = findHeaderRow(cleanedRows, role);
  const headers = (cleanedRows[headerRowIndex] || []).map((h, idx) => {
    const clean = safeCell(h);
    return clean || `Columna ${idx + 1}`;
  });

  const dataRows = cleanedRows.slice(headerRowIndex + 1)
    .filter(r => !isLikelyEmptyRow(r))
    .map((row, rowIndex) => {
      const obj = { __rowNumber: headerRowIndex + 2 + rowIndex, __defaultYear: defaultYear, __defaultMonth: defaultMonth };
      headers.forEach((h, idx) => { obj[h] = row[idx] ?? ''; });
      return obj;
    });

  return {
    name: sheetName,
    rows: dataRows,
    headerRowIndex,
    headers,
    defaultYear,
    defaultMonth,
    preview: dataRows.slice(0, 5)
  };
}

function chooseSheet(sheets, role) {
  if (!sheets.length) throw new Error('El archivo no tiene hojas legibles.');

  const normalized = sheets.map((s, i) => ({
    ...s,
    index: i,
    n: normalizeText(s.name)
  }));

  if (role === 'bank') {
    const preferred = normalized.find(s => s.n.includes('extracto'))
      || normalized.find(s => s.n.includes('movimiento'))
      || normalized.find(s => s.n.includes('banco'));
    if (preferred) return sheets[preferred.index];
  }

  if (role === 'internal') {
    const preferred = normalized.find(s => s.n.includes('datos'))
      || normalized.find(s => s.n.includes('contai'))
      || normalized.find(s => s.n.includes('cuenta'))
      || normalized.find(s => s.n.includes('auxiliar'));
    if (preferred) return sheets[preferred.index];
  }

  const withMostRows = normalized.reduce((best, current) => {
    return current.rows.length > best.rows.length ? current : best;
  }, normalized[0]);
  return sheets[withMostRows.index];
}

function parseUploadedFile(file, { role = 'auto' } = {}) {
  const name = file.originalname || 'archivo';
  const lower = name.toLowerCase();
  let workbook;

  if (lower.endsWith('.csv')) {
    const content = file.buffer.toString('utf8');
    workbook = XLSX.read(content, { type: 'string', raw: false });
  } else if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')) {
    workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true, raw: false });
  } else {
    throw new Error('Formato no soportado. Sube Excel .xlsx/.xls o CSV.');
  }

  const sheets = workbook.SheetNames.map(name => {
    const ws = workbook.Sheets[name];
    return sheetToStructuredRows(ws, name, role);
  }).filter(s => s.rows.length > 0);

  const selectedSheet = chooseSheet(sheets, role);
  return {
    fileName: file.originalname,
    role,
    sheets,
    selectedSheet
  };
}

module.exports = { parseUploadedFile, normalizeText };
