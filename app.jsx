// Survey Analyzer — main app
const { useState, useEffect, useMemo, useRef, useCallback } = React;

// ============ Likert mapping ============
const LIKERT_MAP = {
  'أوافق بشدة': 5,
  'strongly agree': 5,
  'أوافق': 4,
  'agree': 4,
  'أوافق إلى حد ما': 3,
  'somewhat agree': 3,
  'neutral': 3,
  'محايد': 3,
  'لا أوافق': 2,
  'disagree': 2,
  'لا أوافق إطلاقاً': 1,
  'لا أوافق إطلاقا': 1,
  'strongly disagree': 1,
  'لا أعلم': null,
  "don't know": null,
  'do not know': null,
  'n/a': null,
};

function _normalizeArabicLikert(s) {
  return String(s)
    // strip Arabic diacritics (tashkeel) — fatha, damma, kasra, tanwin, shadda, sukun, dagger alef
    .replace(/[\u064B-\u0652\u0670]/g, '')
    // strip tatweel kashida
    .replace(/\u0640/g, '')
    // normalize alef variants
    .replace(/[\u0622\u0623\u0625]/g, '\u0627') // آ أ إ → ا
    // normalize ya / alef maksura
    .replace(/\u0649/g, '\u064A') // ى → ي
    // normalize ta marbuta
    .replace(/\u0629/g, '\u0647') // ة → ه
    // collapse whitespace
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Pre-build a normalized lookup so order-insensitive Arabic variations all map to the same score
const LIKERT_MAP_NORM = (() => {
  const out = {};
  for (const k of Object.keys(LIKERT_MAP)) {
    out[_normalizeArabicLikert(k)] = LIKERT_MAP[k];
  }
  return out;
})();

function likertToScore(value) {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') {
    if (value >= 1 && value <= 5) return value;
    return undefined;
  }
  const s = String(value).trim().toLowerCase();
  if (LIKERT_MAP.hasOwnProperty(s)) {
    const v = LIKERT_MAP[s];
    return v === null ? undefined : v;
  }
  const sOrig = String(value).trim();
  if (LIKERT_MAP.hasOwnProperty(sOrig)) {
    const v = LIKERT_MAP[sOrig];
    return v === null ? undefined : v;
  }
  // Robust Arabic match (normalize diacritics, alef variants, whitespace)
  const sNorm = _normalizeArabicLikert(value);
  if (LIKERT_MAP_NORM.hasOwnProperty(sNorm)) {
    const v = LIKERT_MAP_NORM[sNorm];
    return v === null ? undefined : v;
  }
  return undefined;
}

const GENDER_MAP = {
  'طلاب': 'Male',
  'طالبات': 'Female',
  'ذكر': 'Male',
  'أنثى': 'Female',
  'انثى': 'Female',
  'male': 'Male',
  'female': 'Female',
  'm': 'Male',
  'f': 'Female',
};
function normalizeGender(value) {
  if (!value) return 'Unknown';
  const s = String(value).trim().toLowerCase();
  return GENDER_MAP[s] || GENDER_MAP[String(value).trim()] || String(value).trim() || 'Unknown';
}

function normalizeSemester(value) {
  if (!value) return { raw: '', year: 'Unknown', term: '' };
  const s = String(value).trim();
  let year = 'Unknown';
  if (/2023[-–\s]*2024|الأول 2023|الثاني 2023|2023-24/i.test(s)) year = '2023-2024';
  else if (/2024[-–\s]*2025|الأول 2024|الثاني 2024|2024-25/i.test(s)) year = '2024-2025';
  else if (/2025[-–\s]*2026|2025-26/i.test(s)) year = '2025-2026';
  let term = '';
  if (/الأول|first|fall/i.test(s)) term = 'First';
  else if (/الثاني|second|spring/i.test(s)) term = 'Second';
  else if (/الصيف|summer|الثالث/i.test(s)) term = 'Summer';
  return { raw: s, year, term };
}

const CATEGORY_RULES = [
  {
    id: 'beginning',
    label: 'Questions about the beginning of the course',
    short: 'Beginning',
    arabic: 'تقييم بداية المقرر',
    keywords: ['beginning', 'start of', 'course outline', 'بداية المقرر'],
  },
  {
    id: 'during',
    label: 'Questions about what happened during the course',
    short: 'During',
    arabic: 'تقييم أثناء تنفيذ المقرر',
    keywords: ['during the course', 'during course', 'execution', 'أثناء تنفيذ'],
  },
  {
    id: 'outcomes',
    label: 'Course learning outcomes evaluation',
    short: 'Outcomes',
    arabic: 'تقويم المقرر',
    keywords: ['learning outcomes', 'تقويم المقرر', 'outcomes evaluation'],
  },
  {
    id: 'instructor',
    label: 'Course instructor evaluation',
    short: 'Instructor',
    arabic: 'تقييم عضو هيئة التدريس',
    keywords: ['instructor', 'faculty', 'teacher evaluation', 'عضو هيئة التدريس', 'المحاضر'],
  },
  {
    id: 'overall',
    label: 'Overall Evaluation',
    short: 'Overall',
    arabic: 'التقييم العام للمقرر',
    keywords: ['overall', 'overall evaluation', 'general evaluation', 'التقييم العام'],
  },
  {
    id: 'elearning',
    label: 'E-learning and distance education',
    short: 'E-learning',
    arabic: 'تقييم التعلم الإلكتروني',
    keywords: ['e-learning', 'distance education', 'online learning', 'التعلم الإلكتروني', 'التعليم عن بُعد', 'التعليم عن بعد'],
  },
];

function detectCategory(header) {
  if (!header) return null;
  const bracketIdx = header.indexOf('[');
  const prefix = (bracketIdx >= 0 ? header.slice(0, bracketIdx) : header).trim();
  const prefixLower = prefix.toLowerCase();
  const fullLower = String(header).toLowerCase();

  for (const rule of CATEGORY_RULES) {
    if (prefix === rule.arabic) return rule.id;
    if (prefix.startsWith(rule.arabic)) return rule.id;
  }
  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      const k = kw.toLowerCase();
      if (prefixLower.includes(k)) return rule.id;
    }
  }
  for (const rule of CATEGORY_RULES) {
    for (const kw of rule.keywords) {
      const k = kw.toLowerCase();
      if (/^[a-z\s\-]+$/i.test(kw) && fullLower.includes(k)) return rule.id;
    }
  }
  return null;
}

const META_KEYWORDS = {
  timestamp: ['timestamp', 'date', 'الوقت', 'التاريخ'],
  gender: ['الشطر', 'gender', 'sex', 'النوع', 'الجنس'],
  semester: ['الفصل الدراسي', 'semester', 'term', 'الفصل', 'academic year'],
};

function classifyColumn(header, sampleValues) {
  if (!header) return { kind: 'unknown' };
  const h = String(header).toLowerCase();

  for (const kind of Object.keys(META_KEYWORDS)) {
    for (const kw of META_KEYWORDS[kind]) {
      if (h.includes(kw.toLowerCase()) || header.includes(kw)) {
        return { kind };
      }
    }
  }

  const likertCount = sampleValues.filter(v => likertToScore(v) !== undefined).length;
  const nonEmptyCount = sampleValues.filter(v => v !== '' && v !== null && v !== undefined).length;
  if (nonEmptyCount > 0 && likertCount / nonEmptyCount >= 0.5) {
    const cat = detectCategory(header);
    return { kind: 'question', category: cat };
  }
  return { kind: 'freetext' };
}

async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'csv') {
    const text = await file.text();
    return parseCSV(text);
  }
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });
  if (aoa.length === 0) return { headers: [], rows: [] };
  const headers = aoa[0].map(h => String(h ?? '').trim());
  const rows = aoa.slice(1).filter(r => r.some(v => v !== '' && v !== null && v !== undefined));
  return { headers, rows };
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else cur += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\r') {}
      else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  if (rows.length === 0) return { headers: [], rows: [] };
  return { headers: rows[0].map(h => String(h ?? '').trim()), rows: rows.slice(1).filter(r => r.some(v => v !== '')) };
}

function analyze({ headers, rows }) {
  const sampleSize = Math.min(rows.length, 20);
  const cols = headers.map((h, idx) => {
    const samples = [];
    for (let r = 0; r < sampleSize; r++) samples.push(rows[r]?.[idx]);
    return { idx, header: h, ...classifyColumn(h, samples) };
  });

  const meta = {
    timestamp: cols.find(c => c.kind === 'timestamp')?.idx,
    gender: cols.find(c => c.kind === 'gender')?.idx,
    semester: cols.find(c => c.kind === 'semester')?.idx,
  };
  const questionCols = cols.filter(c => c.kind === 'question');
  const freetextCols = cols.filter(c => c.kind === 'freetext');

  // Collect non-empty free-text entries with their column header
  const comments = [];
  for (const fc of freetextCols) {
    for (const row of rows) {
      const v = row[fc.idx];
      if (v == null) continue;
      const s = String(v).trim();
      if (s.length < 3) continue;
      // Skip if it looks like a Likert/numeric value
      if (/^[1-5](\.0)?$/.test(s)) continue;
      comments.push({ header: fc.header, text: s });
    }
  }

  const records = rows.map(row => {
    const gender = meta.gender !== undefined ? normalizeGender(row[meta.gender]) : 'Unknown';
    const semRaw = meta.semester !== undefined ? row[meta.semester] : '';
    const semInfo = normalizeSemester(semRaw);
    const scores = {};
    for (const qc of questionCols) {
      const s = likertToScore(row[qc.idx]);
      if (s !== undefined) scores[qc.idx] = s;
    }
    return { gender, semester: semInfo, semesterRaw: semRaw, scores, row };
  });

  questionCols.forEach((qc, i) => { qc.qNum = i + 1; });

  const categoryGroups = CATEGORY_RULES.map(rule => ({
    ...rule,
    questions: questionCols.filter(qc => qc.category === rule.id),
  })).filter(g => g.questions.length > 0);

  const uncategorized = questionCols.filter(qc => !qc.category);
  if (uncategorized.length) {
    categoryGroups.push({
      id: 'other',
      label: 'Other questions',
      short: 'Other',
      questions: uncategorized,
    });
  }

  function avgFor(filterFn, qCols) {
    let sum = 0, n = 0;
    for (const rec of records) {
      if (!filterFn(rec)) continue;
      for (const qc of qCols) {
        const s = rec.scores[qc.idx];
        if (s !== undefined) { sum += s; n++; }
      }
    }
    return n > 0 ? sum / n : null;
  }
  function countFor(filterFn) {
    let n = 0;
    for (const rec of records) if (filterFn(rec)) n++;
    return n;
  }

  const allFilter = () => true;
  const totalResponses = records.length;

  function respondentCount(filterFn, qCols) {
    let n = 0;
    for (const rec of records) {
      if (!filterFn(rec)) continue;
      const answered = qCols.some(qc => rec.scores[qc.idx] !== undefined);
      if (answered) n++;
    }
    return n;
  }

  const categoryAverages = categoryGroups.map(g => ({
    id: g.id,
    label: g.label,
    short: g.short,
    questionCount: g.questions.length,
    average: avgFor(allFilter, g.questions),
    respondents: respondentCount(allFilter, g.questions),
    questions: g.questions.map(qc => ({
      qNum: qc.qNum,
      header: qc.header,
      idx: qc.idx,
      average: avgFor(allFilter, [qc]),
    })),
  }));

  const genders = [...new Set(records.map(r => r.gender))].sort();
  const byGender = genders.map(g => ({
    gender: g,
    count: countFor(r => r.gender === g),
    overall: avgFor(r => r.gender === g, questionCols),
    categories: categoryGroups.map(cat => ({
      id: cat.id,
      label: cat.label,
      short: cat.short,
      average: avgFor(r => r.gender === g, cat.questions),
      respondents: respondentCount(r => r.gender === g, cat.questions),
    })),
  }));

  const years = [...new Set(records.map(r => r.semester.year))].sort();
  const bySemester = years.map(y => ({
    year: y,
    count: countFor(r => r.semester.year === y),
    overall: avgFor(r => r.semester.year === y, questionCols),
    categories: categoryGroups.map(cat => ({
      id: cat.id,
      label: cat.label,
      short: cat.short,
      average: avgFor(r => r.semester.year === y, cat.questions),
      respondents: respondentCount(r => r.semester.year === y, cat.questions),
    })),
  }));

  const semKeys = [...new Set(records.map(r => r.semesterRaw).filter(s => s))];
  const bySemesterDetail = semKeys.map(sk => ({
    semester: sk,
    count: countFor(r => r.semesterRaw === sk),
    categories: categoryGroups.map(cat => ({
      id: cat.id,
      label: cat.label,
      short: cat.short,
      average: avgFor(r => r.semesterRaw === sk, cat.questions),
      respondents: respondentCount(r => r.semesterRaw === sk, cat.questions),
    })),
  }));

  const overallAverage = avgFor(allFilter, questionCols);

  return {
    headers, rows, cols, meta, questionCols, freetextCols, comments, records,
    categoryGroups, categoryAverages, byGender, bySemester, bySemesterDetail,
    totalResponses, overallAverage,
  };
}

