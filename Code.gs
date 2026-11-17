/* ============ BAGIAN: Code.gs ============ */
/**
 * =====================================================================
 *  E-VOTING OSIS
 *  Sistem Pemilihan Ketua dan Wakil Ketua OSIS Secara Online
 *  SMP Negeri 2 Soyo Jaya — Kabupaten Morowali Utara
 * ---------------------------------------------------------------------
 *  Code.gs — Backend utama: konfigurasi, routing web app, dan utilitas
 *  bersama yang dipakai oleh semua file .gs lainnya.
 *
 *  Konvensi: fungsi yang diakhiri garis bawah (contoh: sheet_) bersifat
 *  PRIVAT dan tidak dapat dipanggil dari browser melalui google.script.run.
 * =====================================================================
 */

var APP = {
  NAME: 'E-VOTING OSIS',
  SUBTITLE: 'Sistem Pemilihan Ketua dan Wakil Ketua OSIS Secara Online',
  SCHOOL: 'SMP Negeri 2 Soyo Jaya',
  LOCATION: 'Desa Lembah Sumara, Kecamatan Soyo Jaya, Kabupaten Morowali Utara',
  TZ_LABEL: 'WITA',

  // Kosongkan jika script dibuat dari menu Ekstensi > Apps Script di spreadsheet (bound script).
  // Isi dengan ID spreadsheet jika script dibuat terpisah (standalone).
  SPREADSHEET_ID: '',

  DRIVE_FOLDER_NAME: 'E-VOTING OSIS - Media',

  STUDENT_SESSION_MIN: 15,   // masa berlaku sesi siswa (menit)
  ADMIN_SESSION_MIN: 120,    // masa berlaku sesi admin (menit)
  MAX_LOGIN_ATTEMPT: 5,      // batas percobaan login gagal
  LOCKOUT_MIN: 10,           // lama blokir setelah melewati batas (menit)

  ITER_ADMIN: 500,           // iterasi hash password admin
  ITER_PIN: 10               // iterasi hash PIN siswa
};

/* ------------------------------------------------------------------ */
/*  WEB APP                                                            */
/* ------------------------------------------------------------------ */

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  var page = (e && e.parameter && e.parameter.page) ? String(e.parameter.page) : '';
  template.page = page === 'admin' ? 'admin' : 'siswa';
  return template.evaluate()
    .setTitle(APP.NAME + ' — ' + APP.SCHOOL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=5')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.DEFAULT);
}

/** Dipakai oleh template HTML untuk menyisipkan file lain. */
function include(filename) {
  var allowed = ['Style', 'Script', 'Login', 'VotingPage', 'Dashboard'];
  if (allowed.indexOf(filename) === -1) return '';
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/** Menu di spreadsheet agar admin mudah menjalankan setup. */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('E-VOTING OSIS')
      .addItem('1. Setup Database', 'setupDatabase')
      .addItem('2. Buat Akun Admin Awal', 'setupAdmin')
      .addSeparator()
      .addItem('Reset Password Admin Utama', 'resetPasswordAdminUtama')
      .addToUi();
  } catch (err) { /* bukan konteks spreadsheet */ }
}

/* ------------------------------------------------------------------ */
/*  UTILITAS SPREADSHEET                                               */
/* ------------------------------------------------------------------ */

function ss_() {
  if (APP.SPREADSHEET_ID) return SpreadsheetApp.openById(APP.SPREADSHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Spreadsheet tidak ditemukan. Isi APP.SPREADSHEET_ID di Code.gs.');
  return ss;
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Sheet "' + name + '" belum tersedia. Jalankan setupDatabase() terlebih dahulu.');
  return sh;
}

function tz_() {
  return Session.getScriptTimeZone() || 'Asia/Makassar';
}

function now_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd HH:mm:ss');
}

function today_() {
  return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd');
}

/** Mengubah nilai sel menjadi string yang konsisten. */
function cellStr_(v) {
  if (v === null || v === undefined) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') {
    if (isNaN(v.getTime())) return '';
    return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd HH:mm:ss');
  }
  return String(v).trim();
}

/**
 * Membaca seluruh sheet menjadi array objek {HEADER: nilai}.
 * Setiap objek memiliki properti _row (nomor baris di sheet).
 * Semua nilai dikembalikan sebagai string (aman untuk google.script.run).
 */
function readTable_(name) {
  var sh = sheet_(name);
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return { sheet: sh, headers: [], rows: [] };
  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var obj = { _row: i + 1 };
    var empty = true;
    for (var j = 0; j < headers.length; j++) {
      if (!headers[j]) continue;
      var v = cellStr_(values[i][j]);
      obj[headers[j]] = v;
      if (v !== '') empty = false;
    }
    if (!empty) rows.push(obj);
  }
  return { sheet: sh, headers: headers, rows: rows };
}

/** Mencegah formula injection dan menormalkan nilai sebelum ditulis. */
function safeCell_(v) {
  if (v === null || v === undefined) return '';
  var s = String(v);
  return s.replace(/^[=]+/, '');
}

function rowArray_(headers, obj) {
  return headers.map(function (h) {
    if (!h) return '';
    return safeCell_(obj[h]);
  });
}

/** Menulis satu objek ke baris tertentu (format teks agar NIS/NISN/0 di depan aman). */
function writeRow_(sh, headers, rowNum, obj) {
  var range = sh.getRange(rowNum, 1, 1, headers.length);
  range.setNumberFormat('@');
  range.setValues([rowArray_(headers, obj)]);
}

/** Menambahkan objek sebagai baris baru di akhir sheet. */
function appendRow_(sh, headers, obj) {
  var row = sh.getLastRow() + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  writeRow_(sh, headers, row, obj);
  return row;
}

/** Menulis banyak baris sekaligus mulai dari baris tertentu. */
function writeRows_(sh, headers, startRow, objs) {
  if (!objs.length) return;
  var needed = startRow + objs.length - 1;
  if (needed > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), needed - sh.getMaxRows());
  var range = sh.getRange(startRow, 1, objs.length, headers.length);
  range.setNumberFormat('@');
  range.setValues(objs.map(function (o) { return rowArray_(headers, o); }));
}

function uuid_(prefix) {
  return (prefix || '') + Utilities.getUuid().replace(/-/g, '').slice(0, 10).toUpperCase();
}

/** Membersihkan input teks dari karakter kontrol dan membatasi panjang. */
function clean_(v, max, multiline) {
  var s = (v === null || v === undefined) ? '' : String(v);
  if (multiline) {
    s = s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ');
  } else {
    s = s.replace(/[\u0000-\u001F\u007F]/g, ' ');
  }
  s = s.trim();
  if (max && s.length > max) s = s.slice(0, max);
  return s;
}

/** Menjalankan fungsi di dalam ScriptLock (satu proses tulis pada satu waktu). */
function withLock_(fn) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Server sedang sibuk melayani pemilih lain. Silakan coba lagi beberapa detik lagi.');
  }
  try {
    var result = fn();
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** Mengubah "yyyy-MM-dd HH:mm[:ss]" menjadi Date (zona waktu script). */
function parseDate_(s) {
  if (!s) return null;
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  var d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return isNaN(d.getTime()) ? null : d;
}

/** Normalisasi input datetime-local ("2026-11-20T07:30") menjadi "2026-11-20 07:30". */
function normalizeDateInput_(s) {
  s = clean_(s, 30);
  if (!s) return '';
  var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) throw new Error('Format tanggal/waktu tidak valid.');
  return m[1] + '-' + m[2] + '-' + m[3] + ' ' + m[4] + ':' + m[5];
}

/** Mencatat aktivitas ke sheet LOG_AKTIVITAS (tidak pernah menggagalkan proses utama). */
function log_(user, aktivitas, keterangan) {
  try {
    var sh = sheet_(SHEETS.LOG);
    sh.appendRow([
      uuid_('LOG-'),
      now_(),
      safeCell_(clean_(user, 60)),
      safeCell_(clean_(aktivitas, 80)),
      safeCell_(clean_(keterangan, 300))
    ]);
  } catch (err) {
    console.error('Gagal mencatat log: ' + err);
  }
}

/** Fungsi tertentu hanya boleh dijalankan pemilik dari editor/menu spreadsheet. */
function ensureEditor_() {
  var active = '', effective = '';
  try {
    active = Session.getActiveUser().getEmail();
    effective = Session.getEffectiveUser().getEmail();
  } catch (err) { /* abaikan */ }
  if (!active || active !== effective) {
    throw new Error('Fungsi ini hanya dapat dijalankan oleh pemilik spreadsheet melalui editor Apps Script.');
  }
}

