# Concilia IA — MVP 1

Micro app para conciliar un archivo interno —CONTAI, Excel manual, FincaControl, ERP o CSV— contra un extracto bancario estructurado.

## Objetivo del MVP 1

- Subir archivo interno Excel/CSV opcional.
- Subir extracto bancario Excel/CSV obligatorio.
- Detectar hojas y columnas.
- Normalizar movimientos a: fecha, descripción, valor, tipo, referencia.
- Conciliar por valor, fecha y tipo.
- Separar coincidencias exactas, probables, banco sin registro interno, interno sin banco y gastos bancarios.
- Exportar CSV o JSON.

## Estructura

```text
concilia-ia-mvp1/
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── backend/
    ├── server.js
    ├── package.json
    ├── .env.example
    ├── routes/
    │   └── reconcile.js
    └── services/
        ├── fileReader.js
        ├── columnMapper.js
        ├── normalizer.js
        └── reconciler.js
```

## Deploy en Render

Crear Web Service conectado al repositorio.

Configuración:

```text
Root Directory: backend
Build Command: npm install
Start Command: npm start
```

Variables:

```env
PORT=10000
ALLOWED_ORIGIN=*
MAX_UPLOAD_MB=30
DEFAULT_AMOUNT_TOLERANCE=2
DEFAULT_DAYS_WINDOW=3
MIN_PROBABLE_SCORE=72
```

Prueba:

```text
https://tu-api.onrender.com/health
```

## Deploy en Netlify

Configuración:

```text
Base directory: /
Build command: vacío
Publish directory: frontend
```

Luego, en la página, pegar la URL de Render en el campo de backend.

## Uso recomendado

1. Subir archivo interno: CONTAI, Excel manual, archivo FincaControl o CSV.
2. Subir extracto Bancolombia o extracto estructurado Excel/CSV.
3. Ajustar tolerancia de valor y ventana de días si hace falta.
4. Procesar conciliación.
5. Revisar exactos, probables y diferencias.
6. Exportar CSV.

## Limitaciones MVP 1

- No procesa PDF.
- No usa OCR.
- No guarda historial.
- No tiene login.
- No usa IA todavía.
- La conciliación probable requiere revisión humana.

## Próximos hitos

- Mapeo manual de columnas cuando la detección automática falle.
- Exportar Excel con hojas separadas.
- Guardar historial por cliente/empresa.
- Soporte PDF/OCR.
- IA para entender descripciones difíciles.
