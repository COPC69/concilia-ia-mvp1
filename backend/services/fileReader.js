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

function keywordScore(row, role) {
  const text = normalizeText(row.join(' | '));
  let score = 0;
  const common = ['fecha', 'descripcion', 'detalle', 'valor', 'debito', 'debitos', 'credito', 'creditos', 'saldo', 'documento', 'comprobante', 'referencia'];
  for (const k of common) if (text.includes(k)) score += 1;
  if (role === 'bank') {
    for (const k of ['saldo', 'oficina', 'canal', 'banco', 'abonos', 'cargos']) if (text.includes(k)) score += 1;
  }
  if (role === 'internal') {
    for (const k of ['tercero', 'nit', 'nuevo saldo', 'comprobante', 'cuenta']) if (text.includes(k)) score += 1;
  }
  return score;
}

function findHeaderRow(rows, role) {
  let best = { index: 0, score: -1 };
  const limit = Math.min(rows.length, 40);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    if (isLikelyEmptyRow(row)) continue;
    const score = keywordScore(row, role);
    if (score > best.score) best = { index: i, score };
  }
  return best.index;
}

function safeCell(value) {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function sheetToStructuredRows(ws, sheetName, role) {
  const rows = XLSX.utils.sheet_to_json(ws, {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false
  });

  const cleanedRows = rows.map(r => (r || []).map(safeCell));
  const headerRowIndex = findHeaderRow(cleanedRows, role);
  const headers = (cleanedRows[headerRowIndex] || []).map((h, idx) => {
    const clean = safeCell(h);
    return clean || `Columna ${idx + 1}`;
  });

  const dataRows = cleanedRows.slice(headerRowIndex + 1)
    .filter(r => !isLikelyEmptyRow(r))
    .map((row, rowIndex) => {
      const obj = { __rowNumber: headerRowIndex + 2 + rowIndex };
      headers.forEach((h, idx) => { obj[h] = row[idx] ?? ''; });
      return obj;
    });

  return {
    name: sheetName,
    rows: dataRows,
    headerRowIndex,
    headers,
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