/** Mengubah tautan Google Drive menjadi URL gambar yang bisa ditampilkan. */
function normalizeImageUrl_(url) {
  url = clean_(url, 500);
  if (!url) return '';
  var m = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || url.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  if (m && /drive\.google\.com|docs\.google\.com/.test(url)) {
    return 'https://lh3.googleusercontent.com/d/' + m[1];
  }
  if (!/^https:\/\//i.test(url)) throw new Error('URL gambar harus diawali https://');
  return url;
}

function naturalCompare_(a, b) {
  return String(a).localeCompare(String(b), 'id', { numeric: true, sensitivity: 'base' });
}


/* ============ BAGIAN: Database.gs ============ */
/**
 * =====================================================================
 *  Database.gs — Struktur database, pembuatan sheet otomatis,
 *  dan pengelolaan data PENGATURAN.
 * =====================================================================
 */

var SHEETS = {
  PENGATURAN: 'PENGATURAN',
  SISWA: 'DATA_SISWA',
  KANDIDAT: 'KANDIDAT',
  HASIL: 'HASIL_VOTING',
  LOG: 'LOG_AKTIVITAS',
  ADMIN: 'ADMIN'
};

var SCHEMA = {};
SCHEMA[SHEETS.PENGATURAN] = ['ID', 'NAMA_SEKOLAH', 'TAHUN_PEMILIHAN', 'JUDUL_PEMILIHAN', 'TANGGAL_MULAI',
  'TANGGAL_SELESAI', 'STATUS_VOTING', 'LOGO_SEKOLAH', 'FOTO_BANNER', 'PESAN_SELESAI'];
SCHEMA[SHEETS.SISWA] = ['ID_SISWA', 'NIS', 'NISN', 'NAMA_SISWA', 'KELAS', 'PASSWORD/PIN', 'STATUS_AKUN',
  'STATUS_MEMILIH', 'WAKTU_MEMILIH'];
SCHEMA[SHEETS.KANDIDAT] = ['ID_KANDIDAT', 'NOMOR_URUT', 'NAMA_KETUA', 'NAMA_WAKIL', 'KELAS', 'FOTO_KANDIDAT',
  'VISI', 'MISI', 'PROGRAM_KERJA', 'STATUS_KANDIDAT'];
SCHEMA[SHEETS.HASIL] = ['ID_SUARA', 'ID_KANDIDAT', 'NOMOR_URUT', 'WAKTU_VOTING', 'TAHUN_PEMILIHAN'];
SCHEMA[SHEETS.LOG] = ['ID_LOG', 'WAKTU', 'USER', 'AKTIVITAS', 'KETERANGAN'];
SCHEMA[SHEETS.ADMIN] = ['ID_ADMIN', 'USERNAME', 'PASSWORD_HASH', 'NAMA_ADMIN', 'ROLE', 'STATUS'];

var STATUS = {
  BELUM_DIBUKA: 'BELUM DIBUKA',
  DIBUKA: 'DIBUKA',
  DITUTUP: 'DITUTUP',
  AKTIF: 'AKTIF',
  NONAKTIF: 'NONAKTIF',
  SUDAH: 'SUDAH MEMILIH',
  BELUM: 'BELUM MEMILIH'
};

/**
 * Membuat semua sheet yang belum ada, memasang header, format teks,
 * proteksi sheet, baris pengaturan default, dan akun admin awal.
 * Aman dijalankan berulang kali (tidak menghapus data).
 */
function setupDatabase() {
  ensureEditor_();
  var ss = ss_();
  var report = [];

  Object.keys(SCHEMA).forEach(function (name) {
    var headers = SCHEMA[name];
    var sh = ss.getSheetByName(name);
    var created = false;
    if (!sh) {
      sh = ss.insertSheet(name);
      created = true;
    }

    var lastCol = sh.getLastColumn();
    var current = lastCol > 0 ? sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); }) : [];
    var isEmptyHeader = current.join('') === '';

    if (isEmptyHeader) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      current = headers.slice();
    } else {
      // Tambahkan kolom yang belum ada tanpa mengubah kolom lama
      headers.forEach(function (h) {
        if (current.indexOf(h) === -1) {
          current.push(h);
          sh.getRange(1, current.length).setValue(h);
        }
      });
    }

    var headerRange = sh.getRange(1, 1, 1, current.length);
    headerRange.setFontWeight('bold').setBackground('#0b2a5b').setFontColor('#ffffff')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);

    // Format seluruh kolom data sebagai teks (NIS/NISN dengan angka 0 di depan tetap aman)
    if (sh.getMaxRows() > 1) {
      sh.getRange(2, 1, sh.getMaxRows() - 1, current.length).setNumberFormat('@');
    }
    try { sh.autoResizeColumns(1, current.length); } catch (err) { /* abaikan */ }

    protectSheet_(sh);
    report.push((created ? 'Dibuat: ' : 'Diperiksa: ') + name);
  });

  // Hapus sheet bawaan kosong (Sheet1 / Lembar1)
  ['Sheet1', 'Lembar1', 'Lembar 1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  getSettingsRaw_(); // membuat baris pengaturan default jika belum ada
  pepper_();         // membuat kunci rahasia hash jika belum ada

  var adminMsg = setupAdmin();
  report.push(adminMsg);
  log_('SYSTEM', 'SETUP DATABASE', report.join(' | '));

  var msg = 'Setup database selesai.\n\n' + report.join('\n');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { /* dijalankan dari editor */ }
  return msg;
}

/** Proteksi sheet: hanya pemilik (dan script) yang dapat mengedit. */
function protectSheet_(sh) {
  try {
    var existing = sh.getProtections(SpreadsheetApp.ProtectionType.SHEET);
    var p = existing.length ? existing[0] : sh.protect();
    p.setDescription('Dilindungi oleh E-VOTING OSIS');
    var me = Session.getEffectiveUser();
    p.addEditor(me);
    var editors = p.getEditors().filter(function (u) { return u.getEmail() !== me.getEmail(); });
    if (editors.length) p.removeEditors(editors);
    if (p.canDomainEdit()) p.setDomainEdit(false);
  } catch (err) {
    console.warn('Proteksi sheet ' + sh.getName() + ' dilewati: ' + err);
  }
}

/* ------------------------------------------------------------------ */
/*  PENGATURAN                                                         */
/* ------------------------------------------------------------------ */

function defaultSettings_() {
  return {
    ID: '1',
    NAMA_SEKOLAH: APP.SCHOOL,
    TAHUN_PEMILIHAN: String(new Date().getFullYear()),
    JUDUL_PEMILIHAN: 'Pemilihan Ketua dan Wakil Ketua OSIS',
    TANGGAL_MULAI: '',
    TANGGAL_SELESAI: '',
    STATUS_VOTING: STATUS.BELUM_DIBUKA,
    LOGO_SEKOLAH: '',
    FOTO_BANNER: '',
    PESAN_SELESAI: 'Terima kasih telah menggunakan hak suaramu. Pilihanmu menentukan masa depan OSIS kita!'
  };
}

/** Mengambil baris pengaturan (membuat default bila belum ada). */
function getSettingsRaw_() {
  var t = readTable_(SHEETS.PENGATURAN);
  if (!t.rows.length) {
    var headers = t.headers.length ? t.headers : SCHEMA[SHEETS.PENGATURAN];
    var def = defaultSettings_();
    def._row = appendRow_(t.sheet, headers, def);
    return def;
  }
  var row = t.rows[0];
  var defs = defaultSettings_();
  Object.keys(defs).forEach(function (k) {
    if (row[k] === undefined) row[k] = '';
  });
  if (!row.STATUS_VOTING) row.STATUS_VOTING = STATUS.BELUM_DIBUKA;
  if (!row.NAMA_SEKOLAH) row.NAMA_SEKOLAH = APP.SCHOOL;
  if (!row.TAHUN_PEMILIHAN) row.TAHUN_PEMILIHAN = defs.TAHUN_PEMILIHAN;
  row.TANGGAL_MULAI = trimSeconds_(row.TANGGAL_MULAI);
  row.TANGGAL_SELESAI = trimSeconds_(row.TANGGAL_SELESAI);
  return row;
}

function trimSeconds_(s) {
  var m = String(s || '').match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
  return m ? m[1] : String(s || '');
}

function saveSettingsRaw_(obj) {
  var t = readTable_(SHEETS.PENGATURAN);
  var row = obj._row || (t.rows[0] && t.rows[0]._row) || 2;
  writeRow_(t.sheet, t.headers, row, obj);
}

/** Data pengaturan yang aman dikirim ke browser (tanpa data sensitif). */
function settingsPublic_(st) {
  return {
    APP_NAME: APP.NAME,
    SUBTITLE: APP.SUBTITLE,
    LOKASI: APP.LOCATION,
    TZ_LABEL: APP.TZ_LABEL,
    NAMA_SEKOLAH: st.NAMA_SEKOLAH,
    TAHUN_PEMILIHAN: st.TAHUN_PEMILIHAN,
    JUDUL_PEMILIHAN: st.JUDUL_PEMILIHAN,
    TANGGAL_MULAI: st.TANGGAL_MULAI,
    TANGGAL_SELESAI: st.TANGGAL_SELESAI,
    STATUS_VOTING: st.STATUS_VOTING,
    LOGO_SEKOLAH: st.LOGO_SEKOLAH,
    FOTO_BANNER: st.FOTO_BANNER,
    PESAN_SELESAI: st.PESAN_SELESAI,
    WINDOW: votingWindow_(st),
    SERVER_TIME: now_()
  };
}

/** PUBLIK: informasi pengaturan untuk halaman login & voting. */
function getSettings() {
  return settingsPublic_(getSettingsRaw_());
}


/* ============ BAGIAN: Auth.gs ============ */
/**
 * =====================================================================
 *  Auth.gs — Login siswa & admin, session bermasa berlaku,
 *  hashing password/PIN, pembatasan percobaan login, dan kontrol role.
 * =====================================================================
 */

var ROLES = {
  SUPER: 'SUPERADMIN',
  PANITIA: 'PANITIA'
};

/* ------------------------------------------------------------------ */
/*  HASHING                                                            */
/* ------------------------------------------------------------------ */

function sha256_(text) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  var out = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = bytes[i] < 0 ? bytes[i] + 256 : bytes[i];
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

/** Kunci rahasia (pepper) disimpan di Script Properties, bukan di spreadsheet. */
function pepper_() {
  var props = PropertiesService.getScriptProperties();
  var p = props.getProperty('EV_PEPPER');
  if (!p) {
    p = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    props.setProperty('EV_PEPPER', p);
  }
  return p;
}

/** Format tersimpan: v1$iterasi$salt$hash */
function hashSecret_(secret, iterations) {
  iterations = iterations || APP.ITER_PIN;
  var salt = Utilities.getUuid().replace(/-/g, '').slice(0, 16);
  return 'v1$' + iterations + '$' + salt + '$' + digest_(secret, salt, iterations);
}

function digest_(secret, salt, iterations) {
  var pep = pepper_();
  var h = sha256_(pep + '|' + salt + '|' + String(secret));
  for (var i = 1; i < iterations; i++) h = sha256_(salt + h);
  return h;
}

