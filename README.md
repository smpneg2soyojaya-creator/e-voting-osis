# E-VOTING OSIS

**Sistem Pemilihan Ketua dan Wakil Ketua OSIS Secara Online**
SMP Negeri 2 Soyo Jaya — Desa Lembah Sumara, Kecamatan Soyo Jaya, Kabupaten Morowali Utara

Aplikasi web pemungutan suara berbasis **Google Apps Script** dengan **Google Spreadsheet** sebagai database.

## Fitur Utama

- Login pemilih (siswa, guru, staf) dengan NIS/NISN/NIP + PIN
- Kartu pasangan calon lengkap dengan foto, visi, misi, dan program kerja
- Satu pemilih hanya bisa memilih satu kali (LockService + validasi server)
- Pilihan bersifat rahasia: identitas pemilih tidak disimpan bersama suaranya
- Dashboard admin: beranda, data pemilih, kandidat, monitoring real-time, hasil, pengaturan, laporan
- Grafik hasil (Chart.js), cetak PDF (berita acara, rekapitulasi, partisipasi), dan unduh Excel
- Role SUPERADMIN dan PANITIA, password dan PIN di-hash, session bermasa berlaku, log aktivitas

## Isi Repository

| File | Keterangan |
|---|---|
| `Code.gs` | Seluruh kode backend (Google Apps Script) |
| `Index.html` | Seluruh tampilan, CSS, dan JavaScript frontend |
| `appsscript.json` | Manifest: zona waktu WITA, runtime V8, izin |
| `Template_Import_Pemilih.xlsx` | Template import siswa, guru, dan staf |
| `PANDUAN.md` | Panduan setup, akun admin, data, deployment, penggunaan, dan uji keamanan |

## Cara Pasang Singkat

1. Buat Google Spreadsheet baru → **Ekstensi → Apps Script**.
2. Tempel `Code.gs` dan `appsscript.json`, lalu buat file HTML bernama `Index` dan tempel `Index.html`.
3. Jalankan fungsi `setupDatabase` lalu berikan izin.
4. **Terapkan → Deployment baru → Aplikasi web**, dengan *Jalankan sebagai: Saya* dan *Akses: Siapa saja*.
5. Halaman pemilih: `URL/exec`. Halaman panitia: `URL/exec?page=admin`.

Langkah lengkap ada di [PANDUAN.md](PANDUAN.md).

## Keamanan

- Simpan repository ini sebagai **Private**.
- Ganti `DEFAULT_ADMIN.PASSWORD` di `Code.gs` sebelum menjalankan setup, atau segera ganti password setelah login pertama.
- Jangan unggah data asli pemilih, daftar PIN, atau file laporan ke repository ini.

## Riwayat Versi

| Versi | Tanggal | Perubahan |
|---|---|---|
| v1.0 | 17 November 2026 | Rilis pertama |