// ============ File-saver helpers ============
function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCSV(rows, filename) {
  const csv = rows.map(r => r.map(cell => {
    const s = (cell === null || cell === undefined) ? '' : String(cell);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }).join(',')).join('\n');
  // BOM for Excel UTF-8 (helps Arabic text render)
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  downloadBlob(blob, filename);
}

// Render a chart-shaped SVG to PNG and download
async function downloadChartPng(svgEl, filename) {
  if (!svgEl) return;
  const clone = svgEl.cloneNode(true);
  const rect = svgEl.getBoundingClientRect();
  const w = Math.ceil(rect.width);
  const h = Math.ceil(rect.height);
  clone.setAttribute('width', w);
  clone.setAttribute('height', h);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  // Inline computed styles for text (basic — fonts default to system)
  const xml = new XMLSerializer().serializeToString(clone);
  const svgBlob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  await new Promise((resolve, reject) => {
    img.onload = resolve; img.onerror = reject;
    img.src = url;
  });
  const scale = 2; // retina
  const canvas = document.createElement('canvas');
  canvas.width = w * scale; canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, w, h);
  URL.revokeObjectURL(url);
  canvas.toBlob(blob => {
    if (blob) downloadBlob(blob, filename);
  }, 'image/png');
}

// ============ Components ============
function FileUpload({ onFile, compact = false }) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef();
  return (
    <div
      className={'upload ' + (drag ? 'drag ' : '') + (compact ? 'compact' : '')}
      onDragOver={e => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        e.preventDefault(); setDrag(false);
        if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]);
      }}
      onClick={() => inputRef.current.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        style={{ display: 'none' }}
        onChange={e => e.target.files[0] && onFile(e.target.files[0])}
      />
      <div className="upload-icon">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <div className="upload-text">
        <div className="upload-title">Drop file or click to upload</div>
        <div className="upload-sub">.xlsx · .xls · .csv</div>
      </div>
    </div>
  );
}

function fmt(v) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  // truncate to 2 decimals (do NOT round) so averages never get bumped up
  return (Math.floor(v * 100) / 100).toFixed(2);
}

// Truncating .toFixed(2) — never rounds up
function tFix(v, d = 2) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  const f = Math.pow(10, d);
  return (Math.floor(v * f) / f).toFixed(d);
}