function verifySecret_(secret, stored) {
  secret = String(secret || '');
  stored = String(stored || '');
  if (!secret || !stored) return false;
  if (stored.indexOf('v1$') !== 0) {
    // PIN/password diketik manual di spreadsheet (belum di-hash)
    return safeEqual_(secret, stored);
  }
  var parts = stored.split('$');
  if (parts.length !== 4) return false;
  return safeEqual_(digest_(secret, parts[2], Number(parts[1]) || 1), parts[3]);
}

function safeEqual_(a, b) {
  a = String(a); b = String(b);
  var diff = a.length ^ b.length;
  var len = Math.max(a.length, b.length);
  for (var i = 0; i < len; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function generatePin_() {
  var pin = '';
  while (pin.length < 6) {
    var hex = Utilities.getUuid().replace(/[^0-9]/g, '');
    pin += hex;
  }
  pin = pin.slice(0, 6);
  if (/^(\d)\1{5}$/.test(pin) || pin === '123456') return generatePin_();
  return pin;
}

/* ------------------------------------------------------------------ */
/*  SESSION                                                            */
/* ------------------------------------------------------------------ */

function createSession_(data, minutes) {
  var token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  data.exp = Date.now() + minutes * 60000;
  data.ttl = minutes;
  CacheService.getScriptCache().put('SES_' + token, JSON.stringify(data), Math.min(21600, minutes * 60));
  return token;
}

function getSession_(token) {
  if (!token || typeof token !== 'string' || token.length !== 64 || !/^[a-f0-9]+$/.test(token)) return null;
  var cache = CacheService.getScriptCache();
  var raw = cache.get('SES_' + token);
  if (!raw) return null;
  var s;
  try { s = JSON.parse(raw); } catch (err) { return null; }
  if (!s.exp || s.exp < Date.now()) {
    cache.remove('SES_' + token);
    return null;
  }
  // Perpanjang sesi selama pengguna aktif (sliding expiration)
  s.exp = Date.now() + s.ttl * 60000;
  cache.put('SES_' + token, JSON.stringify(s), Math.min(21600, s.ttl * 60));
  return s;
}

function destroySession_(token) {
  if (token && typeof token === 'string') CacheService.getScriptCache().remove('SES_' + token);
}

/** PUBLIK: keluar dari sesi. */
function logout(token) {
  var s = getSession_(token);
  if (s && s.type === 'admin') log_(s.username, 'LOGOUT ADMIN', '');
  destroySession_(token);
  return true;
}

function requireStudent_(token) {
  var s = getSession_(token);
  if (!s || s.type !== 'siswa') throw new Error('SESSION_EXPIRED: Sesi Anda telah berakhir. Silakan masuk kembali.');
  return s;
}

/**
 * Memastikan token milik admin aktif. roles (opsional) membatasi role tertentu.
 * Status admin dicek ulang dari sheet agar admin yang dinonaktifkan langsung terputus.
 */
function requireAdmin_(token, roles) {
  var s = getSession_(token);
  if (!s || s.type !== 'admin') throw new Error('SESSION_EXPIRED: Sesi admin berakhir. Silakan masuk kembali.');
  var admin = null;
  readTable_(SHEETS.ADMIN).rows.forEach(function (r) { if (r.ID_ADMIN === s.id) admin = r; });
  if (!admin || admin.STATUS !== STATUS.AKTIF) {
    destroySession_(token);
    throw new Error('SESSION_EXPIRED: Akun admin tidak aktif.');
  }
  s.role = admin.ROLE;
  s.nama = admin.NAMA_ADMIN;
  if (roles && roles.indexOf(s.role) === -1) {
    throw new Error('Akses ditolak. Fitur ini hanya untuk ' + roles.join('/') + '.');
  }
  return s;
}

/* ------------------------------------------------------------------ */
/*  PEMBATASAN PERCOBAAN LOGIN                                         */
/* ------------------------------------------------------------------ */

function failCount_(key) {
  return Number(CacheService.getScriptCache().get('FAIL_' + key) || 0);
}

function addFail_(key) {
  var n = failCount_(key) + 1;
  CacheService.getScriptCache().put('FAIL_' + key, String(n), APP.LOCKOUT_MIN * 60);
  return n;
}

function clearFail_(key) {
  CacheService.getScriptCache().remove('FAIL_' + key);
}

/* ------------------------------------------------------------------ */
/*  LOGIN SISWA                                                        */
/* ------------------------------------------------------------------ */

/**
 * PUBLIK: login siswa dengan NIS/NISN + PIN.
 * Mengembalikan objek {status, message, ...}. Status:
 * OK | INVALID | LOCKED | INACTIVE | ALREADY_VOTED | NOT_OPEN | CLOSED
 */
function loginSiswa(identifier, pin) {
  identifier = clean_(identifier, 30).replace(/\s+/g, '');
  pin = clean_(pin, 20).replace(/\s+/g, '');
  if (!identifier || !pin) return { status: 'INVALID', message: 'NIS/NISN dan PIN wajib diisi.' };

  var key = 'S_' + identifier.toLowerCase();
  if (failCount_(key) >= APP.MAX_LOGIN_ATTEMPT) {
    return { status: 'LOCKED', message: 'Terlalu banyak percobaan yang salah. Tunggu ' + APP.LOCKOUT_MIN + ' menit atau hubungi panitia.' };
  }

  var table = readTable_(SHEETS.SISWA);
  var student = null;
  for (var i = 0; i < table.rows.length; i++) {
    var r = table.rows[i];
    if (r.NIS === identifier || (r.NISN && r.NISN === identifier)) { student = r; break; }
  }

  if (!student || !verifySecret_(pin, student['PASSWORD/PIN'])) {
    var n = addFail_(key);
    var left = APP.MAX_LOGIN_ATTEMPT - n;
    if (left <= 0) log_(identifier, 'LOGIN SISWA DIBLOKIR', 'Melewati batas percobaan login');
    return {
      status: left <= 0 ? 'LOCKED' : 'INVALID',
      message: left <= 0
        ? 'Terlalu banyak percobaan yang salah. Tunggu ' + APP.LOCKOUT_MIN + ' menit atau hubungi panitia.'
        : 'NIS/NISN atau PIN salah. Sisa percobaan: ' + left + '.'
    };
  }
  clearFail_(key);

  // PIN yang diketik manual di spreadsheet otomatis diamankan menjadi hash
  if (String(student['PASSWORD/PIN']).indexOf('v1$') !== 0) {
    try {
      withLock_(function () {
        var fresh = readTable_(SHEETS.SISWA);
        fresh.rows.forEach(function (row) {
          if (row.ID_SISWA === student.ID_SISWA) {
            row['PASSWORD/PIN'] = hashSecret_(pin, APP.ITER_PIN);
            writeRow_(fresh.sheet, fresh.headers, row._row, row);
          }
        });
      });
    } catch (err) { console.warn(err); }
  }

  if (student.STATUS_AKUN && student.STATUS_AKUN !== STATUS.AKTIF) {
    return { status: 'INACTIVE', message: 'Akun Anda tidak aktif. Silakan hubungi panitia pemilihan.' };
  }

  if (student.STATUS_MEMILIH === STATUS.SUDAH) {
    return {
      status: 'ALREADY_VOTED',
      message: 'Hak suara Anda sudah digunakan' + (student.WAKTU_MEMILIH ? ' pada ' + student.WAKTU_MEMILIH : '') +
        '. Setiap siswa hanya dapat memilih satu kali. Terima kasih telah berpartisipasi.'
    };
  }

  var settings = getSettingsRaw_();
  var win = votingWindow_(settings);
  if (win.state !== 'OPEN') {
    return { status: win.state, message: win.message, settings: settingsPublic_(settings) };
  }

  var token = createSession_({ type: 'siswa', id: student.ID_SISWA }, APP.STUDENT_SESSION_MIN);
  log_(student.NIS, 'LOGIN SISWA', 'Kelas ' + student.KELAS);
  return {
    status: 'OK',
    token: token,
    student: { NAMA_SISWA: student.NAMA_SISWA, KELAS: student.KELAS, NIS: student.NIS },
    settings: settingsPublic_(settings)
  };
}

/** PUBLIK: memeriksa sesi siswa yang tersimpan (misal setelah halaman di-refresh). */
function checkStudentSession(token) {
  var s = requireStudent_(token);
  var student = null;
  readTable_(SHEETS.SISWA).rows.forEach(function (r) { if (r.ID_SISWA === s.id) student = r; });
  if (!student || student.STATUS_MEMILIH === STATUS.SUDAH || student.STATUS_AKUN !== STATUS.AKTIF) {
    destroySession_(token);
    throw new Error('SESSION_EXPIRED: Sesi tidak berlaku lagi.');
  }
  return { NAMA_SISWA: student.NAMA_SISWA, KELAS: student.KELAS, NIS: student.NIS };
}

/* ------------------------------------------------------------------ */
/*  LOGIN ADMIN                                                        */
/* ------------------------------------------------------------------ */

/** PUBLIK: login admin. Melempar error jika gagal. */
function loginAdmin(username, password) {
  username = clean_(username, 50).toLowerCase();
  password = String(password || '').slice(0, 100);
  if (!username || !password) throw new Error('Username dan password wajib diisi.');

  var key = 'A_' + username;
  if (failCount_(key) >= APP.MAX_LOGIN_ATTEMPT) {
    throw new Error('Akun dikunci sementara karena terlalu banyak percobaan gagal. Coba lagi dalam ' + APP.LOCKOUT_MIN + ' menit.');
  }

  var admin = null;
  readTable_(SHEETS.ADMIN).rows.forEach(function (r) {
    if (String(r.USERNAME).toLowerCase() === username) admin = r;
  });

  if (!admin || !verifySecret_(password, admin.PASSWORD_HASH)) {
    var n = addFail_(key);
    log_(username, 'LOGIN ADMIN GAGAL', 'Percobaan ke-' + n);
    throw new Error('Username atau password salah.');
  }
  if (admin.STATUS !== STATUS.AKTIF) throw new Error('Akun admin dinonaktifkan.');
  clearFail_(key);

  if (String(admin.PASSWORD_HASH).indexOf('v1$') !== 0) {
    var t = readTable_(SHEETS.ADMIN);
    t.rows.forEach(function (r) {
      if (r.ID_ADMIN === admin.ID_ADMIN) {
        r.PASSWORD_HASH = hashSecret_(password, APP.ITER_ADMIN);
        writeRow_(t.sheet, t.headers, r._row, r);
      }
    });
  }

  var token = createSession_({
    type: 'admin', id: admin.ID_ADMIN, username: admin.USERNAME, role: admin.ROLE
  }, APP.ADMIN_SESSION_MIN);
  log_(admin.USERNAME, 'LOGIN ADMIN', 'Role ' + admin.ROLE);

  return {
    token: token,
    admin: adminPublic_(admin),
    settings: settingsPublic_(getSettingsRaw_()),
    usingDefaultPassword: (admin.USERNAME === DEFAULT_ADMIN.USERNAME && password === DEFAULT_ADMIN.PASSWORD)
  };
}

/** PUBLIK: memeriksa sesi admin yang tersimpan. */
function checkAdminSession(token) {
  var s = requireAdmin_(token);
  var admin = null;
  readTable_(SHEETS.ADMIN).rows.forEach(function (r) { if (r.ID_ADMIN === s.id) admin = r; });
  return { admin: adminPublic_(admin), settings: settingsPublic_(getSettingsRaw_()) };
}

function adminPublic_(a) {
  return { ID_ADMIN: a.ID_ADMIN, USERNAME: a.USERNAME, NAMA_ADMIN: a.NAMA_ADMIN, ROLE: a.ROLE, STATUS: a.STATUS };
}

/** PUBLIK: admin mengganti password sendiri. */
function changePassword(token, oldPassword, newPassword) {
  var s = requireAdmin_(token);
  newPassword = String(newPassword || '');
  validatePassword_(newPassword);
  var t = readTable_(SHEETS.ADMIN);
  var done = false;
  t.rows.forEach(function (r) {
    if (r.ID_ADMIN === s.id) {
      if (!verifySecret_(oldPassword, r.PASSWORD_HASH)) throw new Error('Password lama salah.');
      r.PASSWORD_HASH = hashSecret_(newPassword, APP.ITER_ADMIN);
      writeRow_(t.sheet, t.headers, r._row, r);
      done = true;
    }
  });
  if (!done) throw new Error('Akun tidak ditemukan.');
  log_(s.username, 'GANTI PASSWORD', 'Password admin diperbarui');
  return true;
}

function validatePassword_(pw) {
  if (pw.length < 8) throw new Error('Password minimal 8 karakter.');
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) throw new Error('Password harus mengandung huruf dan angka.');
}


/* ============ BAGIAN: Voting.gs ============ */
/**
 * =====================================================================
 *  Voting.gs — Status jadwal pemilihan, daftar kandidat,
 *  dan proses pemungutan suara (submitVote) yang aman.
 * =====================================================================
 */

/**
 * Menentukan apakah pemungutan suara sedang berlangsung.
 * state: OPEN | NOT_OPEN | CLOSED
 */
function votingWindow_(st) {
  var status = st.STATUS_VOTING || STATUS.BELUM_DIBUKA;
  var start = parseDate_(st.TANGGAL_MULAI);
  var end = parseDate_(st.TANGGAL_SELESAI);
  var now = new Date();
  var jadwal = '';
  if (start || end) {
    jadwal = ' Jadwal: ' + (st.TANGGAL_MULAI || '-') + ' s.d. ' + (st.TANGGAL_SELESAI || '-') + ' ' + APP.TZ_LABEL + '.';
  }

  if (status === STATUS.DITUTUP) {
    return { state: 'CLOSED', message: 'Pemungutan suara telah ditutup. Terima kasih atas partisipasi seluruh siswa.' };
  }
  if (status !== STATUS.DIBUKA) {
    return { state: 'NOT_OPEN', message: 'Pemungutan suara belum dibuka oleh panitia.' + jadwal };
  }
  if (start && now < start) {
    return { state: 'NOT_OPEN', message: 'Pemungutan suara belum dimulai.' + jadwal };
  }
  if (end && now > end) {
    return { state: 'CLOSED', message: 'Waktu pemungutan suara telah berakhir.' + jadwal };
  }
  return { state: 'OPEN', message: 'Pemungutan suara sedang berlangsung.' };
}

function candidatePublic_(c) {
  return {
    ID_KANDIDAT: c.ID_KANDIDAT,
    NOMOR_URUT: c.NOMOR_URUT,
    NAMA_KETUA: c.NAMA_KETUA,
    NAMA_WAKIL: c.NAMA_WAKIL,
    KELAS: c.KELAS,
    FOTO_KANDIDAT: c.FOTO_KANDIDAT,
    VISI: c.VISI,
    MISI: c.MISI,
    PROGRAM_KERJA: c.PROGRAM_KERJA,
    STATUS_KANDIDAT: c.STATUS_KANDIDAT
  };
}

function sortCandidates_(list) {
  return list.sort(function (a, b) { return (Number(a.NOMOR_URUT) || 999) - (Number(b.NOMOR_URUT) || 999); });
}

/**
 * PUBLIK: daftar kandidat.
 * - Token siswa  → hanya kandidat AKTIF (tanpa jumlah suara).
 * - Token admin  → semua kandidat.
 */
function getCandidates(token) {
  var s = getSession_(token);
  if (!s) throw new Error('SESSION_EXPIRED: Sesi berakhir. Silakan masuk kembali.');
  var rows = readTable_(SHEETS.KANDIDAT).rows;
  if (s.type === 'admin') {
    requireAdmin_(token);
    return sortCandidates_(rows.map(candidatePublic_));
  }
  return sortCandidates_(rows.filter(function (c) {
    return c.STATUS_KANDIDAT === STATUS.AKTIF;
  }).map(candidatePublic_));
}

/**
 * PUBLIK: menyimpan suara siswa.
 * Keamanan:
 *  1. Token sesi siswa wajib valid (identitas tidak pernah diambil dari browser).
 *  2. ScriptLock — hanya satu suara diproses pada satu waktu → tidak ada double voting.
 *  3. Status siswa, akun, jadwal, dan kandidat divalidasi ulang di server di dalam lock.
 *  4. Suara disimpan TANPA identitas siswa, pada posisi baris acak, dengan waktu
 *     tanggal saja, sehingga urutan/waktu tidak dapat dicocokkan dengan DATA_SISWA.
 *  5. Jika penandaan siswa gagal, suara yang baru ditulis dibatalkan (rollback).
 */
function submitVote(token, idKandidat) {
  var session = requireStudent_(token);
  idKandidat = clean_(idKandidat, 40);
  if (!idKandidat) throw new Error('Pilihan kandidat tidak valid.');

  var result = withLock_(function () {
    var settings = getSettingsRaw_();
    var win = votingWindow_(settings);
    if (win.state !== 'OPEN') throw new Error(win.message);

    // Validasi ulang siswa dari spreadsheet (bukan dari browser)
    var students = readTable_(SHEETS.SISWA);
    var student = null;
    students.rows.forEach(function (r) { if (r.ID_SISWA === session.id) student = r; });
    if (!student) throw new Error('Data siswa tidak ditemukan.');
    if (student.STATUS_AKUN !== STATUS.AKTIF) throw new Error('Akun Anda tidak aktif.');
    if (student.STATUS_MEMILIH === STATUS.SUDAH) {
      throw new Error('ALREADY_VOTED: Hak suara Anda sudah digunakan. Suara tidak dapat dikirim dua kali.');
    }

    // Validasi kandidat
    var cand = null;
    readTable_(SHEETS.KANDIDAT).rows.forEach(function (c) { if (c.ID_KANDIDAT === idKandidat) cand = c; });
    if (!cand || cand.STATUS_KANDIDAT !== STATUS.AKTIF) throw new Error('Kandidat tidak valid atau tidak aktif.');

    // Simpan suara pada posisi acak (memutus korelasi urutan dengan waktu login/memilih)
    var vsh = sheet_(SHEETS.HASIL);
    var vHeaders = vsh.getRange(1, 1, 1, vsh.getLastColumn()).getValues()[0].map(String);
    var last = vsh.getLastRow();
    var pos = 2 + Math.floor(Math.random() * last); // antara 2 .. last+1
    if (pos <= last) {
      vsh.insertRowBefore(pos);
    } else if (pos > vsh.getMaxRows()) {
      vsh.insertRowsAfter(vsh.getMaxRows(), 1);
    }
    var vote = {
      ID_SUARA: uuid_('V-') + uuid_(''),
      ID_KANDIDAT: cand.ID_KANDIDAT,
      NOMOR_URUT: cand.NOMOR_URUT,
      WAKTU_VOTING: today_(),
      TAHUN_PEMILIHAN: settings.TAHUN_PEMILIHAN
    };
    writeRow_(vsh, vHeaders, pos, vote);

    // Tandai siswa sudah memilih
    var waktu = now_();
    try {
      student.STATUS_MEMILIH = STATUS.SUDAH;
      student.WAKTU_MEMILIH = waktu;
      writeRow_(students.sheet, students.headers, student._row, student);
    } catch (err) {
      vsh.deleteRow(pos); // rollback suara
      throw new Error('Gagal menyimpan status pemilih. Suara dibatalkan, silakan coba lagi.');
    }
    return { waktu: waktu, nis: student.NIS, kelas: student.KELAS };
  });

  destroySession_(token);
  // Log TIDAK mencatat kandidat yang dipilih
  log_(result.nis, 'MEMBERIKAN SUARA', 'Siswa kelas ' + result.kelas + ' telah menggunakan hak suara');
  return {
    success: true,
    waktu: result.waktu,
    message: 'Suara Anda berhasil disimpan. Terima kasih telah berpartisipasi!'
  };
}


/* ============ BAGIAN: Admin.gs ============ */
/**
 * =====================================================================
 *  Admin.gs — Pengelolaan admin, data siswa, kandidat, unggah foto,
 *  pengaturan, serta buka/tutup pemungutan suara.
 * =====================================================================
 */

/**
 * Akun admin awal. GANTI password ini sebelum menjalankan setupAdmin(),
 * atau segera ganti melalui menu "Ganti Password" setelah login pertama.
 */
var DEFAULT_ADMIN = {
  USERNAME: 'admin',
  PASSWORD: 'Admin@Osis2026',
  NAMA: 'Administrator Utama'
};

/* ------------------------------------------------------------------ */
/*  SETUP ADMIN                                                        */
/* ------------------------------------------------------------------ */

/** Membuat akun SUPERADMIN awal jika sheet ADMIN masih kosong. */
function setupAdmin() {
  ensureEditor_();
  var t = readTable_(SHEETS.ADMIN);
  if (t.rows.length) {
    var msg0 = 'Akun admin sudah ada (' + t.rows.length + ' akun). Tidak ada perubahan.';
    Logger.log(msg0);
    return msg0;
  }
  appendRow_(t.sheet, t.headers.length ? t.headers : SCHEMA[SHEETS.ADMIN], {
    ID_ADMIN: uuid_('ADM-'),
    USERNAME: DEFAULT_ADMIN.USERNAME,
    PASSWORD_HASH: hashSecret_(DEFAULT_ADMIN.PASSWORD, APP.ITER_ADMIN),
    NAMA_ADMIN: DEFAULT_ADMIN.NAMA,
    ROLE: ROLES.SUPER,
    STATUS: STATUS.AKTIF
  });
  log_('SYSTEM', 'SETUP ADMIN', 'Akun admin awal dibuat: ' + DEFAULT_ADMIN.USERNAME);
  var msg = 'Akun admin awal dibuat. Username: ' + DEFAULT_ADMIN.USERNAME +
    ' | Password: ' + DEFAULT_ADMIN.PASSWORD + ' (segera ganti setelah login).';
  Logger.log(msg);
  return msg;
}

/** Darurat: mengembalikan password admin utama ke DEFAULT_ADMIN.PASSWORD (hanya dari editor). */
function resetPasswordAdminUtama() {
  ensureEditor_();
  var t = readTable_(SHEETS.ADMIN);
  var found = false;
  t.rows.forEach(function (r) {
    if (String(r.USERNAME).toLowerCase() === DEFAULT_ADMIN.USERNAME) {
      r.PASSWORD_HASH = hashSecret_(DEFAULT_ADMIN.PASSWORD, APP.ITER_ADMIN);
      r.ROLE = ROLES.SUPER;
      r.STATUS = STATUS.AKTIF;
      writeRow_(t.sheet, t.headers, r._row, r);
      found = true;
    }
  });
  if (!found) return setupAdminForce_();
  clearFail_('A_' + DEFAULT_ADMIN.USERNAME);
  log_('SYSTEM', 'RESET PASSWORD ADMIN UTAMA', 'Dijalankan dari editor');
  var msg = 'Password admin "' + DEFAULT_ADMIN.USERNAME + '" dikembalikan ke: ' + DEFAULT_ADMIN.PASSWORD;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (err) { /* editor */ }
  return msg;
}

function setupAdminForce_() {
  var t = readTable_(SHEETS.ADMIN);
  appendRow_(t.sheet, t.headers, {
    ID_ADMIN: uuid_('ADM-'), USERNAME: DEFAULT_ADMIN.USERNAME,
    PASSWORD_HASH: hashSecret_(DEFAULT_ADMIN.PASSWORD, APP.ITER_ADMIN),
    NAMA_ADMIN: DEFAULT_ADMIN.NAMA, ROLE: ROLES.SUPER, STATUS: STATUS.AKTIF
  });
  return 'Admin utama dibuat ulang dengan password default.';
}

/* ------------------------------------------------------------------ */
/*  MANAJEMEN AKUN ADMIN (SUPERADMIN)                                  */
/* ------------------------------------------------------------------ */

function getAdmins(token) {
  requireAdmin_(token, [ROLES.SUPER]);
  return readTable_(SHEETS.ADMIN).rows.map(adminPublic_);
}

/** Tambah (tanpa ID_ADMIN) atau ubah (dengan ID_ADMIN) akun admin. */
function saveAdmin(token, d) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  d = d || {};
  var username = clean_(d.USERNAME, 30).toLowerCase();
  var nama = clean_(d.NAMA_ADMIN, 80);
  var role = d.ROLE === ROLES.SUPER ? ROLES.SUPER : ROLES.PANITIA;
  var status = d.STATUS === STATUS.NONAKTIF ? STATUS.NONAKTIF : STATUS.AKTIF;
  var password = String(d.PASSWORD || '');
  if (!/^[a-z0-9._]{3,30}$/.test(username)) throw new Error('Username 3–30 karakter: huruf kecil, angka, titik, atau garis bawah.');
  if (!nama) throw new Error('Nama admin wajib diisi.');

  var t = readTable_(SHEETS.ADMIN);
  var dup = t.rows.filter(function (r) { return String(r.USERNAME).toLowerCase() === username && r.ID_ADMIN !== d.ID_ADMIN; });
  if (dup.length) throw new Error('Username sudah digunakan.');

  if (!d.ID_ADMIN) {
    validatePassword_(password);
    appendRow_(t.sheet, t.headers, {
      ID_ADMIN: uuid_('ADM-'), USERNAME: username, PASSWORD_HASH: hashSecret_(password, APP.ITER_ADMIN),
      NAMA_ADMIN: nama, ROLE: role, STATUS: status
    });
    log_(s.username, 'TAMBAH ADMIN', username + ' (' + role + ')');
    return true;
  }

  var row = null;
  t.rows.forEach(function (r) { if (r.ID_ADMIN === d.ID_ADMIN) row = r; });
  if (!row) throw new Error('Akun admin tidak ditemukan.');
  if (row.ID_ADMIN === s.id && (status !== STATUS.AKTIF || role !== ROLES.SUPER)) {
    throw new Error('Anda tidak dapat menonaktifkan atau menurunkan role akun sendiri.');
  }
  row.USERNAME = username;
  row.NAMA_ADMIN = nama;
  row.ROLE = role;
  row.STATUS = status;
  if (password) {
    validatePassword_(password);
    row.PASSWORD_HASH = hashSecret_(password, APP.ITER_ADMIN);
  }
  writeRow_(t.sheet, t.headers, row._row, row);
  log_(s.username, 'UBAH ADMIN', username + ' (' + role + ', ' + status + ')' + (password ? ', password direset' : ''));
  return true;
}

