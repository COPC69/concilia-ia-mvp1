const express = require('express');
const multer = require('multer');
const { parseUploadedFile } = require('../services/fileReader');
const { normalizeDataset } = require('../services/normalizer');
const { reconcile } = require('../services/reconciler');

const router = express.Router();
const maxMb = Number(process.env.MAX_UPLOAD_MB || 30);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: maxMb * 1024 * 1024 }
});

router.post('/inspect', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ ok: false, error: 'Debes subir un archivo.' });
    }
    const parsed = parseUploadedFile(req.file, { role: req.body.role || 'auto' });
    res.json({
      ok: true,
      fileName: req.file.originalname,
      sheets: parsed.sheets.map(s => ({
        name: s.name,
        rows: s.rows.length,
        headerRowIndex: s.headerRowIndex,
        headers: s.headers,
        preview: s.preview
      }))
    });
  } catch (err) {
    next(err);
  }
});

router.post('/reconcile', upload.fields([
  { name: 'bankFile', maxCount: 1 },
  { name: 'internalFile', maxCount: 1 }
]), async (req, res, next) => {
  try {
    const bankUpload = req.files?.bankFile?.[0];
    const internalUpload = req.files?.internalFile?.[0];

    if (!bankUpload) {
      return res.status(400).json({ ok: false, error: 'El extracto bancario es obligatorio.' });
    }

    const amountTolerance = Number(req.body.amountTolerance || process.env.DEFAULT_AMOUNT_TOLERANCE || 2);
    const daysWindow = Number(req.body.daysWindow || process.env.DEFAULT_DAYS_WINDOW || 3);
    const minProbableScore = Number(req.body.minProbableScore || process.env.MIN_PROBABLE_SCORE || 72);

    const bankParsed = parseUploadedFile(bankUpload, { role: 'bank' });
    const bankNormalized = normalizeDataset(bankParsed, { role: 'bank' });

    let internalNormalized = null;
    let internalParsed = null;
    if (internalUpload) {
      internalParsed = parseUploadedFile(internalUpload, { role: 'internal' });
      internalNormalized = normalizeDataset(internalParsed, { role: 'internal' });
    }

    const result = reconcile({
      bank: bankNormalized,
      internal: internalNormalized,
      options: { amountTolerance, daysWindow, minProbableScore }
    });

    res.json({
      ok: true,
      mode: internalNormalized ? 'conciliacion_completa' : 'analisis_extracto',
      files: {
        bank: {
          fileName: bankUpload.originalname,
          sheet: bankNormalized.sheetName,
          headers: bankNormalized.headers,
          totalRowsRead: bankNormalized.totalRowsRead,
          movements: bankNormalized.movements.length
        },
        internal: internalNormalized ? {
          fileName: internalUpload.originalname,
          sheet: internalNormalized.sheetName,
          headers: internalNormalized.headers,
          totalRowsRead: internalNormalized.totalRowsRead,
          movements: internalNormalized.movements.length
        } : null
      },
      result
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