function StatCard({ label, value, sub, accent }) {
  return (
    <div className={'stat-card' + (accent ? ' accent' : '')}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

// ============ SVG Bar Chart (downloadable) ============
function BarChart({ data, title, onDownloadPng, onDownloadCsv, totalCount }) {
  const svgRef = useRef(null);
  const max = 5;
  const lowThreshold = 4.0;

  const W = 760;
  const labelWidth = 240;
  const rowH = 36;
  const barH = 22;
  const padTop = 10;
  const padBottom = 36;
  const chartLeft = labelWidth + 20;
  const chartRight = W - 20;
  const chartW = chartRight - chartLeft;
  const H = padTop + data.length * rowH + padBottom;

  const ticks = [0, 1, 2, 3, 4, 5];

  const handleDownloadPng = useCallback(() => {
    downloadChartPng(svgRef.current, (title || 'chart').replace(/[^\w]+/g, '-').toLowerCase() + '.png');
  }, [title]);

  return (
    <div className="chart">
      <div className="chart-header">
        {title && <div className="chart-title">{title}</div>}
        <div className="chart-actions">
          <button className="icon-btn" title="Download CSV" onClick={onDownloadCsv}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            CSV
          </button>
          <button className="icon-btn" title="Download PNG" onClick={handleDownloadPng}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <circle cx="8.5" cy="8.5" r="1.5"/>
              <polyline points="21 15 16 10 5 21"/>
            </svg>
            PNG
          </button>
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        preserveAspectRatio="xMidYMid meet"
        className="bar-svg"
      >
        <style>{`
          .axis-line { stroke: #e0ddd6; stroke-width: 1; }
          .grid-line { stroke: #efece6; stroke-width: 1; stroke-dasharray: 2 3; }
          .tick-text { font: 11px -apple-system, sans-serif; fill: #8a8780; }
          .label-text { font: 13px -apple-system, sans-serif; fill: #4a4842; }
          .value-text { font: 600 13px -apple-system, sans-serif; fill: #1f1d1a; }
          .bar-good { fill: #2e6e4a; }
          .bar-low { fill: #b6552a; }
          .bar-bg { fill: #f3f1ec; }
        `}</style>
        {/* Grid lines */}
        {ticks.map(t => {
          const x = chartLeft + (t / max) * chartW;
          return (
            <line
              key={'grid-' + t}
              className={t === 0 ? 'axis-line' : 'grid-line'}
              x1={x} y1={padTop - 4}
              x2={x} y2={padTop + data.length * rowH + 4}
            />
          );
        })}
        {/* Bars */}
        {data.map((d, i) => {
          const y = padTop + i * rowH + (rowH - barH) / 2;
          const v = d.value;
          const w = v === null ? 0 : (v / max) * chartW;
          const low = v !== null && v < lowThreshold;
          const cy = y + barH / 2;
          return (
            <g key={i}>
              {/* Background track */}
              <rect className="bar-bg" x={chartLeft} y={y} width={chartW} height={barH} rx="2" ry="2" />
              {/* Label */}
              <text
                className="label-text"
                x={labelWidth + 8}
                y={cy + 4}
                textAnchor="end"
              >
                {d.label.length > 38 ? d.label.slice(0, 36) + '…' : d.label}
              </text>
              {/* Bar */}
              {v !== null && (
                <rect
                  className={low ? 'bar-low' : 'bar-good'}
                  x={chartLeft}
                  y={y}
                  width={Math.max(2, w)}
                  height={barH}
                  rx="2" ry="2"
                />
              )}
              {/* Value */}
              <text
                className="value-text"
                x={chartLeft + w + 8}
                y={cy + 4}
              >
                {d.count != null ? `${d.count} / ${fmt(v)}` : fmt(v)}
              </text>
            </g>
          );
        })}
        {/* Axis ticks */}
        {ticks.map(t => {
          const x = chartLeft + (t / max) * chartW;
          const yAxis = padTop + data.length * rowH + 16;
          return (
            <text key={'tick-' + t} className="tick-text" x={x} y={yAxis} textAnchor="middle">
              {tFix(t)}
            </text>
          );
        })}
      </svg>

      <div className="chart-legend">
        <span className="legend-item"><i className="swatch good"/> ≥ 4.00</span>
        <span className="legend-item"><i className="swatch low"/> &lt; 4.00 (needs attention)</span>
      </div>
    </div>
  );
}

function CategoryTable({ rows, columns, title, onDownloadCsv }) {
  return (
    <div className="table-wrap">
      <div className="table-header">
        {title && <div className="table-title">{title}</div>}
        {onDownloadCsv && (
          <button className="icon-btn" title="Download CSV" onClick={onDownloadCsv}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            CSV
          </button>
        )}
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Category</th>
            {columns.map(c => <th key={c.key}>{c.label}<div className="th-sub">n={c.count}</div></th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="cat-label">{r.label}</td>
              {columns.map(c => {
                const v = r.values[c.key];
                const low = v !== null && v !== undefined && !isNaN(v) && v < 4.0;
                return (
                  <td key={c.key} className={'num ' + (low ? 'low-cell' : '')}>{fmt(v)}</td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function QuestionDetail({ analysis }) {
  const [open, setOpen] = useState(false);
  const handleCsv = () => {
    const rows = [['#', 'Category', 'Question', 'Average']];
    analysis.categoryAverages.forEach(cat => {
      cat.questions.forEach(q => {
        rows.push(['Q' + q.qNum, cat.label, q.header, q.average !== null ? tFix(q.average) : '']);
      });
    });
    downloadCSV(rows, 'questions.csv');
  };
  return (
    <div className="qdetail">
      <div className="qdetail-bar">
        <button className="toggle" onClick={() => setOpen(!open)}>
          {open ? '▼' : '▶'} Question-level breakdown ({analysis.questionCols.length} questions)
        </button>
        {open && (
          <button className="icon-btn" onClick={handleCsv}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            CSV
          </button>
        )}
      </div>
      {open && (
        <table className="data-table compact">
          <thead>
            <tr><th>#</th><th>Category</th><th>Question</th><th>Avg</th></tr>
          </thead>
          <tbody>
            {analysis.categoryAverages.flatMap(cat =>
              cat.questions.map(q => {
                const low = q.average !== null && q.average < 4.0;
                return (
                  <tr key={q.idx}>
                    <td>Q{q.qNum}</td>
                    <td><span className="pill">{cat.short || cat.label}</span></td>
                    <td className="qtext">{q.header}</td>
                    <td className={'num ' + (low ? 'low-cell' : '')}>{fmt(q.average)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ============ Excel export ============
// Render a horizontal bar chart to a PNG data URL for embedding in xlsx.
function renderBarChartPng(items, opts = {}) {
  const W = opts.width || 900;
  const H = opts.height || 60 + items.length * 56;
  const dpr = 2;
  const canvas = document.createElement('canvas');
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const padL = 320, padR = 70, padT = 30, padB = 36;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;
  const barH = Math.max(18, Math.min(34, chartH / Math.max(items.length, 1) - 14));
  const rowH = items.length ? chartH / items.length : 0;
  const max = 5;

  ctx.font = '12px -apple-system, Segoe UI, sans-serif';
  ctx.fillStyle = '#94918a';
  ctx.textAlign = 'center';
  for (let v = 0; v <= 5; v++) {
    const x = padL + (v / max) * chartW;
    ctx.strokeStyle = v === 0 ? '#94918a' : '#e8e5de';
    ctx.beginPath();
    ctx.moveTo(x, padT); ctx.lineTo(x, padT + chartH); ctx.stroke();
    ctx.fillText(tFix(v), x, padT + chartH + 18);
  }

  if (opts.title) {
    ctx.fillStyle = '#1a1814';
    ctx.font = '600 14px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(opts.title, padL, 18);
  }

  items.forEach((it, i) => {
    const yCenter = padT + rowH * (i + 0.5);
    const yBar = yCenter - barH / 2;
    const v = it.value;
    const w = v != null ? (v / max) * chartW : 0;
    const low = v != null && v < 4.0;
    ctx.fillStyle = low ? '#b6552a' : '#2e6e4a';
    ctx.fillRect(padL, yBar, w, barH);

    ctx.fillStyle = '#1a1814';
    ctx.font = '12px -apple-system, Segoe UI, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(it.label, padL - 10, yCenter + 4);

    if (v != null) {
      ctx.textAlign = 'left';
      ctx.font = '600 12px -apple-system, Segoe UI, sans-serif';
      ctx.fillText(tFix(v), padL + w + 6, yCenter + 4);
    }
  });

  return canvas.toDataURL('image/png');
}

// Friendly Likert label used in the Summary header (matches reference file)
const LIKERT_HDR = ['أوافق بشدة', 'أوافق', 'أوافق إلى حد ما', 'لا أوافق', 'لا أوافق إطلاقاً', 'لا أعلم'];
const LIKERT_HDR_EN = ['Strongly agree', 'Agree', 'Somewhat agree', 'Disagree', 'Strongly disagree', 'Don\'t know'];

function colLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

async function exportToExcel(analysis, fileName = 'survey-analysis.xlsx') {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Survey Analyzer';
  wb.created = new Date();

  const ACCENT = 'FF2E6E4A';
  const ACCENT_SOFT = 'FFE8F0EB';
  const WARN = 'FFB6552A';
  const WARN_SOFT = 'FFFBEDE4';
  const HEADER_BG = 'FF245839';
  const STRIPE = 'FFF7F5EF';
  const LINE = 'FFD8D4CC';

  const thinBorder = {
    top: { style: 'thin', color: { argb: LINE } },
    left: { style: 'thin', color: { argb: LINE } },
    bottom: { style: 'thin', color: { argb: LINE } },
    right: { style: 'thin', color: { argb: LINE } },
  };

  const headerStyle = {
    font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
    fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } },
    alignment: { vertical: 'middle', horizontal: 'center', wrapText: true },
    border: thinBorder,
  };

  const titleStyle = {
    font: { bold: true, size: 14, color: { argb: 'FF1A1814' } },
    alignment: { vertical: 'middle', horizontal: 'left' },
  };

  // ===== Sheet 1: Data (raw responses, mirrors البيانات) =====
  const dataSheet = wb.addWorksheet('Data', { views: [{ rightToLeft: true, state: 'frozen', xSplit: 0, ySplit: 1 }] });
  const qCols = analysis.questionCols;
  const dataHeaders = qCols.map(qc => qc.header);
  dataSheet.addRow(dataHeaders);
  const headerRow = dataSheet.getRow(1);
  headerRow.height = 56;
  headerRow.eachCell((cell) => {
    cell.style = headerStyle;
  });
  // Add the raw response values for each record
  analysis.records.forEach((rec, ri) => {
    const row = qCols.map(qc => {
      const v = rec.row[qc.idx];
      return v == null ? '' : v;
    });
    const r = dataSheet.addRow(row);
    r.eachCell((cell) => {
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: 'right', wrapText: true };
      if (ri % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } };
      }
    });
  });
  qCols.forEach((_, i) => { dataSheet.getColumn(i + 1).width = 28; });

  // ===== Sheet 2: Summary (mirrors الملخص with COUNTIF formulas) =====
  const summary = wb.addWorksheet('Summary', { views: [{ rightToLeft: true, state: 'frozen', xSplit: 0, ySplit: 1 }] });
  // Column header
  summary.addRow(['Question', ...LIKERT_HDR, 'Average']);
  const sHeader = summary.getRow(1);
  sHeader.height = 38;
  sHeader.eachCell(cell => { cell.style = headerStyle; });

  qCols.forEach((qc, i) => {
    const dataCol = colLetter(i + 1);
    const range = `Data!$${dataCol}$2:$${dataCol}$1000`;
    const r = summary.addRow([qc.header]);
    // Likert percentage formulas
    LIKERT_HDR.forEach((hdr, k) => {
      const cell = r.getCell(2 + k);
      cell.value = { formula: `IFERROR(COUNTIF(${range},"${hdr}")/COUNTA(${range}),0)` };
      cell.numFmt = '0.0%';
    });
    // Average formula (1..5 weighted, ignoring "Don't know")
    // Use SUMPRODUCT with TRIM to be robust against trailing/internal whitespace.
    // Also accept both Arabic variants of "strongly disagree" (with and without tanwin).
    const v5 = `(--(TRIM(${range})="${LIKERT_HDR[0]}"))`;
    const v4 = `(--(TRIM(${range})="${LIKERT_HDR[1]}"))`;
    const v3 = `(--(TRIM(${range})="${LIKERT_HDR[2]}"))`;
    const v2 = `(--(TRIM(${range})="${LIKERT_HDR[3]}"))`;
    // Strongly disagree — sum both Arabic variants so we don't miss any
    const v1a = `(--(TRIM(${range})="${LIKERT_HDR[4]}"))`;
    const v1b = `(--(TRIM(${range})="\u0644\u0627 \u0623\u0648\u0627\u0641\u0642 \u0625\u0637\u0644\u0627\u0642\u0627"))`; // without tanwin
    const num = `(SUMPRODUCT(${v5})*5+SUMPRODUCT(${v4})*4+SUMPRODUCT(${v3})*3+SUMPRODUCT(${v2})*2+(SUMPRODUCT(${v1a})+SUMPRODUCT(${v1b}))*1)`;
    const den = `(SUMPRODUCT(${v5})+SUMPRODUCT(${v4})+SUMPRODUCT(${v3})+SUMPRODUCT(${v2})+SUMPRODUCT(${v1a})+SUMPRODUCT(${v1b}))`;
    const avgCell = r.getCell(8);
    avgCell.value = {
      // TRUNC to 2 decimals so display never rounds up
      formula: `IFERROR(TRUNC(${num}/${den},2),0)`
    };
    avgCell.numFmt = '0.00';
    r.eachCell((cell, c) => {
      cell.border = thinBorder;
      cell.alignment = { vertical: 'middle', horizontal: c === 1 ? 'right' : 'center', wrapText: true };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } };
      if (c === 8) {
        cell.font = { bold: true, color: { argb: ACCENT } };
      }
    });
    r.height = 32;
  });

  summary.getColumn(1).width = 60;
  for (let c = 2; c <= 7; c++) summary.getColumn(c).width = 14;
  summary.getColumn(8).width = 12;

  // ===== Sheet 3: Analysis Report (KPI, category averages, gender, semester) =====
  const report = wb.addWorksheet('Analysis Report', { views: [{ state: 'frozen', ySplit: 0 }] });
  report.getColumn(1).width = 42;
  for (let c = 2; c <= 8; c++) report.getColumn(c).width = 18;

  let row = 1;
  function addTitle(text) {
    const r = report.getRow(row); r.getCell(1).value = text; r.getCell(1).style = titleStyle;
    r.height = 28;
    row++;
  }
  function addSpacer() { row++; }
  function addTableHeader(cells) {
    const r = report.getRow(row);
    cells.forEach((v, i) => { r.getCell(i + 1).value = v; r.getCell(i + 1).style = headerStyle; });
    r.height = 28;
    row++;
  }
  function addBody(cells, opts = {}) {
    const r = report.getRow(row);
    cells.forEach((v, i) => {
      const c = r.getCell(i + 1);
      c.value = v;
      c.border = thinBorder;
      c.alignment = { vertical: 'middle', horizontal: i === 0 ? 'left' : 'center', wrapText: true };
      if (opts.stripe) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } };
      if (typeof v === 'number' && i > 0) c.numFmt = '0.00';
      if (opts.lowFlags && opts.lowFlags[i]) {
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARN_SOFT } };
        c.font = { color: { argb: WARN }, bold: true };
      }
    });
    r.height = 22;
    row++;
  }

  addTitle('Survey Analysis Report');
  addBody(['Total responses', analysis.totalResponses]);
  addBody(['Overall average', analysis.overallAverage != null ? Number(tFix(analysis.overallAverage)) : '—']);
  addBody(['Categories', analysis.categoryAverages.length]);
  addBody(['Questions', analysis.questionCols.length]);
  addSpacer();

  addTitle('Category averages (overall)');
  addTableHeader(['Category', 'Average', 'Questions', 'Status']);
  analysis.categoryAverages.forEach((c, i) => {
    const v = c.average;
    const low = v != null && v < 4.0;
    addBody([
      c.label,
      v != null ? Number(tFix(v)) : '',
      c.questionCount,
      low ? 'LOW (<4.0)' : 'OK',
    ], { stripe: i % 2 === 1, lowFlags: [false, low, false, low] });
  });
  addSpacer();

  if (analysis.byGender.length) {
    addTitle('Per gender');
    addTableHeader(['Category', ...analysis.byGender.map(g => `${g.gender} (n=${g.count})`)]);
    analysis.categoryAverages.forEach((cat, ci) => {
      const cells = [cat.label, ...analysis.byGender.map(g => {
        const v = g.categories[ci].average;
        return v != null ? Number(tFix(v)) : '';
      })];
      const lowFlags = [false, ...analysis.byGender.map(g => {
        const v = g.categories[ci].average;
        return v != null && v < 4.0;
      })];
      addBody(cells, { stripe: ci % 2 === 1, lowFlags });
    });
    addSpacer();
  }

  if (analysis.bySemester.length) {
    addTitle('Per academic year');
    addTableHeader(['Category', ...analysis.bySemester.map(s => `${s.year} (n=${s.count})`)]);
    analysis.categoryAverages.forEach((cat, ci) => {
      const cells = [cat.label, ...analysis.bySemester.map(s => {
        const v = s.categories[ci].average;
        return v != null ? Number(tFix(v)) : '';
      })];
      const lowFlags = [false, ...analysis.bySemester.map(s => {
        const v = s.categories[ci].average;
        return v != null && v < 4.0;
      })];
      addBody(cells, { stripe: ci % 2 === 1, lowFlags });
    });
    addSpacer();
  }

  // ===== Sheet 4: Charts (embedded PNGs) =====
  const charts = wb.addWorksheet('Charts');
  charts.getColumn(1).width = 4;

  let chartRow = 1;
  function placeImage(dataUrl, w, h) {
    const id = wb.addImage({ base64: dataUrl, extension: 'png' });
    charts.addImage(id, {
      tl: { col: 1, row: chartRow },
      ext: { width: w, height: h },
    });
    // Reserve approximately h/20 rows
    chartRow += Math.ceil(h / 20) + 2;
  }

  // Overall chart
  const overallItems = analysis.categoryAverages.map(c => ({ label: c.label, value: c.average }));
  const overallPng = renderBarChartPng(overallItems, { title: 'Category averages — Overall', width: 900 });
  placeImage(overallPng, 900, 60 + overallItems.length * 56);

  // Per-gender chart (grouped — render each gender as its own row of bars labelled)
  if (analysis.byGender.length) {
    const items = [];
    analysis.categoryAverages.forEach((cat, i) => {
      analysis.byGender.forEach(g => {
        items.push({ label: `${cat.short || cat.label} · ${g.gender}`, value: g.categories[i].average });
      });
    });
    const png = renderBarChartPng(items, { title: 'Category averages — by gender', width: 900 });
    placeImage(png, 900, 60 + items.length * 36);
  }

  if (analysis.bySemester.length) {
    const items = [];
    analysis.categoryAverages.forEach((cat, i) => {
      analysis.bySemester.forEach(s => {
        items.push({ label: `${cat.short || cat.label} · ${s.year}`, value: s.categories[i].average });
      });
    });
    const png = renderBarChartPng(items, { title: 'Category averages — by academic year', width: 900 });
    placeImage(png, 900, 60 + items.length * 36);
  }

  // ===== Sheet 5: Questions detail =====
  const qSheet = wb.addWorksheet('Questions');
  qSheet.columns = [
    { header: '#', width: 6 },
    { header: 'Category', width: 26 },
    { header: 'Question', width: 70 },
    { header: 'Average', width: 12 },
  ];
  qSheet.getRow(1).eachCell(cell => { cell.style = headerStyle; });
  qSheet.getRow(1).height = 28;
  let qi = 0;
  analysis.categoryAverages.forEach(cat => {
    cat.questions.forEach(q => {
      const v = q.average;
      const low = v != null && v < 4.0;
      const r = qSheet.addRow(['Q' + q.qNum, cat.label, q.header, v != null ? Number(tFix(v)) : '']);
      r.eachCell((cell, c) => {
        cell.border = thinBorder;
        cell.alignment = { vertical: 'middle', horizontal: c === 3 ? 'left' : c === 4 ? 'center' : 'left', wrapText: true };
        if (qi % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: STRIPE } };
        if (c === 4 && low) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: WARN_SOFT } };
          cell.font = { color: { argb: WARN }, bold: true };
        }
        if (c === 4) cell.numFmt = '0.00';
      });
      r.height = 28;
      qi++;
    });
  });

  // Reorder so Summary appears first (mirrors reference file)
  // ExcelJS doesn't support sheet reorder directly; sheets are in insertion order.
  // We added Data first, then Summary. Move Summary to position 0:
  // ExcelJS exposes orderNo in getWorksheet.options? No. Workaround: create new wb with reordered, but instead leave order as-is — user can reorder.

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  downloadBlob(blob, fileName);
}

// ============ Analysis text generator ============
function generateAnalysisText(cats, label) {
  // cats: [{label, average, respondents (or count)}]
  const valid = cats.filter(c => c.average !== null && c.average !== undefined);
  if (!valid.length) return ['No scored responses available for this segment.'];

  const sorted = [...valid].sort((a, b) => b.average - a.average);
  const top = sorted[0];
  const bottom = sorted[sorted.length - 1];
  const mean = valid.reduce((s, c) => s + c.average, 0) / valid.length;
  const above = valid.filter(c => c.average >= 4.0);
  const below = valid.filter(c => c.average < 4.0);
  const totalCount = cats.reduce((s, c) => s + (c.count || c.respondents || 0), 0);

  const lines = [];
  lines.push(`This chart summarizes ${label || 'the selected segment'} across ${valid.length} categories of the course evaluation.`);
  lines.push(`The combined respondent volume across categories totals ${totalCount} answers, providing the basis for these averages.`);
  lines.push(`The category-level mean across the displayed bars is ${tFix(mean)} on the 1–5 Likert scale.`);
  lines.push(`The strongest category is "${top.label}" with an average of ${tFix(top.average)} (${top.count || top.respondents || 0} respondents).`);
  lines.push(`The weakest category is "${bottom.label}" with an average of ${tFix(bottom.average)} (${bottom.count || bottom.respondents || 0} respondents).`);
  if (above.length) {
    lines.push(`${above.length} of ${valid.length} categories meet or exceed the 4.00 satisfaction threshold, indicating broadly positive perception.`);
  } else {
    lines.push(`No category reaches the 4.00 satisfaction threshold, suggesting a systemic concern worth investigating.`);
  }
  if (below.length) {
    const names = below.map(c => `"${c.label}" (${tFix(c.average)})`).join(', ');
    lines.push(`Categories below 4.00 that warrant attention: ${names}.`);
  } else {
    lines.push(`No category falls below the 4.00 threshold, which is a strong overall signal.`);
  }
  const spread = top.average - bottom.average;
  lines.push(`The spread between the highest and lowest category is ${tFix(spread)} points, ${spread < 0.5 ? 'indicating a consistent experience across dimensions' : spread < 1.0 ? 'showing moderate variation across dimensions' : 'indicating uneven performance across dimensions'}.`);
  lines.push(`Recommendation: maintain practices supporting "${top.label}" while focusing improvement efforts on "${bottom.label}".`);
  lines.push(`Next step: review item-level results within the lowest category and discuss findings with the teaching team to define concrete actions.`);
  return lines.slice(0, 10);
}

// ============ Local rule-based comment summarizer (Arabic + English) ============
function summarizeComments(comments) {
  if (!comments || comments.length === 0) return null;

  // Bilingual sentiment lexicons
  const positiveTerms = [
    // English
    'good','great','excellent','amazing','awesome','helpful','clear','easy','fun','engaging','enjoyable',
    'best','wonderful','useful','informative','interesting','organized','well organized','well-organized',
    'professional','knowledgeable','supportive','cooperative','patient','passionate','interactive','practical',
    'thanks','thank you','appreciate','recommend','loved','liked','satisfied','satisfying','happy','perfect',
    'comprehensive','rich','valuable','effective','smooth','enjoyed',
    // Arabic
    'جيد','ممتاز','رائع','مفيد','واضح','سهل','ممتع','مميز','شكرا','شكراً','أحببت','احببت','استفدت',
    'استمتعت','جميل','مبدع','متعاون','صبور','محترف','أفضل','افضل','رضي','راضي','رائعة','ممتازة','جيدة'
  ];
  const negativeTerms = [
    // English
    'bad','poor','difficult','hard','confusing','unclear','boring','slow','fast','too fast','too slow',
    'overwhelming','overwhelmed','hate','disliked','frustrating','frustrated','disorganized','unorganized',
    'lacking','lacks','missing','weak','problem','issue','complicated','complex','heavy','too much',
    'short','rushed','outdated','irrelevant','noisy','disappointed','unfair',
    // Arabic
    'صعب','سيء','سيئ','ممل','غير واضح','غامض','مزدحم','كثير','زائد','ناقص','ضعيف','مشكلة','مشاكل',
    'سريع','بطيء','مرهق','محبط','معقد','غير منظم','أسوأ','اسوأ','يحتاج تحسين','بحاجة'
  ];
  const suggestionTerms = [
    // English
    'should','could','would like','wish','suggest','recommend','need to','needs','more','add','include',
    'reduce','increase','provide','provide more','please add','it would be','better if','hope','prefer',
    // Arabic
    'يجب','أتمنى','اتمنى','أقترح','اقترح','نحتاج','يحتاج','إضافة','اضافة','زيادة','تقليل','تحسين',
    'أرجو','ارجو','يفضل','ياليت','ليت','لو','يا ليت'
  ];

  // Topic keywords → readable English topic name
  const topics = [
    { en: 'practical exercises and hands-on practice', kw: ['practice','practical','hands-on','hands on','exercise','lab','lab activities','tatbiq','تطبيق','تدريب','تمارين','تطبيقي','عملي'] },
    { en: 'course content and curriculum', kw: ['content','material','curriculum','syllabus','topics','محتوى','منهج','مادة','مواضيع'] },
    { en: 'the instructor', kw: ['instructor','professor','teacher','doctor','dr.','dr ','faculty','المدرس','الدكتور','المحاضر','أستاذ','استاذ'] },
    { en: 'assignments and assessments', kw: ['assignment','homework','assessment','exam','quiz','test','grading','واجب','اختبار','تقييم','امتحان','درجات'] },
    { en: 'pace and workload', kw: ['pace','speed','workload','time','duration','rushed','وقت','سرعة','بطء','مدة','وقت قليل','وقت طويل'] },
    { en: 'online and e-learning experience', kw: ['online','e-learning','distance','recording','recorded','zoom','lms','أونلاين','عن بعد','تسجيل','منصة','الكتروني'] },
    { en: 'communication and clarity', kw: ['communication','clarity','clear','explain','explanation','تواصل','شرح','وضوح','توضيح'] },
    { en: 'support and feedback', kw: ['support','feedback','help','office hours','response','دعم','مساعدة','تغذية راجعة','رد'] },
  ];

  // Tokenize for matching (case-insensitive, also keep Arabic)
  let posCount = 0, negCount = 0, sugCount = 0;
  const topicPos = new Map();
  const topicNeg = new Map();
  const topicSug = new Map();
  const bumpMap = (m, k) => m.set(k, (m.get(k) || 0) + 1);

  const containsAny = (text, terms) => {
    const lower = text.toLowerCase();
    for (const t of terms) {
      if (!t) continue;
      const tl = t.toLowerCase();
      if (lower.includes(tl)) return true;
    }
    return false;
  };

  for (const c of comments) {
    const text = (typeof c === 'string' ? c : c.text || '').trim();
    if (!text) continue;
    const isPos = containsAny(text, positiveTerms);
    const isNeg = containsAny(text, negativeTerms);
    const isSug = containsAny(text, suggestionTerms);
    if (isPos) posCount++;
    if (isNeg) negCount++;
    if (isSug) sugCount++;
    // Topic attribution
    for (const t of topics) {
      if (containsAny(text, t.kw)) {
        if (isPos) bumpMap(topicPos, t.en);
        if (isNeg) bumpMap(topicNeg, t.en);
        if (isSug) bumpMap(topicSug, t.en);
      }
    }
  }

  const total = comments.length;
  const topNeutral = (m, n=2) => [...m.entries()].sort((a,b) => b[1]-a[1]).slice(0, n).map(e => e[0]);

  // Sentence 1: overall sentiment + most-praised topic
  const posTopics = topNeutral(topicPos, 2);
  const negTopics = topNeutral(topicNeg, 2);
  const sugTopics = topNeutral(topicSug, 2);

  let s1;
  if (posCount === 0 && negCount === 0 && sugCount === 0) {
    s1 = `Across the ${total} open-ended comment${total === 1 ? '' : 's'}, participants offered brief feedback without strong positive or negative sentiment.`;
  } else if (posCount >= negCount * 2) {
    const praise = posTopics.length ? `, with particular appreciation for ${posTopics.join(' and ')}` : '';
    s1 = `Across the ${total} open-ended comment${total === 1 ? '' : 's'}, the overall tone is clearly positive${praise}.`;
  } else if (negCount > posCount) {
    const concern = negTopics.length ? `, with concerns most often raised about ${negTopics.join(' and ')}` : '';
    s1 = `Across the ${total} open-ended comment${total === 1 ? '' : 's'}, participants express more critical than positive feedback${concern}.`;
  } else {
    const praise = posTopics.length ? ` praising ${posTopics.join(' and ')}` : '';
    const concern = negTopics.length ? ` while noting concerns about ${negTopics.join(' and ')}` : '';
    s1 = `Across the ${total} open-ended comment${total === 1 ? '' : 's'}, participants share a balanced impression,${praise}${concern}.`.replace(/, +while/, ', while').replace(/,\./, '.');
  }

  // Sentence 2: suggestions / improvements
  let s2;
  if (sugCount > 0 && sugTopics.length) {
    s2 = `The most common suggestions for improvement focus on ${sugTopics.join(' and ')}, indicating where the next iteration of the course should invest.`;
  } else if (negCount > 0 && negTopics.length) {
    s2 = `The recurring concerns around ${negTopics.join(' and ')} represent the clearest opportunities for improvement in the next course offering.`;
  } else if (posCount > 0) {
    s2 = `No major issues are raised in the comments, and the strengths highlighted by students are worth preserving in future iterations of the course.`;
  } else {
    s2 = `A manual review of the original responses is recommended to extract any specific improvement actions for the next course offering.`;
  }

  return `${s1} ${s2}`;
}
function _b64ToUint8(b64) {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}
function _xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
function _replaceText(xml, oldText, newText) {
  // Replace inside <a:t>oldText</a:t> precisely
  const needle = `<a:t>${oldText}</a:t>`;
  const replacement = `<a:t>${_xmlEscape(newText)}</a:t>`;
  if (xml.indexOf(needle) === -1) {
    // fallback: try with xml:space attr
    const re = new RegExp(`<a:t([^>]*)>${oldText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</a:t>`);
    return xml.replace(re, `<a:t$1>${_xmlEscape(newText)}</a:t>`);
  }
  return xml.replace(needle, replacement);
}

async function exportPPTFromTemplate(analysis, fileName, classSize) {
  if (typeof JSZip === 'undefined') throw new Error('JSZip not loaded');
  if (!window.PPTX_TEMPLATE_B64) throw new Error('Template not loaded');

  // Derive course label from filename: strip extension, "Course Survey-XXXX (Responses)" → "XXXX"
  let courseLabel = (fileName || 'Course').replace(/\.[^.]+$/, '');
  const m = courseLabel.match(/Course Survey[-–\s]*([A-Za-z0-9]+)/i);
  if (m) courseLabel = m[1];

  const total = analysis.totalResponses || 0;
  const qCount = analysis.questionCols.length;
  const overall = analysis.overallAverage != null ? tFix(analysis.overallAverage) : '—';
  // Response rate: respondents / class size (preferred). Fall back to /qCount if class size not set.
  const cs = Number(classSize) || 0;
  const responseRateRaw = cs > 0
    ? (total / cs) * 100
    : (qCount > 0 ? (total / qCount) * 100 : 0);
  // Truncate to 1 decimal (do NOT round): 11.79 → "11.7"
  const responseRate = (Math.floor(responseRateRaw * 10) / 10).toFixed(1);
  const denomLabel = cs > 0 ? cs : qCount;

  // Use up to first 5 categories for the chart (template has 5 bars). If fewer, pad with empty.
  const cats = analysis.categoryAverages.slice(0, 5);
  while (cats.length < 5) cats.push({ label: ' ', average: 0, respondents: 0 });

  const TEMPLATE_LABELS = [
    'Questions about the beginning of the course',
    'Questions about what happened during the course',
    'Course learning outcomes evaluation',
    'Overall Evaluation',
    'E-learning and distance education',
  ];
  const TEMPLATE_VALUES = [
    '4.6266666666666669',
    '4.6472727272727274',
    '4.58',
    '4.5999999999999996',
    '4.7135678391959797',
  ];

  // Build a richer analysis paragraph that dives into category-level issues
  const validCats = cats.filter(c => c.average && c.average > 0);
  const sorted = [...validCats].sort((a, b) => b.average - a.average);
  const strongest = sorted[0];
  const weakest = sorted[sorted.length - 1];
  const meanAvg = validCats.length ? (validCats.reduce((s, c) => s + c.average, 0) / validCats.length) : 0;
  const belowTarget = validCats.filter(c => c.average < 4.0);
  const belowMean = validCats.filter(c => c.average < meanAvg);
  const spread = strongest && weakest ? (strongest.average - weakest.average) : 0;
  const benchmark = 4.0;

  // Helper: prefer the precomputed overall average for the group (true response-level mean)
  const groupOverall = (group) => {
    if (group.overall != null) return group.overall;
    const vals = (group.categories || []).map(c => c.average).filter(v => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const analysisParts = [];

  // ===== Overall narrative =====
  analysisParts.push(
    `The ${courseLabel} course received an overall average (the mean across all dimensions) of ${overall} on the 1\u20135 Likert scale across ${total} respondent${total === 1 ? '' : 's'}` +
    (cs > 0 ? ` out of ${cs} enrolled students` : '') + `, ` +
    (parseFloat(overall) >= benchmark
      ? `meeting the 4.00 institutional benchmark for low-performing dimensions, with clear opportunities to raise averages in specific dimensions.`
      : `falling short of the 4.00 benchmark for low-performing dimensions, which signals systemic issues that warrant immediate attention.`)
  );

  if (strongest && weakest && strongest !== weakest) {
    analysisParts.push(
      `The strongest category average is "${strongest.label.trim()}" at ${tFix(strongest.average)}, while the lowest category average is "${weakest.label.trim()}" at ${tFix(weakest.average)}.`
    );
  }

  // Call out the "Overall Evaluation" dimension specifically (it is one survey dimension, distinct from the overall average across all dimensions)
  const overallEvalCat = analysis.categoryAverages.find(c =>
    /overall evaluation/i.test(c.label || '') || /التقييم العام/.test(c.label || '')
  );
  if (overallEvalCat && overallEvalCat.average != null) {
    analysisParts.push(
      `The "Overall Evaluation" dimension itself averaged ${tFix(overallEvalCat.average)}.`
    );
  }
  // (a) Lowest against the 4.00 benchmark
  if (belowTarget.length > 0) {
    const names = belowTarget.map(c => `"${c.label.trim()}" (${tFix(c.average)})`).join(', ');
    analysisParts.push(`Lowest against the 4.00 benchmark: ${names} fall below the institutional benchmark and require corrective action.`);
  } else {
    analysisParts.push(`Lowest against the 4.00 benchmark: every dimension clears the 4.00 benchmark, so no dimension is flagged as low-performing on this criterion.`);
  }
  // (b) Lowest across all dimensions even if above benchmark
  if (weakest) {
    const tol = 0.01;
    const lowest = validCats.filter(c => Math.abs(c.average - weakest.average) <= tol);
    const names = lowest.map(c => `"${c.label.trim()}" (${tFix(c.average)})`).join(', ');
    const isPlural = lowest.length > 1;
    analysisParts.push(
      `Lowest across all dimensions: ${names} ${isPlural ? 'are' : 'is'} the lowest-scoring dimension${isPlural ? 's' : ''} in the survey, sitting below the course average of ${tFix(meanAvg)} — the most actionable area${isPlural ? 's' : ''} for improvement in the next iteration regardless of the benchmark.`
    );
  }

  // ===== By academic year =====
  const yearGroups = (analysis.bySemester || []).map(g => ({ ...g, overall: groupOverall(g) })).filter(g => g.overall != null);
  if (yearGroups.length >= 2) {
    const ySorted = [...yearGroups].sort((a, b) => b.overall - a.overall);
    const yHi = ySorted[0], yLo = ySorted[ySorted.length - 1];
    const yGap = yHi.overall - yLo.overall;
    analysisParts.push(
      `By academic year: ${yearGroups.map(g => `${g.year} averaged ${tFix(g.overall)}`).join(', ')}. ` +
      (yGap < 0.2
        ? `Year averages are close, suggesting the course experience has been delivered consistently over time.`
        : yGap < 0.5
          ? `The ${yHi.year} cohort recorded a higher average than the ${yLo.year} cohort, a modest year-over-year drift worth monitoring.`
          : `The ${yHi.year} cohort recorded a meaningfully higher average than the ${yLo.year} cohort, suggesting the course experience changed materially between cohorts \u2014 investigate what differed (instructor, syllabus, delivery mode).`)
    );
  } else if (yearGroups.length === 1) {
    analysisParts.push(`By academic year: all responses come from the ${yearGroups[0].year} cohort (average ${tFix(yearGroups[0].overall)}), so year-over-year comparison is not yet possible.`);
  }

  // ===== By gender =====
  const genderGroups = (analysis.byGender || []).map(g => ({ ...g, overall: groupOverall(g) })).filter(g => g.overall != null);
  if (genderGroups.length >= 2) {
    const gSorted = [...genderGroups].sort((a, b) => b.overall - a.overall);
    const gHi = gSorted[0], gLo = gSorted[gSorted.length - 1];
    const gGap = gHi.overall - gLo.overall;
    analysisParts.push(
      `By gender: ${genderGroups.map(g => `${g.gender} respondents averaged ${tFix(g.overall)}`).join(', ')}. ` +
      (gGap < 0.2
        ? `Averages are similar across genders, indicating equitable delivery.`
        : gGap < 0.5
          ? `${gHi.gender} students recorded a higher average than ${gLo.gender} students \u2014 a modest gap worth keeping an eye on.`
          : `${gHi.gender} students recorded a meaningfully higher average than ${gLo.gender} students, large enough to suggest the two groups are having materially different experiences and worth a follow-up.`)
    );
  } else if (genderGroups.length === 1) {
    analysisParts.push(`By gender: all responses come from ${genderGroups[0].gender} respondents (average ${tFix(genderGroups[0].overall)}), so a gender comparison is not possible in this dataset.`);
  }

  // ===== Sample-size caveat (kept concise; no other metrics introduced) =====
  if (total < 10) {
    analysisParts.push(`Note: with only ${total} respondent${total === 1 ? '' : 's'}${cs > 0 ? ` out of ${cs} enrolled` : ''}, the sample is small and findings should be interpreted as directional rather than conclusive.`);
  }

  // ===== Actionable recommendations =====
  const recs = [];

  // Build a recommendation that cites the lowest-scoring question items WITHIN a dimension
  const itemBasedRec = (cat) => {
    if (!cat) return null;
    const full = analysis.categoryAverages.find(c => c.id === cat.id) || cat;
    const qs = (full.questions || []).filter(q => q.average != null);
    if (!qs.length) return `prioritise "${full.label.trim()}" in the next iteration with item-level review and redesigned activities`;
    const qSorted = [...qs].sort((a, b) => a.average - b.average);
    const lowQs = qSorted.slice(0, Math.min(2, qSorted.length));
    // Pull the bracketed/English portion of each item header. If a header is purely Arabic
    // (no Latin letters), DO NOT quote it — keep the recommendation English-only.
    const cleanQ = (h) => {
      let s = String(h || '');
      const m = s.match(/\[([^\]]+)\]/);
      if (m && /[A-Za-z]/.test(m[1])) s = m[1];
      s = s.replace(/^\s*\[[^\]]+\]\s*/, '').replace(/^\s*\([^)]+\)\s*/, '').replace(/\s+/g, ' ').trim();
      return s;
    };
    const isEnglish = (s) => /[A-Za-z]/.test(s);
    const englishItems = lowQs.map(q => ({ avg: q.average, text: cleanQ(q.header) })).filter(o => isEnglish(o.text));
    if (englishItems.length) {
      const items = englishItems.map(o => `"${o.text}" (${tFix(o.avg)})`).join(' and ');
      return `for "${full.label.trim()}", target the lowest-scoring item${englishItems.length > 1 ? 's' : ''} — specifically ${items} — by redesigning the underlying activity, refreshing supporting materials, and adding a short mid-term check on ${englishItems.length > 1 ? 'these items' : 'this item'} to confirm the change lands`;
    }
    // Arabic-only headers — reference by position + averages so no Arabic enters the analysis.
    const itemDesc = lowQs.length > 1
      ? `the two lowest-scoring items in this dimension (averaging ${tFix(lowQs[0].average)} and ${tFix(lowQs[1].average)})`
      : `the lowest-scoring item in this dimension (averaging ${tFix(lowQs[0].average)})`;
    return `for "${full.label.trim()}", target ${itemDesc} by redesigning the underlying activity, refreshing supporting materials, and adding a short mid-term check to confirm the change lands`;
  };

  const targetCats = belowTarget.length > 0 ? belowTarget : (weakest ? [weakest] : []);
  for (const cat of targetCats) {
    const rec = itemBasedRec(cat);
    if (rec) recs.push(rec);
  }
  if (belowTarget.length > 1) {
    recs.push(`convene a teaching-team retrospective on the ${belowTarget.length} sub-4.00 dimensions, agree on two high-impact changes, and schedule a mid-term follow-up survey`);
  }
  // Year recommendation
  if (yearGroups.length >= 2) {
    const ySorted = [...yearGroups].sort((a, b) => b.overall - a.overall);
    const gap = ySorted[0].overall - ySorted[ySorted.length - 1].overall;
    if (gap >= 0.3) {
      recs.push(`document what made the ${ySorted[0].year} delivery stronger than ${ySorted[ySorted.length - 1].year} and bring those practices forward to the next cohort`);
    }
  }
  // Gender recommendation
  if (genderGroups.length >= 2) {
    const gSorted = [...genderGroups].sort((a, b) => b.overall - a.overall);
    const gap = gSorted[0].overall - gSorted[gSorted.length - 1].overall;
    if (gap >= 0.3) {
      recs.push(`run a short follow-up with ${gSorted[gSorted.length - 1].gender} respondents (focus group or open-comment prompt) to understand the ${tFix(gap)}-point gap and surface specific barriers`);
    }
  }
  // Response-rate recommendation
  if (cs > 0 && responseRate < 50) {
    recs.push(`raise the response rate above 50% next term by closing the survey in-class, sending two reminders, and protecting 10 minutes for completion`);
  } else if (cs === 0) {
    recs.push(`record the class enrolment in the analyzer so future reports can express response rate as a true participation percentage`);
  }
  // Positive transfer
  if (parseFloat(overall) >= benchmark && strongest && belowTarget.length === 0) {
    recs.push(`capture what is working in "${strongest.label.trim()}" (materials, pacing, lecture style) and share it as a benchmark exemplar with other courses in the programme`);
  }
  // Mid-term feedback fallback
  if (recs.length < 3) {
    recs.push(`introduce a brief mid-term student-feedback round (3\u20135 short questions) so issues surface early in the next offering rather than only at end-of-course`);
  }

  if (recs.length) {
    const recList = recs.slice(0, 5);
    const recSentence = recList.length === 1
      ? recList[0]
      : recList.slice(0, -1).join(', ') + ', and ' + recList[recList.length - 1];
    analysisParts.push(`Actionable recommendations include ${recSentence}.`);
  }

  const analysisPara = analysisParts.join(' ');

  // Build participant-comments paragraph: synthesize ALL student comments into 2 sentences (English)
  let commentPara;
  const rawComments = (analysis.comments || [])
    .map(c => c.text.replace(/\s+/g, ' ').trim())
    .filter(t => t.length >= 2 && t.length <= 800)
    .filter(t => !/^(no|none|n\/a|na|nothing|nil|\-+|\.+|لا|لا شيء|لا يوجد)\.?$/i.test(t));

  if (rawComments.length === 0) {
    commentPara = 'No open-ended comments were submitted by participants in this survey.';
  } else {
    commentPara = summarizeComments(rawComments) ||
      `Participants submitted ${rawComments.length} open-ended comment${rawComments.length === 1 ? '' : 's'}; please review them directly in the source spreadsheet for qualitative insight.`;
  }

  // Load template
  const zip = await JSZip.loadAsync(_b64ToUint8(window.PPTX_TEMPLATE_B64));

  // ===== slide2.xml: replace text content =====
  const slide2Raw = await zip.file('ppt/slides/slide2.xml').async('string');
  let slide2 = slide2Raw;
  // Course code: "EMAI660" in the header
  slide2 = _replaceText(slide2, 'EMAI660', courseLabel);
  // Two "27" runs in the template: number-of-questions stat (appears twice with hMerge)
  slide2 = slide2.replace(/<a:t>27<\/a:t>/g, `<a:t>${qCount}</a:t>`);
  // Response rate: "93%"
  slide2 = _replaceText(slide2, '93%', `${responseRate}%`);
  // Response fraction: "(25 out of 27)"
  slide2 = _replaceText(slide2, '(25 out of 27)', `(${total} out of ${denomLabel})`);
  // Overall average: "4.65"
  slide2 = _replaceText(slide2, '4.65', overall);
  // Single analysis slide — full text on slide 2, no slide 3 (table-duplication proved unreliable).
  const fullAnalysis = analysisParts.join(' ');

  // Slide 2 = full analysis + chart + comment
  slide2 = slide2.replace(
    /<a:t>The EMAI660 course received an overall evaluation[\s\S]*?most actionable area for improvement in the next iteration\.<\/a:t>/g,
    () => `<a:t>${_xmlEscape(fullAnalysis)}</a:t>`
  );
  slide2 = slide2.replace(
    /<a:t>Selected participant comments:[\s\S]*?<\/a:t>/,
    () => `<a:t>${_xmlEscape(commentPara)}</a:t>`
  );
  zip.file('ppt/slides/slide2.xml', slide2);

  // ===== chart1.xml: replace category labels and values =====
  let chart = await zip.file('ppt/charts/chart1.xml').async('string');
  TEMPLATE_LABELS.forEach((lbl, i) => {
    const newLbl = cats[i].label || ' ';
    chart = chart.replace(
      new RegExp(`<c:v>${lbl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</c:v>`),
      `<c:v>${_xmlEscape(newLbl)}</c:v>`
    );
  });
  TEMPLATE_VALUES.forEach((v, i) => {
    const newV = (cats[i].average != null ? cats[i].average : 0).toString();
    chart = chart.replace(
      new RegExp(`<c:v>${v}</c:v>`),
      `<c:v>${newV}</c:v>`
    );
  });
  zip.file('ppt/charts/chart1.xml', chart);

  // ===== embedded xlsx: rewrite worksheet + sharedStrings to match =====
  try {
    const xlsxBlob = await zip.file('ppt/embeddings/Microsoft_Excel_Worksheet.xlsx').async('blob');
    const xz = await JSZip.loadAsync(await xlsxBlob.arrayBuffer());
    let ss = await xz.file('xl/sharedStrings.xml').async('string');
    // sharedStrings indices 2..6 = the 5 category labels
    TEMPLATE_LABELS.forEach((lbl, i) => {
      const newLbl = cats[i].label || ' ';
      const escLbl = lbl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      ss = ss.replace(
        new RegExp(`<t(?:\\s[^>]*)?>${escLbl}</t>`),
        `<t xml:space="preserve">${_xmlEscape(newLbl)}</t>`
      );
    });
    xz.file('xl/sharedStrings.xml', ss);

    let sheet = await xz.file('xl/worksheets/sheet1.xml').async('string');
    TEMPLATE_VALUES.forEach((v, i) => {
      const newV = (cats[i].average != null ? cats[i].average : 0).toString();
      sheet = sheet.replace(`<v>${v}</v>`, `<v>${newV}</v>`);
    });
    xz.file('xl/worksheets/sheet1.xml', sheet);

    const newXlsxBlob = await xz.generateAsync({ type: 'blob' });
    zip.file('ppt/embeddings/Microsoft_Excel_Worksheet.xlsx', newXlsxBlob);
  } catch (e) {
    console.warn('Could not update embedded xlsx:', e);
  }

  // Save
  const outBlob = await zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  });
  const url = URL.createObjectURL(outBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${courseLabel}-evaluation.pptx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportPPT(analysis, fileName, classSize) {
  // Try template-based export first
  try {
    return await exportPPTFromTemplate(analysis, fileName, classSize);
  } catch (e) {
    console.warn('Template export failed, falling back to generated:', e);
  }
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5

  const COLORS = {
    bg: 'FFFFFF',
    text: '1F1D1A',
    sub: '6A6862',
    accent: '2E6E4A',
    low: 'B6552A',
    track: 'F3F1EC',
    grid: 'EFECE6',
  };

  function addChartSlide(title, cats, segmentLabel) {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.bg };

    // Title
    slide.addText(title, {
      x: 0.5, y: 0.3, w: 12.3, h: 0.6,
      fontSize: 24, bold: true, color: COLORS.text, fontFace: 'Calibri',
    });
    slide.addText(`Average score by category · scale 1–5 · n = ${cats.reduce((s,c)=>s+(c.count||c.respondents||0),0)} answers`, {
      x: 0.5, y: 0.85, w: 12.3, h: 0.3,
      fontSize: 12, color: COLORS.sub, fontFace: 'Calibri',
    });

    // Bar chart
    const chartData = [{
      name: 'Average',
      labels: cats.map(c => c.label),
      values: cats.map(c => c.average !== null ? Number(tFix(c.average)) : 0),
    }];
    slide.addChart(pptx.ChartType.bar, chartData, {
      x: 0.5, y: 1.3, w: 7.5, h: 5.5,
      barDir: 'bar',
      catAxisLabelFontSize: 9,
      valAxisLabelFontSize: 9,
      valAxisMinVal: 0,
      valAxisMaxVal: 5,
      showValue: true,
      dataLabelFontSize: 9,
      dataLabelFormatCode: '0.00',
      chartColors: [COLORS.accent],
      showLegend: false,
      catAxisOrient: 'maxMin',
    });

    // Analysis text
    slide.addText('Analysis', {
      x: 8.3, y: 1.3, w: 4.5, h: 0.35,
      fontSize: 14, bold: true, color: COLORS.text, fontFace: 'Calibri',
    });
    const lines = generateAnalysisText(cats, segmentLabel);
    slide.addText(
      lines.map(l => ({ text: l, options: { bullet: { type: 'bullet' }, paraSpaceAfter: 4 } })),
      { x: 8.3, y: 1.65, w: 4.7, h: 5.2, fontSize: 10.5, color: COLORS.text, fontFace: 'Calibri', valign: 'top' }
    );

    // Data table below chart
    const tableRows = [
      [
        { text: 'Category', options: { bold: true, fill: { color: COLORS.track } } },
        { text: 'Respondents', options: { bold: true, fill: { color: COLORS.track } } },
        { text: 'Average', options: { bold: true, fill: { color: COLORS.track } } },
      ],
      ...cats.map(c => [
        c.label,
        String(c.count || c.respondents || 0),
        c.average !== null ? tFix(c.average) : '—',
      ]),
    ];
  }

  // Slide 1: Overall
  const overallCats = analysis.categoryAverages.map(c => ({
    label: c.label, average: c.average, count: c.respondents,
  }));
  addChartSlide('Overall — category averages', overallCats, 'the overall sample');

  // Slide 2: By gender (one chart with grouped categories per gender)
  {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.bg };
    slide.addText('By gender — category averages', {
      x: 0.5, y: 0.3, w: 12.3, h: 0.6,
      fontSize: 24, bold: true, color: COLORS.text, fontFace: 'Calibri',
    });
    slide.addText(
      analysis.byGender.map(g => `${g.gender}: ${g.count} responses`).join('  ·  '),
      { x: 0.5, y: 0.85, w: 12.3, h: 0.3, fontSize: 12, color: COLORS.sub, fontFace: 'Calibri' }
    );
    const labels = analysis.categoryAverages.map(c => c.label);
    const series = analysis.byGender.map(g => ({
      name: `${g.gender} (n=${g.count})`,
      labels,
      values: g.categories.map(c => c.average !== null ? Number(tFix(c.average)) : 0),
    }));
    slide.addChart(pptx.ChartType.bar, series, {
      x: 0.5, y: 1.3, w: 7.5, h: 5.5,
      barDir: 'bar', barGrouping: 'clustered',
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
      valAxisMinVal: 0, valAxisMaxVal: 5,
      showValue: true, dataLabelFontSize: 8, dataLabelFormatCode: '0.00',
      showLegend: true, legendPos: 'b', legendFontSize: 10,
      catAxisOrient: 'maxMin',
    });

    // Combined analysis: use the whole gender breakdown
    const combined = [];
    analysis.byGender.forEach(g => {
      g.categories.forEach((c, i) => {
        combined.push({ label: `${analysis.categoryAverages[i].label} — ${g.gender}`, average: c.average, count: c.respondents });
      });
    });
    const lines = generateAnalysisText(combined, 'the gender breakdown');
    slide.addText('Analysis', {
      x: 8.3, y: 1.3, w: 4.5, h: 0.35,
      fontSize: 14, bold: true, color: COLORS.text, fontFace: 'Calibri',
    });
    slide.addText(
      lines.map(l => ({ text: l, options: { bullet: { type: 'bullet' }, paraSpaceAfter: 4 } })),
      { x: 8.3, y: 1.65, w: 4.7, h: 5.2, fontSize: 10.5, color: COLORS.text, fontFace: 'Calibri', valign: 'top' }
    );
  }

  // Slide 3: By semester
  {
    const slide = pptx.addSlide();
    slide.background = { color: COLORS.bg };
    slide.addText('By academic year — category averages', {
      x: 0.5, y: 0.3, w: 12.3, h: 0.6,
      fontSize: 24, bold: true, color: COLORS.text, fontFace: 'Calibri',
    });
    slide.addText(
      analysis.bySemester.map(s => `${s.year}: ${s.count} responses`).join('  ·  '),
      { x: 0.5, y: 0.85, w: 12.3, h: 0.3, fontSize: 12, color: COLORS.sub, fontFace: 'Calibri' }
    );
    const labels = analysis.categoryAverages.map(c => c.label);
    const series = analysis.bySemester.map(s => ({
      name: `${s.year} (n=${s.count})`,
      labels,
      values: s.categories.map(c => c.average !== null ? Number(tFix(c.average)) : 0),
    }));
    slide.addChart(pptx.ChartType.bar, series, {
      x: 0.5, y: 1.3, w: 7.5, h: 5.5,
      barDir: 'bar', barGrouping: 'clustered',
      catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
      valAxisMinVal: 0, valAxisMaxVal: 5,
      showValue: true, dataLabelFontSize: 8, dataLabelFormatCode: '0.00',
      showLegend: true, legendPos: 'b', legendFontSize: 10,
      catAxisOrient: 'maxMin',
    });
    const combined = [];
    analysis.bySemester.forEach(s => {
      s.categories.forEach((c, i) => {
        combined.push({ label: `${analysis.categoryAverages[i].label} — ${s.year}`, average: c.average, count: c.respondents });
      });
    });
    const lines = generateAnalysisText(combined, 'the academic-year breakdown');
    slide.addText('Analysis', {
      x: 8.3, y: 1.3, w: 4.5, h: 0.35,
      fontSize: 14, bold: true, color: COLORS.text, fontFace: 'Calibri',
    });
    slide.addText(
      lines.map(l => ({ text: l, options: { bullet: { type: 'bullet' }, paraSpaceAfter: 4 } })),
      { x: 8.3, y: 1.65, w: 4.7, h: 5.2, fontSize: 10.5, color: COLORS.text, fontFace: 'Calibri', valign: 'top' }
    );
  }

  await pptx.writeFile({ fileName: 'survey-analysis.pptx' });
}

// ============ ChartAnalysis component ============
function ChartAnalysis({ cats, label }) {
  const lines = generateAnalysisText(cats, label);
  return (
    <div className="chart-analysis">
      <div className="chart-analysis-title">Analysis</div>
      <ol className="chart-analysis-list">
        {lines.map((l, i) => <li key={i}>{l}</li>)}
      </ol>
    </div>
  );
}

// ============ Main App ============
function App() {
  const [analysis, setAnalysis] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState('overall');
  const [fileName, setFileName] = useState('');
  const [classSize, setClassSize] = useState('');

  const handleFile = useCallback(async (file) => {
    setError(null); setLoading(true); setFileName(file.name);
    try {
      const parsed = await parseFile(file);
      if (parsed.rows.length === 0) {
        setError('No data rows found in file.');
        setAnalysis(null);
      } else {
        const a = analyze(parsed);
        if (a.questionCols.length === 0) {
          setError('No survey questions detected. Make sure the file has columns with Likert responses.');
          setAnalysis(null);
        } else {
          setAnalysis(a);
        }
      }
    } catch (e) {
      console.error(e);
      setError('Failed to parse file: ' + e.message);
      setAnalysis(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSample = useCallback(async () => {
    setLoading(true); setError(null); setFileName('Course Survey-EMAI642 (Responses).xlsx');
    try {
      const res = await fetch('uploads/survey.xlsx');
      const blob = await res.blob();
      const file = new File([blob], 'survey.xlsx');
      const parsed = await parseFile(file);
      const a = analyze(parsed);
      setAnalysis(a);
    } catch (e) {
      setError('Failed to load sample: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = () => { setAnalysis(null); setError(null); setFileName(''); };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
              <line x1="6" y1="20" x2="6" y2="10"/>
              <line x1="12" y1="20" x2="12" y2="4"/>
              <line x1="18" y1="20" x2="18" y2="14"/>
            </svg>
          </div>
          <div>
            <div className="brand-title">Survey Analyzer</div>
            <div className="brand-sub">Course evaluation insights</div>
          </div>
        </div>
        {analysis && (
          <div className="header-actions">
            <span className="file-name" title={fileName}>{fileName}</span>
            <label className="class-size-input" title="Number of students enrolled in the class">
              <span>Class size</span>
              <input
                type="number"
                min="0"
                step="1"
                value={classSize}
                onChange={(e) => setClassSize(e.target.value)}
                placeholder="—"
              />
            </label>
            <button className="btn ghost" onClick={reset}>↺ New file</button>
            <button className="btn ghost" onClick={async () => {
              try { await exportPPT(analysis, fileName, classSize); }
              catch (e) { console.error(e); alert('PPT export failed: ' + e.message); }
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="14" rx="2"/>
                <line x1="8" y1="21" x2="16" y2="21"/>
                <line x1="12" y1="17" x2="12" y2="21"/>
              </svg>
              Export PPT
            </button>
            <button className="btn primary" onClick={async () => {
              try { await exportToExcel(analysis, (fileName.replace(/\.[^.]+$/, '') || 'survey') + '-analysis.xlsx'); }
              catch (e) { console.error(e); alert('Export failed: ' + e.message); }
            }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{marginRight:6}}>
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Export Excel
            </button>
          </div>
        )}
      </header>

      <main className="app-main">
        {!analysis && !loading && <Landing onFile={handleFile} onSample={loadSample} />}
        {loading && (
          <div className="loading">
            <div className="spinner" />
            Analyzing your survey…
          </div>
        )}
        {error && <div className="error">{error}</div>}
        {analysis && <Dashboard analysis={analysis} view={view} setView={setView} classSize={classSize} />}
      </main>

      <footer className="app-footer">
        <div>Built for SER accreditation evidence</div>
        <div className="muted">Files processed locally — nothing leaves your browser.</div>
      </footer>
    </div>
  );
}

function Landing({ onFile, onSample }) {
  return (
    <div className="landing">
      <div className="hero">
        <div className="hero-left">
          <div className="eyebrow">Course evaluation · Likert 1–5</div>
          <h1>Turn raw survey responses into accreditation-ready insights.</h1>
          <p className="lede">
            Upload your Google Forms / Excel export. We auto-detect Likert questions,
            map responses to a 1–5 scale, group them into evaluation categories, and produce
            tables, bar charts, and a downloadable Excel report — broken down by gender and academic year.
          </p>
          <div className="hero-actions">
            <FileUpload onFile={onFile} compact />
            <button className="link-btn" onClick={onSample}>
              Try the EMAI642 sample →
            </button>
          </div>
        </div>
        <div className="hero-right">
          <PreviewMock />
        </div>
      </div>

      <section className="how">
        <div className="section-eyebrow">How it works</div>
        <h2>Four steps from spreadsheet to insight.</h2>
        <ol className="how-steps">
          <li>
            <div className="step-num">01</div>
            <div className="step-body">
              <h3>Upload your file</h3>
              <p>
                Drop in <code>.xlsx</code>, <code>.xls</code>, or <code>.csv</code>. Bilingual
                headers (Arabic / English) are supported. The file is parsed entirely in your
                browser — nothing is uploaded to a server.
              </p>
            </div>
          </li>
          <li>
            <div className="step-num">02</div>
            <div className="step-body">
              <h3>Auto Likert mapping</h3>
              <p>
                Each response cell is converted using the standard 5-point scale:{' '}
                <span className="chip">Strongly Agree → 5</span>{' '}
                <span className="chip">Agree → 4</span>{' '}
                <span className="chip">Somewhat Agree → 3</span>{' '}
                <span className="chip">Disagree → 2</span>{' '}
                <span className="chip">Strongly Disagree → 1</span>{' '}
                <span className="chip muted">"Don't know" → excluded</span>
              </p>
            </div>
          </li>
          <li>
            <div className="step-num">03</div>
            <div className="step-body">
              <h3>Category grouping</h3>
              <p>
                Questions are matched to one of six SER categories using the bracketed prefix
                in each header — Beginning of the course, During the course, Learning outcomes,
                Instructor evaluation, Overall evaluation, and E-learning &amp; distance education.
              </p>
            </div>
          </li>
          <li>
            <div className="step-num">04</div>
            <div className="step-body">
              <h3>Breakdowns &amp; exports</h3>
              <p>
                Compare averages by gender and academic year, drill into individual questions,
                and download everything you need: per-chart PNGs, per-table CSVs, and a
                multi-sheet Excel workbook with the complete analysis.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section className="features">
        <div className="feature">
          <div className="feature-icon">⌖</div>
          <div className="feature-title">Low-performance flagging</div>
          <div className="feature-desc">Any category averaging below 4.00 is highlighted across the dashboard and the Excel report.</div>
        </div>
        <div className="feature">
          <div className="feature-icon">⤓</div>
          <div className="feature-title">Multiple export formats</div>
          <div className="feature-desc">PNG charts, CSV tables, and a structured Excel workbook with Summary · By Gender · By Semester · Questions sheets.</div>
        </div>
        <div className="feature">
          <div className="feature-icon">⚙</div>
          <div className="feature-title">Bilingual aware</div>
          <div className="feature-desc">Recognizes both Arabic and English column prefixes, gender labels, and Likert values out of the box.</div>
        </div>
        <div className="feature">
          <div className="feature-icon">🔒</div>
          <div className="feature-title">Privacy first</div>
          <div className="feature-desc">All parsing and analysis happens in your browser. Nothing is sent anywhere.</div>
        </div>
      </section>
    </div>
  );
}

function PreviewMock() {
  // Static visual of what a result looks like
  const items = [
    { label: 'Instructor evaluation', value: 4.86 },
    { label: 'E-learning & distance', value: 4.75 },
    { label: 'During the course', value: 4.50 },
    { label: 'Learning outcomes', value: 4.31 },
    { label: 'Overall evaluation', value: 4.25 },
    { label: 'Beginning of course', value: 3.67 },
  ];
  return (
    <div className="preview-mock">
      <div className="mock-toolbar">
        <span className="mock-dot" /><span className="mock-dot" /><span className="mock-dot" />
        <span className="mock-title">survey-analysis · category averages</span>
      </div>
      <div className="mock-body">
        {items.map((it, i) => {
          const pct = (it.value / 5) * 100;
          const low = it.value < 4.0;
          return (
            <div key={i} className="mock-row">
              <div className="mock-label">{it.label}</div>
              <div className="mock-track">
                <div className={'mock-fill ' + (low ? 'low' : '')} style={{ width: pct + '%' }} />
              </div>
              <div className="mock-val">{tFix(it.value)}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Dashboard({ analysis, view, setView, classSize }) {
  const lowCats = analysis.categoryAverages.filter(c => c.average !== null && c.average < 4.0);
  const cs = Number(classSize) || 0;
  const responseRate = cs > 0 ? (Math.floor((analysis.totalResponses / cs) * 1000) / 10).toFixed(1) : null;

  const chartData = analysis.categoryAverages.map(c => ({
    label: c.label,
    value: c.average,
    count: c.respondents,
  }));

  // CSV builders
  const csvOverall = () => {
    const rows = [['Category', 'Average', 'Questions', 'Status']];
    analysis.categoryAverages.forEach(c => {
      rows.push([
        c.label,
        c.average !== null ? tFix(c.average) : '',
        c.questionCount,
        c.average !== null && c.average < 4.0 ? 'LOW' : 'OK',
      ]);
    });
    downloadCSV(rows, 'category-averages.csv');
  };
  const csvGender = () => {
    const hdr = ['Category', ...analysis.byGender.map(g => `${g.gender} (n=${g.count})`)];
    const rows = [hdr];
    analysis.categoryAverages.forEach((cat, i) => {
      rows.push([
        cat.label,
        ...analysis.byGender.map(g => {
          const v = g.categories[i].average;
          return v !== null ? tFix(v) : '';
        }),
      ]);
    });
    downloadCSV(rows, 'by-gender.csv');
  };
  const csvSemester = () => {
    const hdr = ['Category', ...analysis.bySemester.map(s => `${s.year} (n=${s.count})`)];
    const rows = [hdr];
    analysis.categoryAverages.forEach((cat, i) => {
      rows.push([
        cat.label,
        ...analysis.bySemester.map(s => {
          const v = s.categories[i].average;
          return v !== null ? tFix(v) : '';
        }),
      ]);
    });
    downloadCSV(rows, 'by-semester.csv');
  };

  return (
    <div className="dash">
      <div className="kpi-row">
        <StatCard
          label="Responses"
          value={analysis.totalResponses}
          sub={responseRate != null ? `${responseRate}% of ${cs} enrolled` : 'set class size →'}
        />
        <StatCard label="Overall average" value={fmt(analysis.overallAverage)} sub="across all questions" accent />
        <StatCard label="Categories" value={analysis.categoryAverages.length} sub={`${analysis.questionCols.length} questions`} />
        <StatCard label="Low-performing" value={lowCats.length} sub="categories under 4.00" />
      </div>

      {lowCats.length > 0 && (
        <div className="alert">
          <div className="alert-icon">⚠</div>
          <div>
            <strong>Categories below the 4.00 threshold:</strong>{' '}
            {lowCats.map((c, i) => (
              <span key={c.id} className="alert-tag">
                {c.label} ({tFix(c.average)}){i < lowCats.length - 1 ? ' · ' : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="tabs">
        <button className={view === 'overall' ? 'tab active' : 'tab'} onClick={() => setView('overall')}>Overall</button>
        <button className={view === 'gender' ? 'tab active' : 'tab'} onClick={() => setView('gender')}>By Gender</button>
        <button className={view === 'semester' ? 'tab active' : 'tab'} onClick={() => setView('semester')}>By Semester</button>
      </div>

      <div className="panel">
        {view === 'overall' && (
          <>
            <BarChart
              data={chartData}
              title="Category averages"
              onDownloadCsv={csvOverall}
            />
            <ChartAnalysis cats={chartData.map(d => ({ label: d.label, average: d.value, count: d.count }))} label="the overall sample" />
            <QuestionDetail analysis={analysis} />
          </>
        )}

        {view === 'gender' && (
          <>
            <h3 className="section-h">Responses per category — split by gender</h3>
            <CategoryTable
              onDownloadCsv={csvGender}
              columns={analysis.byGender.map(g => ({ key: g.gender, label: g.gender, count: g.count }))}
              rows={analysis.categoryAverages.map((cat, i) => ({
                label: cat.label,
                values: Object.fromEntries(analysis.byGender.map(g => [g.gender, g.categories[i].average])),
              }))}
            />
            <div className="chart-grid">
              {analysis.byGender.map(g => (
                <div key={g.gender} className="chart-card">
                  <BarChart
                    title={`${g.gender} · ${g.count} responses`}
                    data={analysis.categoryAverages.map((cat, i) => ({
                      label: cat.label,
                      value: g.categories[i].average,
                      count: g.categories[i].respondents,
                    }))}
                    onDownloadCsv={() => {
                      const rows = [['Category', 'Average']];
                      analysis.categoryAverages.forEach((cat, i) => {
                        const v = g.categories[i].average;
                        rows.push([cat.label, v !== null ? tFix(v) : '']);
                      });
                      downloadCSV(rows, `gender-${g.gender}.csv`);
                    }}
                  />
                  <ChartAnalysis
                    cats={analysis.categoryAverages.map((cat, i) => ({
                      label: cat.label,
                      average: g.categories[i].average,
                      count: g.categories[i].respondents,
                    }))}
                    label={`${g.gender} respondents`}
                  />
                </div>
              ))}
            </div>
          </>
        )}

        {view === 'semester' && (
          <>
            <h3 className="section-h">By academic year</h3>
            <CategoryTable
              onDownloadCsv={csvSemester}
              columns={analysis.bySemester.map(s => ({ key: s.year, label: s.year, count: s.count }))}
              rows={analysis.categoryAverages.map((cat, i) => ({
                label: cat.label,
                values: Object.fromEntries(analysis.bySemester.map(s => [s.year, s.categories[i].average])),
              }))}
            />
            <div className="chart-grid">
              {analysis.bySemester.map(s => (
                <div key={s.year} className="chart-card">
                  <BarChart
                    title={`${s.year} · ${s.count} responses`}
                    data={analysis.categoryAverages.map((cat, i) => ({
                      label: cat.label,
                      value: s.categories[i].average,
                      count: s.categories[i].respondents,
                    }))}
                    onDownloadCsv={() => {
                      const rows = [['Category', 'Average']];
                      analysis.categoryAverages.forEach((cat, i) => {
                        const v = s.categories[i].average;
                        rows.push([cat.label, v !== null ? tFix(v) : '']);
                      });
                      downloadCSV(rows, `year-${s.year}.csv`);
                    }}
                  />
                  <ChartAnalysis
                    cats={analysis.categoryAverages.map((cat, i) => ({
                      label: cat.label,
                      average: s.categories[i].average,
                      count: s.categories[i].respondents,
                    }))}
                    label={`academic year ${s.year}`}
                  />
                </div>
              ))}
            </div>

            {analysis.bySemesterDetail.length > 1 && (
              <>
                <h3 className="section-h" style={{marginTop: 36}}>By specific term</h3>
                <CategoryTable
                  onDownloadCsv={() => {
                    const hdr = ['Category', ...analysis.bySemesterDetail.map(s => `${s.semester} (n=${s.count})`)];
                    const rows = [hdr];
                    analysis.categoryAverages.forEach((cat, i) => {
                      rows.push([cat.label, ...analysis.bySemesterDetail.map(s => {
                        const v = s.categories[i].average;
                        return v !== null ? tFix(v) : '';
                      })]);
                    });
                    downloadCSV(rows, 'by-term.csv');
                  }}
                  columns={analysis.bySemesterDetail.map(s => ({ key: s.semester, label: s.semester, count: s.count }))}
                  rows={analysis.categoryAverages.map((cat, i) => ({
                    label: cat.label,
                    values: Object.fromEntries(analysis.bySemesterDetail.map(s => [s.semester, s.categories[i].average])),
                  }))}
                />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