/* ------------------------------------------------------------------ */
/*  DATA SISWA                                                         */
/* ------------------------------------------------------------------ */

function studentPublic_(r) {
  return {
    ID_SISWA: r.ID_SISWA, NIS: r.NIS, NISN: r.NISN, NAMA_SISWA: r.NAMA_SISWA, KELAS: r.KELAS,
    STATUS_AKUN: r.STATUS_AKUN || STATUS.AKTIF,
    STATUS_MEMILIH: r.STATUS_MEMILIH || STATUS.BELUM,
    WAKTU_MEMILIH: r.WAKTU_MEMILIH,
    PIN_TERSEDIA: !!r['PASSWORD/PIN']
  };
}

/** Semua siswa TANPA PIN, diurutkan per kelas lalu nama. */
function getStudents(token) {
  requireAdmin_(token);
  return readTable_(SHEETS.SISWA).rows.map(studentPublic_).sort(function (a, b) {
    return naturalCompare_(a.KELAS, b.KELAS) || naturalCompare_(a.NAMA_SISWA, b.NAMA_SISWA);
  });
}

function studentInput_(d) {
  var o = {
    NIS: clean_(d.NIS, 20).replace(/\s+/g, ''),
    NISN: clean_(d.NISN, 20).replace(/\s+/g, ''),
    NAMA_SISWA: clean_(d.NAMA_SISWA || d.NAMA, 100).replace(/\s+/g, ' '),
    KELAS: clean_(d.KELAS, 20).replace(/\s+/g, ' ').toUpperCase()
  };
  if (!/^[0-9A-Za-z.\-\/]{3,20}$/.test(o.NIS)) throw new Error('NIS wajib diisi (3–20 karakter, tanpa spasi).');
  if (o.NISN && !/^\d{6,20}$/.test(o.NISN)) throw new Error('NISN hanya boleh berisi angka (NIS ' + o.NIS + ').');
  if (o.NAMA_SISWA.length < 2) throw new Error('Nama siswa wajib diisi (NIS ' + o.NIS + ').');
  if (!o.KELAS) throw new Error('Kelas wajib diisi (NIS ' + o.NIS + ').');
  return o;
}

function validatePin_(pin) {
  pin = clean_(pin, 12).replace(/\s+/g, '');
  if (!pin) return '';
  if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN harus 4–8 digit angka.');
  return pin;
}

function findDuplicate_(rows, nis, nisn, exceptId) {
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.ID_SISWA === exceptId) continue;
    if (r.NIS === nis || r.NISN === nis) return 'NIS ' + nis + ' sudah terdaftar atas nama ' + r.NAMA_SISWA + '.';
    if (nisn && (r.NISN === nisn || r.NIS === nisn)) return 'NISN ' + nisn + ' sudah terdaftar atas nama ' + r.NAMA_SISWA + '.';
  }
  return '';
}

/** Tambah satu siswa. PIN otomatis dibuat jika kosong dan ditampilkan SEKALI. */
function addStudent(token, d) {
  var s = requireAdmin_(token);
  var input = studentInput_(d || {});
  var pin = validatePin_(d && d.PIN) || generatePin_();
  return withLock_(function () {
    var t = readTable_(SHEETS.SISWA);
    var dup = findDuplicate_(t.rows, input.NIS, input.NISN, null);
    if (dup) throw new Error(dup);
    var obj = {
      ID_SISWA: uuid_('SIS-'), NIS: input.NIS, NISN: input.NISN, NAMA_SISWA: input.NAMA_SISWA, KELAS: input.KELAS,
      'PASSWORD/PIN': hashSecret_(pin, APP.ITER_PIN), STATUS_AKUN: STATUS.AKTIF, STATUS_MEMILIH: STATUS.BELUM, WAKTU_MEMILIH: ''
    };
    appendRow_(t.sheet, t.headers, obj);
    log_(s.username, 'TAMBAH SISWA', input.NIS + ' - ' + input.NAMA_SISWA + ' (' + input.KELAS + ')');
    return { NIS: input.NIS, NAMA_SISWA: input.NAMA_SISWA, KELAS: input.KELAS, PIN: pin };
  });
}

/** Ubah data siswa (NIS, NISN, nama, kelas, status akun). PIN tidak diubah di sini. */
function updateStudent(token, d) {
  var s = requireAdmin_(token);
  d = d || {};
  var input = studentInput_(d);
  var statusAkun = d.STATUS_AKUN === STATUS.NONAKTIF ? STATUS.NONAKTIF : STATUS.AKTIF;
  return withLock_(function () {
    var t = readTable_(SHEETS.SISWA);
    var row = null;
    t.rows.forEach(function (r) { if (r.ID_SISWA === d.ID_SISWA) row = r; });
    if (!row) throw new Error('Data siswa tidak ditemukan.');
    var dup = findDuplicate_(t.rows, input.NIS, input.NISN, row.ID_SISWA);
    if (dup) throw new Error(dup);
    row.NIS = input.NIS;
    row.NISN = input.NISN;
    row.NAMA_SISWA = input.NAMA_SISWA;
    row.KELAS = input.KELAS;
    row.STATUS_AKUN = statusAkun;
    if (!row.STATUS_MEMILIH) row.STATUS_MEMILIH = STATUS.BELUM;
    writeRow_(t.sheet, t.headers, row._row, row);
    log_(s.username, 'UBAH SISWA', row.NIS + ' - ' + row.NAMA_SISWA + ' (' + statusAkun + ')');
    return studentPublic_(row);
  });
}

/** Hapus siswa (SUPERADMIN). Siswa yang sudah memilih tidak dapat dihapus. */
function deleteStudent(token, idSiswa) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  return withLock_(function () {
    var t = readTable_(SHEETS.SISWA);
    var row = null;
    t.rows.forEach(function (r) { if (r.ID_SISWA === idSiswa) row = r; });
    if (!row) throw new Error('Data siswa tidak ditemukan.');
    if (row.STATUS_MEMILIH === STATUS.SUDAH) {
      throw new Error('Siswa yang sudah memilih tidak dapat dihapus agar jumlah pemilih tetap sesuai dengan jumlah suara.');
    }
    t.sheet.deleteRow(row._row);
    log_(s.username, 'HAPUS SISWA', row.NIS + ' - ' + row.NAMA_SISWA);
    return true;
  });
}

/** Reset PIN siswa. PIN baru dikembalikan sekali untuk diberikan kepada siswa. */
function resetPin(token, idSiswa) {
  var s = requireAdmin_(token);
  return withLock_(function () {
    var t = readTable_(SHEETS.SISWA);
    var row = null;
    t.rows.forEach(function (r) { if (r.ID_SISWA === idSiswa) row = r; });
    if (!row) throw new Error('Data siswa tidak ditemukan.');
    var pin = generatePin_();
    row['PASSWORD/PIN'] = hashSecret_(pin, APP.ITER_PIN);
    writeRow_(t.sheet, t.headers, row._row, row);
    clearFail_('S_' + String(row.NIS).toLowerCase());
    if (row.NISN) clearFail_('S_' + String(row.NISN).toLowerCase());
    log_(s.username, 'RESET PIN', row.NIS + ' - ' + row.NAMA_SISWA);
    return { NIS: row.NIS, NAMA_SISWA: row.NAMA_SISWA, KELAS: row.KELAS, PIN: pin };
  });
}

/** Membuat PIN baru untuk banyak siswa sekaligus (misal satu kelas) untuk dicetak kartunya. */
function regeneratePins(token, ids) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  if (!ids || !ids.length) throw new Error('Tidak ada siswa yang dipilih.');
  if (ids.length > 2000) throw new Error('Maksimal 2000 siswa sekali proses.');
  var set = {};
  ids.forEach(function (id) { set[String(id)] = true; });
  return withLock_(function () {
    var t = readTable_(SHEETS.SISWA);
    var out = [];
    t.rows.forEach(function (r) {
      if (set[r.ID_SISWA] && r.STATUS_MEMILIH !== STATUS.SUDAH) {
        var pin = generatePin_();
        r['PASSWORD/PIN'] = hashSecret_(pin, APP.ITER_PIN);
        out.push({ NIS: r.NIS, NISN: r.NISN, NAMA_SISWA: r.NAMA_SISWA, KELAS: r.KELAS, PIN: pin });
      }
    });
    if (t.rows.length) writeAllStudents_(t);
    log_(s.username, 'BUAT ULANG PIN MASSAL', out.length + ' siswa');
    return out;
  });
}

function writeAllStudents_(t) {
  // Tulis ulang semua baris berdasarkan _row masing-masing (blok kontigu sejak baris 2)
  var maxRow = 1;
  t.rows.forEach(function (r) { if (r._row > maxRow) maxRow = r._row; });
  var block = [];
  for (var i = 2; i <= maxRow; i++) block.push(null);
  t.rows.forEach(function (r) { block[r._row - 2] = r; });
  var data = block.map(function (r) { return r ? rowArray_(t.headers, r) : t.headers.map(function () { return ''; }); });
  if (!data.length) return;
  var range = t.sheet.getRange(2, 1, data.length, t.headers.length);
  range.setNumberFormat('@');
  range.setValues(data);
}

/**
 * Import siswa dari Excel/CSV (sudah diurai di browser menjadi array objek).
 * mode: 'skip'   → lewati NIS yang sudah ada
 *       'update' → perbarui nama/kelas/NISN (dan PIN jika diisi) untuk NIS yang sudah ada
 * Mengembalikan daftar PIN baru (hanya ditampilkan sekali).
 */
function importStudents(token, rows, mode) {
  var s = requireAdmin_(token);
  if (!rows || !rows.length) throw new Error('File tidak berisi data siswa.');
  if (rows.length > 3000) throw new Error('Maksimal 3000 baris per import.');
  mode = mode === 'update' ? 'update' : 'skip';

  return withLock_(function () {
    var t = readTable_(SHEETS.SISWA);
    var byKey = {};
    t.rows.forEach(function (r) {
      byKey[r.NIS] = r;
      if (r.NISN) byKey[r.NISN] = r;
    });

    var added = [], updated = 0, skipped = 0, errors = [], pins = [], seen = {};
    rows.forEach(function (raw, idx) {
      var line = idx + 2;
      try {
        var input = studentInput_(raw || {});
        if (seen[input.NIS]) throw new Error('NIS ' + input.NIS + ' ganda di dalam file.');
        seen[input.NIS] = true;
        var pinGiven = validatePin_(raw.PIN);
        var existing = byKey[input.NIS] || (input.NISN ? byKey[input.NISN] : null);
        if (existing) {
          if (mode !== 'update') { skipped++; return; }
          existing.NIS = input.NIS;
          existing.NISN = input.NISN || existing.NISN;
          existing.NAMA_SISWA = input.NAMA_SISWA;
          existing.KELAS = input.KELAS;
          if (pinGiven) {
            existing['PASSWORD/PIN'] = hashSecret_(pinGiven, APP.ITER_PIN);
            pins.push({ NIS: input.NIS, NISN: input.NISN, NAMA_SISWA: input.NAMA_SISWA, KELAS: input.KELAS, PIN: pinGiven });
          }
          existing._changed = true;
          updated++;
          return;
        }
        var pin = pinGiven || generatePin_();
        var obj = {
          ID_SISWA: uuid_('SIS-'), NIS: input.NIS, NISN: input.NISN, NAMA_SISWA: input.NAMA_SISWA, KELAS: input.KELAS,
          'PASSWORD/PIN': hashSecret_(pin, APP.ITER_PIN), STATUS_AKUN: STATUS.AKTIF, STATUS_MEMILIH: STATUS.BELUM, WAKTU_MEMILIH: ''
        };
        byKey[input.NIS] = obj;
        if (input.NISN) byKey[input.NISN] = obj;
        added.push(obj);
        pins.push({ NIS: input.NIS, NISN: input.NISN, NAMA_SISWA: input.NAMA_SISWA, KELAS: input.KELAS, PIN: pin });
      } catch (err) {
        errors.push('Baris ' + line + ': ' + err.message);
      }
    });

    if (updated) writeAllStudents_(t);
    if (added.length) {
      var lastUsed = 1;
      t.rows.forEach(function (r) { if (r._row > lastUsed) lastUsed = r._row; });
      writeRows_(t.sheet, t.headers, Math.max(lastUsed, t.sheet.getLastRow()) + 1, added);
    }

    log_(s.username, 'IMPORT SISWA', 'Tambah ' + added.length + ', perbarui ' + updated + ', lewati ' + skipped + ', gagal ' + errors.length);
    return { added: added.length, updated: updated, skipped: skipped, errors: errors.slice(0, 100), errorCount: errors.length, pins: pins };
  });
}

/**
 * Reset status memilih SELURUH siswa dan hapus suara tahun berjalan.
 * Hanya untuk membersihkan data SIMULASI sebelum pemilihan resmi.
 * Syarat: SUPERADMIN, voting tidak sedang DIBUKA, konfirmasi teks "RESET".
 */
function resetSimulasi(token, confirmText) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  if (String(confirmText) !== 'RESET') throw new Error('Ketik RESET (huruf besar) untuk konfirmasi.');
  var st = getSettingsRaw_();
  if (st.STATUS_VOTING === STATUS.DIBUKA) throw new Error('Tutup pemungutan suara terlebih dahulu sebelum mereset.');

  return withLock_(function () {
    // Hapus suara tahun berjalan
    var vsh = sheet_(SHEETS.HASIL);
    var lastRow = vsh.getLastRow(), lastCol = vsh.getLastColumn();
    var removed = 0;
    if (lastRow > 1) {
      var values = vsh.getRange(1, 1, lastRow, lastCol).getValues();
      var headers = values[0].map(String);
      var yearIdx = headers.indexOf('TAHUN_PEMILIHAN');
      var keep = values.slice(1).filter(function (r) {
        var isCurrent = cellStr_(r[yearIdx]) === String(st.TAHUN_PEMILIHAN);
        if (isCurrent) removed++;
        return !isCurrent;
      });
      vsh.getRange(2, 1, lastRow - 1, lastCol).clearContent();
      if (keep.length) {
        var rg = vsh.getRange(2, 1, keep.length, lastCol);
        rg.setNumberFormat('@');
        rg.setValues(keep.map(function (r) { return r.map(cellStr_); }));
      }
    }

    // Reset status semua siswa
    var t = readTable_(SHEETS.SISWA);
    var count = 0;
    t.rows.forEach(function (r) {
      if (r.STATUS_MEMILIH === STATUS.SUDAH) count++;
      r.STATUS_MEMILIH = STATUS.BELUM;
      r.WAKTU_MEMILIH = '';
    });
    if (t.rows.length) writeAllStudents_(t);

    st.STATUS_VOTING = STATUS.BELUM_DIBUKA;
    saveSettingsRaw_(st);

    log_(s.username, 'RESET SIMULASI', removed + ' suara dihapus, ' + count + ' status siswa direset');
    return { votesRemoved: removed, studentsReset: count };
  });
}

/* ------------------------------------------------------------------ */
/*  KANDIDAT                                                           */
/* ------------------------------------------------------------------ */

function candidateInput_(d) {
  var o = {
    NOMOR_URUT: String(parseInt(d.NOMOR_URUT, 10) || ''),
    NAMA_KETUA: clean_(d.NAMA_KETUA, 100),
    NAMA_WAKIL: clean_(d.NAMA_WAKIL, 100),
    KELAS: clean_(d.KELAS, 60),
    FOTO_KANDIDAT: normalizeImageUrl_(d.FOTO_KANDIDAT),
    VISI: clean_(d.VISI, 1500, true),
    MISI: clean_(d.MISI, 4000, true),
    PROGRAM_KERJA: clean_(d.PROGRAM_KERJA, 4000, true),
    STATUS_KANDIDAT: d.STATUS_KANDIDAT === STATUS.NONAKTIF ? STATUS.NONAKTIF : STATUS.AKTIF
  };
  var n = Number(o.NOMOR_URUT);
  if (!n || n < 1 || n > 99) throw new Error('Nomor urut harus angka 1–99.');
  if (!o.NAMA_KETUA) throw new Error('Nama calon ketua wajib diisi.');
  if (!o.NAMA_WAKIL) throw new Error('Nama calon wakil ketua wajib diisi.');
  if (!o.VISI) throw new Error('Visi wajib diisi.');
  return o;
}

function votesForCandidate_(id) {
  var n = 0;
  readTable_(SHEETS.HASIL).rows.forEach(function (v) { if (v.ID_KANDIDAT === id) n++; });
  return n;
}

function addCandidate(token, d) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  var input = candidateInput_(d || {});
  return withLock_(function () {
    var t = readTable_(SHEETS.KANDIDAT);
    t.rows.forEach(function (c) {
      if (Number(c.NOMOR_URUT) === Number(input.NOMOR_URUT)) throw new Error('Nomor urut ' + input.NOMOR_URUT + ' sudah dipakai.');
    });
    input.ID_KANDIDAT = uuid_('KAN-');
    appendRow_(t.sheet, t.headers, input);
    log_(s.username, 'TAMBAH KANDIDAT', 'No. ' + input.NOMOR_URUT + ' ' + input.NAMA_KETUA + ' & ' + input.NAMA_WAKIL);
    return candidatePublic_(input);
  });
}

function updateCandidate(token, d) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  d = d || {};
  var input = candidateInput_(d);
  var st = getSettingsRaw_();
  return withLock_(function () {
    var t = readTable_(SHEETS.KANDIDAT);
    var row = null;
    t.rows.forEach(function (c) { if (c.ID_KANDIDAT === d.ID_KANDIDAT) row = c; });
    if (!row) throw new Error('Kandidat tidak ditemukan.');
    t.rows.forEach(function (c) {
      if (c.ID_KANDIDAT !== row.ID_KANDIDAT && Number(c.NOMOR_URUT) === Number(input.NOMOR_URUT)) {
        throw new Error('Nomor urut ' + input.NOMOR_URUT + ' sudah dipakai.');
      }
    });
    var votes = votesForCandidate_(row.ID_KANDIDAT);
    if (votes > 0 && String(row.NOMOR_URUT) !== input.NOMOR_URUT) {
      throw new Error('Nomor urut tidak dapat diubah karena kandidat sudah menerima suara.');
    }
    if (st.STATUS_VOTING === STATUS.DIBUKA && row.STATUS_KANDIDAT === STATUS.AKTIF && input.STATUS_KANDIDAT !== STATUS.AKTIF) {
      throw new Error('Kandidat tidak dapat dinonaktifkan saat pemungutan suara berlangsung.');
    }
    Object.keys(input).forEach(function (k) { row[k] = input[k]; });
    writeRow_(t.sheet, t.headers, row._row, row);
    log_(s.username, 'UBAH KANDIDAT', 'No. ' + row.NOMOR_URUT + ' ' + row.NAMA_KETUA + ' & ' + row.NAMA_WAKIL + ' (' + row.STATUS_KANDIDAT + ')');
    return candidatePublic_(row);
  });
}

function deleteCandidate(token, idKandidat) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  var st = getSettingsRaw_();
  if (st.STATUS_VOTING !== STATUS.BELUM_DIBUKA) throw new Error('Kandidat hanya dapat dihapus sebelum pemungutan suara dibuka.');
  return withLock_(function () {
    if (votesForCandidate_(idKandidat) > 0) throw new Error('Kandidat sudah memiliki suara. Lakukan Reset Simulasi terlebih dahulu.');
    var t = readTable_(SHEETS.KANDIDAT);
    var row = null;
    t.rows.forEach(function (c) { if (c.ID_KANDIDAT === idKandidat) row = c; });
    if (!row) throw new Error('Kandidat tidak ditemukan.');
    t.sheet.deleteRow(row._row);
    log_(s.username, 'HAPUS KANDIDAT', 'No. ' + row.NOMOR_URUT + ' ' + row.NAMA_KETUA);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/*  UNGGAH GAMBAR KE GOOGLE DRIVE                                      */
/* ------------------------------------------------------------------ */

function mediaFolder_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('EV_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* folder terhapus, buat ulang */ }
  }
  var folder = DriveApp.createFolder(APP.DRIVE_FOLDER_NAME);
  props.setProperty('EV_FOLDER_ID', folder.getId());
  return folder;
}

/**
 * Unggah gambar (data URL base64) → Google Drive → URL publik untuk <img>.
 * kind: 'kandidat' | 'logo' | 'banner'
 */
function uploadImage(token, dataUrl, kind) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  var m = String(dataUrl || '').match(/^data:(image\/(png|jpeg|jpg|webp));base64,([A-Za-z0-9+\/=]+)$/);
  if (!m) throw new Error('Format gambar tidak didukung (gunakan JPG, PNG, atau WEBP).');
  var bytes = Utilities.base64Decode(m[3]);
  if (bytes.length > 4 * 1024 * 1024) throw new Error('Ukuran gambar maksimal 4 MB.');
  kind = ['kandidat', 'logo', 'banner'].indexOf(kind) > -1 ? kind : 'gambar';
  var ext = m[2] === 'jpeg' || m[2] === 'jpg' ? 'jpg' : m[2];
  var blob = Utilities.newBlob(bytes, m[1], kind + '_' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd_HHmmss') + '.' + ext);
  var file = mediaFolder_().createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (err) {
    throw new Error('Gambar tersimpan, tetapi tidak dapat dibagikan publik (kebijakan akun Google Workspace). ' +
      'Gunakan akun Gmail pribadi atau tempel URL gambar secara manual.');
  }
  log_(s.username, 'UNGGAH GAMBAR', kind + ': ' + file.getName());
  return 'https://lh3.googleusercontent.com/d/' + file.getId();
}

/* ------------------------------------------------------------------ */
/*  PENGATURAN & STATUS PEMILIHAN                                      */
/* ------------------------------------------------------------------ */

function saveSettings(token, d) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  d = d || {};
  var st = getSettingsRaw_();
  var tahun = clean_(d.TAHUN_PEMILIHAN, 9);
  if (!/^\d{4}(\/\d{4})?$/.test(tahun)) throw new Error('Tahun pemilihan tidak valid (contoh: 2026 atau 2026/2027).');
  var mulai = normalizeDateInput_(d.TANGGAL_MULAI);
  var selesai = normalizeDateInput_(d.TANGGAL_SELESAI);
  if (mulai && selesai && parseDate_(selesai) <= parseDate_(mulai)) throw new Error('Waktu selesai harus setelah waktu mulai.');

  if (tahun !== st.TAHUN_PEMILIHAN && st.STATUS_VOTING === STATUS.DIBUKA) {
    throw new Error('Tahun pemilihan tidak dapat diubah saat pemungutan suara berlangsung.');
  }

  st.NAMA_SEKOLAH = clean_(d.NAMA_SEKOLAH, 120) || APP.SCHOOL;
  st.TAHUN_PEMILIHAN = tahun;
  st.JUDUL_PEMILIHAN = clean_(d.JUDUL_PEMILIHAN, 150) || 'Pemilihan Ketua dan Wakil Ketua OSIS';
  st.TANGGAL_MULAI = mulai;
  st.TANGGAL_SELESAI = selesai;
  st.LOGO_SEKOLAH = normalizeImageUrl_(d.LOGO_SEKOLAH);
  st.FOTO_BANNER = normalizeImageUrl_(d.FOTO_BANNER);
  st.PESAN_SELESAI = clean_(d.PESAN_SELESAI, 500, true);
  st.ID = st.ID || '1';
  saveSettingsRaw_(st);
  log_(s.username, 'UBAH PENGATURAN', 'Tahun ' + tahun + ', jadwal ' + (mulai || '-') + ' s.d. ' + (selesai || '-'));
  return settingsPublic_(st);
}

function openVoting(token) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  var st = getSettingsRaw_();
  var aktif = readTable_(SHEETS.KANDIDAT).rows.filter(function (c) { return c.STATUS_KANDIDAT === STATUS.AKTIF; });
  if (aktif.length < 1) throw new Error('Belum ada kandidat aktif.');
  var siswa = readTable_(SHEETS.SISWA).rows.filter(function (r) { return r.STATUS_AKUN === STATUS.AKTIF; });
  if (!siswa.length) throw new Error('Belum ada data siswa aktif.');
  var end = parseDate_(st.TANGGAL_SELESAI);
  if (end && end < new Date()) throw new Error('Waktu selesai sudah lewat. Perbarui jadwal di Pengaturan terlebih dahulu.');
  var before = st.STATUS_VOTING;
  st.STATUS_VOTING = STATUS.DIBUKA;
  saveSettingsRaw_(st);
  log_(s.username, 'BUKA VOTING', 'Status sebelumnya: ' + before);
  return settingsPublic_(st);
}

function closeVoting(token) {
  var s = requireAdmin_(token, [ROLES.SUPER]);
  var st = getSettingsRaw_();
  st.STATUS_VOTING = STATUS.DITUTUP;
  // Tunggu proses suara yang sedang berjalan selesai sebelum menutup
  withLock_(function () { saveSettingsRaw_(st); });
  log_(s.username, 'TUTUP VOTING', 'Pemungutan suara ditutup');
  return settingsPublic_(st);
}


/* ============ BAGIAN: Report.gs ============ */
/**
 * =====================================================================
 *  Report.gs — Statistik partisipasi, hasil pemilihan, data laporan,
 *  dan log aktivitas.
 * =====================================================================
 */

/** Statistik partisipasi (TIDAK memuat perolehan suara per kandidat). */
function computeStats_(st) {
  var students = readTable_(SHEETS.SISWA).rows;
  var tahun = String(st.TAHUN_PEMILIHAN);
  var votes = readTable_(SHEETS.HASIL).rows.filter(function (v) { return v.TAHUN_PEMILIHAN === tahun; });
  var cands = readTable_(SHEETS.KANDIDAT).rows;

  var aktif = students.filter(function (s) { return (s.STATUS_AKUN || STATUS.AKTIF) === STATUS.AKTIF; });
  var sudahSemua = students.filter(function (s) { return s.STATUS_MEMILIH === STATUS.SUDAH; }).length;
  var sudahAktif = aktif.filter(function (s) { return s.STATUS_MEMILIH === STATUS.SUDAH; }).length;
  var dpt = aktif.length;

  var kelasMap = {};
  aktif.forEach(function (s) {
    var k = s.KELAS || '-';
    if (!kelasMap[k]) kelasMap[k] = { kelas: k, total: 0, sudah: 0, belum: 0, persen: 0 };
    kelasMap[k].total++;
    if (s.STATUS_MEMILIH === STATUS.SUDAH) kelasMap[k].sudah++; else kelasMap[k].belum++;
  });
  var perKelas = Object.keys(kelasMap).sort(naturalCompare_).map(function (k) {
    var o = kelasMap[k];
    o.persen = o.total ? Math.round(o.sudah / o.total * 1000) / 10 : 0;
    return o;
  });

  return {
    totalTerdaftar: students.length,
    totalDpt: dpt,
    totalNonaktif: students.length - dpt,
    sudah: sudahAktif,
    sudahSemua: sudahSemua,
    belum: dpt - sudahAktif,
    partisipasi: dpt ? Math.round(sudahAktif / dpt * 1000) / 10 : 0,
    totalSuara: votes.length,
    kandidatAktif: cands.filter(function (c) { return c.STATUS_KANDIDAT === STATUS.AKTIF; }).length,
    kandidatTotal: cands.length,
    perKelas: perKelas,
    integritas: votes.length === sudahSemua,
    status: st.STATUS_VOTING,
    updatedAt: now_()
  };
}

/** Perolehan suara per kandidat. */
function computeResults_(st) {
  var tahun = String(st.TAHUN_PEMILIHAN);
  var votes = readTable_(SHEETS.HASIL).rows.filter(function (v) { return v.TAHUN_PEMILIHAN === tahun; });
  var cands = readTable_(SHEETS.KANDIDAT).rows;
  var count = {};
  votes.forEach(function (v) { count[v.ID_KANDIDAT] = (count[v.ID_KANDIDAT] || 0) + 1; });

  var total = votes.length;
  var list = cands.filter(function (c) {
    return c.STATUS_KANDIDAT === STATUS.AKTIF || count[c.ID_KANDIDAT];
  }).map(function (c) {
    var n = count[c.ID_KANDIDAT] || 0;
    var o = candidatePublic_(c);
    o.SUARA = n;
    o.PERSEN = total ? Math.round(n / total * 10000) / 100 : 0;
    return o;
  });
  sortCandidates_(list);

  var known = {};
  cands.forEach(function (c) { known[c.ID_KANDIDAT] = true; });
  var tidakDikenal = votes.filter(function (v) { return !known[v.ID_KANDIDAT]; }).length;

  var max = 0;
  list.forEach(function (c) { if (c.SUARA > max) max = c.SUARA; });
  var winners = max > 0 ? list.filter(function (c) { return c.SUARA === max; }) : [];

  return {
    kandidat: list,
    totalSah: total - tidakDikenal,
    tidakDikenal: tidakDikenal,
    pemenang: winners.length === 1 ? winners[0] : null,
    seri: winners.length > 1,
    kandidatSeri: winners.length > 1 ? winners : []
  };
}

/** PUBLIK (admin): statistik untuk Beranda & Monitoring. */
function getVotingStatistics(token) {
  requireAdmin_(token);
  var st = getSettingsRaw_();
  return { settings: settingsPublic_(st), stats: computeStats_(st) };
}

/** PUBLIK (admin): hasil akhir — hanya setelah pemungutan suara DITUTUP. */
function getElectionResults(token) {
  var s = requireAdmin_(token);
  var st = getSettingsRaw_();
  if (st.STATUS_VOTING !== STATUS.DITUTUP) {
    throw new Error('RESULTS_LOCKED: Hasil akhir hanya dapat dibuka setelah pemungutan suara ditutup oleh admin.');
  }
  log_(s.username, 'MELIHAT HASIL', 'Hasil pemilihan tahun ' + st.TAHUN_PEMILIHAN);
  return { settings: settingsPublic_(st), stats: computeStats_(st), results: computeResults_(st) };
}

/**
 * PUBLIK (admin): data untuk laporan cetak/unduh.
 * type: berita_acara | rekapitulasi | perolehan | hasil | partisipasi | excel
 */
function generateReport(token, type) {
  var s = requireAdmin_(token);
  var types = ['berita_acara', 'rekapitulasi', 'perolehan', 'hasil', 'partisipasi', 'excel'];
  if (types.indexOf(type) === -1) throw new Error('Jenis laporan tidak dikenal.');
  var st = getSettingsRaw_();
  var closed = st.STATUS_VOTING === STATUS.DITUTUP;
  var needResults = ['berita_acara', 'rekapitulasi', 'perolehan', 'hasil'].indexOf(type) > -1;
  if (needResults && !closed) {
    throw new Error('Laporan ini memuat hasil perolehan suara dan hanya tersedia setelah pemungutan suara ditutup.');
  }

  var out = {
    type: type,
    generatedAt: now_(),
    generatedBy: s.nama || s.username,
    settings: settingsPublic_(st),
    stats: computeStats_(st),
    results: closed ? computeResults_(st) : null,
    students: null
  };

  if (type === 'partisipasi' || type === 'excel') {
    out.students = readTable_(SHEETS.SISWA).rows.map(function (r) {
      return {
        NIS: r.NIS, NISN: r.NISN, NAMA_SISWA: r.NAMA_SISWA, KELAS: r.KELAS,
        STATUS_AKUN: r.STATUS_AKUN || STATUS.AKTIF,
        STATUS_MEMILIH: r.STATUS_MEMILIH || STATUS.BELUM,
        WAKTU_MEMILIH: r.WAKTU_MEMILIH
      };
    }).sort(function (a, b) {
      return naturalCompare_(a.KELAS, b.KELAS) || naturalCompare_(a.NAMA_SISWA, b.NAMA_SISWA);
    });
  }

  log_(s.username, 'GENERATE LAPORAN', type);
  return out;
}

/** PUBLIK (SUPERADMIN): log aktivitas terbaru. */
function getLogs(token, limit) {
  requireAdmin_(token, [ROLES.SUPER]);
  limit = Math.min(Number(limit) || 200, 1000);
  var rows = readTable_(SHEETS.LOG).rows;
  return rows.slice(-limit).reverse().map(function (r) {
    return { WAKTU: r.WAKTU, USER: r.USER, AKTIVITAS: r.AKTIVITAS, KETERANGAN: r.KETERANGAN };
  });
}
