# E-VOTING OSIS — Panduan Lengkap

**Sistem Pemilihan Ketua dan Wakil Ketua OSIS Secara Online**
SMP Negeri 2 Soyo Jaya — Desa Lembah Sumara, Kecamatan Soyo Jaya, Kabupaten Morowali Utara

---

## Daftar Isi

1. Daftar file proyek
2. Struktur database spreadsheet
3. Menjalankan `setupDatabase()`
4. Membuat akun admin
5. Memasukkan data siswa
6. Memasukkan kandidat
7. Deployment Google Apps Script
8. Penggunaan aplikasi (alur hari pemilihan)
9. Pengujian keamanan dan pencegahan voting ganda
10. Catatan teknis dan pemecahan masalah

---

## 0. Versi Ringkas (hanya 2 file)

Jika tidak ingin menempel banyak file, gunakan folder `versi-ringkas`. Isinya hanya `Code.gs` (gabungan semua file .gs), `Index.html` (gabungan semua file HTML), dan `appsscript.json`. Fungsinya sama persis dengan versi lengkap.

Cara pakai: tempel `appsscript.json`, ganti isi `Code.gs`, lalu buat satu file HTML bernama `Index`. Setelah itu lanjutkan ke langkah 6 pada bagian 3 (jalankan `setupDatabase`).

## 1. Daftar File Proyek

| File | Jenis di editor Apps Script | Fungsi |
|---|---|---|
| `appsscript.json` | Manifest (aktifkan dulu, lihat langkah 3) | Zona waktu Asia/Makassar (WITA), runtime V8, izin |
| `Code.gs` | Skrip | Konfigurasi `APP`, `doGet()`, utilitas spreadsheet, kunci (lock), log |
| `Database.gs` | Skrip | Skema sheet, `setupDatabase()`, `getSettings()` |
| `Auth.gs` | Skrip | `loginSiswa()`, `loginAdmin()`, session, hash, batas percobaan login |
| `Voting.gs` | Skrip | `getCandidates()`, `submitVote()`, validasi jadwal |
| `Admin.gs` | Skrip | `setupAdmin()`, CRUD siswa/kandidat, import, unggah foto, `openVoting()`, `closeVoting()` |
| `Report.gs` | Skrip | `getVotingStatistics()`, `getElectionResults()`, `generateReport()`, log |
| `Index.html` | HTML | Kerangka halaman utama |
| `Login.html` | HTML | Halaman login siswa dan login panitia |
| `VotingPage.html` | HTML | Halaman pemilihan dan halaman terima kasih |
| `Dashboard.html` | HTML | Kerangka dashboard admin |
| `Style.html` | HTML | CSS |
| `Script.html` | HTML | JavaScript frontend |

> Di editor Apps Script, saat membuat file HTML **jangan** menulis ekstensi `.html`. Cukup ketik `Index`, `Login`, `VotingPage`, `Dashboard`, `Style`, `Script`. Nama file HTML tidak boleh sama dengan nama file `.gs` (karena itu halaman pemilihan bernama `VotingPage`, bukan `Voting`). Untuk file skrip, ketik `Database`, `Auth`, dan seterusnya (ekstensi `.gs` ditambahkan otomatis).

---

## 2. Struktur Database Spreadsheet

Semua sheet dibuat otomatis oleh `setupDatabase()`. Semua kolom diformat sebagai **teks** agar NIS/NISN yang diawali angka 0 tidak berubah.

### PENGATURAN (1 baris)
`ID | NAMA_SEKOLAH | TAHUN_PEMILIHAN | JUDUL_PEMILIHAN | TANGGAL_MULAI | TANGGAL_SELESAI | STATUS_VOTING | LOGO_SEKOLAH | FOTO_BANNER | PESAN_SELESAI`

- `STATUS_VOTING`: `BELUM DIBUKA` / `DIBUKA` / `DITUTUP`
- Format tanggal: `yyyy-MM-dd HH:mm` (WITA), contoh `2026-11-20 07:30`

### DATA_SISWA
`ID_SISWA | NIS | NISN | NAMA_SISWA | KELAS | PASSWORD/PIN | STATUS_AKUN | STATUS_MEMILIH | WAKTU_MEMILIH`

- `PASSWORD/PIN` disimpan sebagai **hash** dengan format `v1$iterasi$salt$hash`. PIN asli tidak pernah disimpan.
- `STATUS_AKUN`: `AKTIF` / `NONAKTIF`
- `STATUS_MEMILIH`: `BELUM MEMILIH` / `SUDAH MEMILIH`

### KANDIDAT
`ID_KANDIDAT | NOMOR_URUT | NAMA_KETUA | NAMA_WAKIL | KELAS | FOTO_KANDIDAT | VISI | MISI | PROGRAM_KERJA | STATUS_KANDIDAT`

- `MISI` dan `PROGRAM_KERJA` ditulis satu poin per baris.

### HASIL_VOTING
`ID_SUARA | ID_KANDIDAT | NOMOR_URUT | WAKTU_VOTING | TAHUN_PEMILIHAN`

- **Tidak ada** NIS, NISN, nama, atau PIN pemilih.
- `WAKTU_VOTING` hanya berisi **tanggal** (tanpa jam), dan setiap suara disisipkan pada **posisi baris acak**. Akibatnya urutan dan waktu suara tidak dapat dicocokkan dengan `WAKTU_MEMILIH` di DATA_SISWA, sehingga kerahasiaan pilihan tetap terjaga walaupun seseorang membuka spreadsheet.

### LOG_AKTIVITAS
`ID_LOG | WAKTU | USER | AKTIVITAS | KETERANGAN`

- Log **tidak pernah** mencatat kandidat yang dipilih siswa.

### ADMIN
`ID_ADMIN | USERNAME | PASSWORD_HASH | NAMA_ADMIN | ROLE | STATUS`

- `ROLE`: `SUPERADMIN` (akses penuh) atau `PANITIA` (data siswa, monitoring, hasil setelah ditutup, laporan).

---

## 3. Menjalankan `setupDatabase()`

1. Buka **Google Drive**, lalu buat **Google Spreadsheet** baru. Beri nama, misalnya `DATABASE E-VOTING OSIS 2026`.
2. Di spreadsheet, klik **Ekstensi → Apps Script**.
3. Klik ikon **⚙ Setelan Project**, lalu centang **"Tampilkan file manifes 'appsscript.json' di editor"**.
4. Kembali ke **Editor**:
   - Buka `appsscript.json`, hapus isinya, lalu tempel isi file `appsscript.json` dari paket ini.
   - Buka `Code.gs`, hapus isinya, lalu tempel isi `Code.gs`.
   - Klik **+ → Skrip**, beri nama `Database`, lalu tempel isinya. Ulangi untuk `Auth`, `Voting`, `Admin`, dan `Report`.
   - Klik **+ → HTML**, beri nama `Index`, lalu tempel isinya. Ulangi untuk `Login`, `VotingPage`, `Dashboard`, `Style`, dan `Script`.
5. Klik **💾 Simpan**.
6. Di bilah atas, pilih fungsi **`setupDatabase`**, lalu klik **▶ Jalankan**.
7. Saat diminta, klik **Tinjau izin → pilih akun → Lanjutan → Buka (tidak aman) → Izinkan**. Peringatan ini normal untuk skrip buatan sendiri.
8. Buka **Log eksekusi**. Pesan yang muncul seharusnya: *"Setup database selesai…"* dan *"Akun admin awal dibuat…"*.
9. Kembali ke spreadsheet. Enam sheet sekarang sudah ada, lengkap dengan header berwarna navy. Setelah spreadsheet dimuat ulang, akan muncul juga menu **E-VOTING OSIS**.

`setupDatabase()` **aman dijalankan berulang kali**. Fungsi ini hanya membuat sheet atau kolom yang belum ada dan tidak menghapus data.

> **Keamanan:** `setupDatabase()`, `setupAdmin()`, dan `resetPasswordAdminUtama()` hanya dapat dijalankan pemilik dari editor atau menu spreadsheet. Jika dipanggil dari web app, fungsi ini akan ditolak.

---

## 4. Membuat Akun Admin

### Akun admin awal (otomatis)
`setupDatabase()` otomatis memanggil `setupAdmin()`, yang membuat akun berikut:

| Username | Password | Role |
|---|---|---|
| `admin` | `Admin@Osis2026` | SUPERADMIN |

**Sangat disarankan:** ubah password ini di `Admin.gs` (konstanta `DEFAULT_ADMIN.PASSWORD`) **sebelum** menjalankan setup. Jika tidak, segera ganti password melalui tombol **🔑 Password** di dashboard setelah login pertama. Aplikasi juga akan menampilkan peringatan selama password bawaan masih dipakai.

### Menambah admin/panitia lain
1. Login sebagai SUPERADMIN, lalu buka menu **Akun & Log → Tambah Admin**.
2. Isi username (huruf kecil/angka), nama, role (`PANITIA` atau `SUPERADMIN`), dan password (minimal 8 karakter, berisi huruf dan angka).

### Lupa password admin utama
Di spreadsheet, klik menu **E-VOTING OSIS → Reset Password Admin Utama**. Cara lain: jalankan `resetPasswordAdminUtama` dari editor. Password akan kembali ke nilai `DEFAULT_ADMIN.PASSWORD`.

---

## 5. Memasukkan Data Siswa

### Cara A — Import Excel/CSV (disarankan)
1. Di dashboard, buka **Data Siswa → Import Excel/CSV → Unduh Template Excel**.
2. Isi sheet `DATA` dengan kolom berikut:

   | NIS | NISN | NAMA_SISWA | KELAS | PIN |
   |---|---|---|---|---|
   | 2324001 | 0112345678 | Ahmad Fauzi | VII A | *(kosong)* |

   - **NIS** wajib diisi dan harus unik. **NISN** opsional. **PIN** opsional (4–8 digit). PIN yang kosong dibuat otomatis (6 digit).
   - Kolom NIS, NISN, dan PIN di template sudah berformat Teks. Jika memakai file sendiri, format kolom tersebut sebagai **Teks** agar angka 0 di depan NISN tidak hilang.
3. Pilih file, tentukan perlakuan untuk NIS yang sudah ada (*Lewati* atau *Perbarui*), lalu klik **Import**.
4. Setelah selesai, muncul daftar **PIN** untuk siswa baru. **PIN hanya ditampilkan sekali.** Langsung klik **Cetak Kartu PIN** dan/atau **Unduh Excel**.

### Cara B — Tambah satu per satu
Buka **Data Siswa → Tambah Siswa**. PIN baru ditampilkan sekali setelah data disimpan.

### Cara C — Ketik langsung di spreadsheet
Data juga dapat diketik di sheet DATA_SISWA. `PASSWORD/PIN` boleh diisi PIN biasa, misalnya `482913`. Isi `STATUS_AKUN` dengan `AKTIF` dan `STATUS_MEMILIH` dengan `BELUM MEMILIH`, serta beri setiap siswa `ID_SISWA` yang unik (misalnya `SIS-001`). Saat siswa pertama kali login, PIN tersebut otomatis diubah menjadi hash.

### Mencetak ulang kartu PIN
Karena PIN disimpan sebagai hash, PIN lama tidak bisa dilihat lagi. Untuk mencetak kartu, buka **Data Siswa → Kartu PIN per Kelas** (khusus SUPERADMIN). Pilih kelas, dan sistem akan **membuat PIN baru** untuk siswa yang belum memilih, lalu menampilkan kartunya untuk dicetak. Untuk satu siswa yang lupa PIN, gunakan tombol **🔑 Reset PIN** di baris siswa tersebut.

> Ketentuan "PIN siswa tidak boleh ditampilkan dalam dashboard" dipenuhi: tabel siswa tidak pernah memuat PIN. PIN hanya muncul sekali, tepat saat dibuat, agar dapat dibagikan kepada siswa.

---

## 6. Memasukkan Kandidat

1. Login sebagai SUPERADMIN, lalu buka **Data Kandidat → Tambah Kandidat**.
2. Isi **nomor urut**, **nama calon ketua**, **nama calon wakil ketua**, **kelas**, **visi**, **misi** (satu poin per baris), dan **program kerja** (satu poin per baris).
3. **Foto:** pilih file JPG/PNG. Foto otomatis diperkecil, diunggah ke folder Google Drive **"E-VOTING OSIS - Media"**, lalu dibagikan dengan akses lihat. Pilihan lainnya: tempel tautan Google Drive atau URL gambar.
   - Rasio foto yang ideal adalah **4:3**, dengan wajah pasangan calon di bagian atas tengah.
4. Kandidat dapat **dinonaktifkan** (tidak tampil bagi siswa) atau **dihapus**. Penghapusan hanya bisa dilakukan sebelum voting dibuka.
5. Tombol **Detail** menampilkan kartu kandidat persis seperti yang dilihat siswa.

Pengaman lainnya: nomor urut tidak dapat diubah jika kandidat sudah menerima suara, dan kandidat tidak dapat dinonaktifkan selama voting berlangsung.

---

## 7. Deployment Google Apps Script

1. Di editor Apps Script, klik **Terapkan (Deploy) → Deployment baru**.
2. Klik ikon ⚙ di sebelah "Pilih jenis", lalu pilih **Aplikasi web**.
3. Isi pengaturan berikut:
   - **Deskripsi:** `E-Voting OSIS v1`
   - **Jalankan sebagai:** **Saya (email pemilik)** ← *wajib*
   - **Yang memiliki akses:** **Siapa saja** (agar siswa tidak perlu akun Google)
4. Klik **Terapkan**, lalu salin **URL aplikasi web** (berakhiran `/exec`).
5. Bagikan alamat berikut:
   - Halaman siswa: `https://script.google.com/macros/s/XXXX/exec`
   - Halaman panitia: `https://script.google.com/macros/s/XXXX/exec?page=admin`
   - Agar mudah dibagikan, buat tautan pendek atau kode QR untuk alamat siswa.

**Setiap kali kode diubah**, lakukan: **Terapkan → Kelola deployment → ✏ Edit → Versi: Versi baru → Terapkan**. URL tidak berubah.

> **Penting:** Spreadsheet **tidak perlu dan tidak boleh** dibagikan kepada siswa. Web app berjalan dengan akun pemilik, sehingga siswa hanya berinteraksi melalui fungsi server yang tervalidasi.

---

## 8. Penggunaan Aplikasi

### Persiapan (H-7 s.d. H-1)
1. **Pengaturan:** isi nama sekolah, judul, tahun, tanggal/waktu mulai dan selesai, pesan selesai, logo, dan banner. Klik **Simpan**.
2. **Data Siswa:** import seluruh siswa, lalu cetak dan bagikan kartu PIN (bisa dimasukkan ke amplop per kelas).
3. **Data Kandidat:** masukkan semua pasangan calon beserta foto.
4. **Simulasi:** buka voting, lalu minta 3–5 siswa/guru mencoba memilih. Tutup voting, periksa hasilnya, kemudian jalankan **Data Siswa → Reset Status Memilih** (ketik `RESET`). Langkah ini menghapus suara simulasi dan mengembalikan semua siswa ke status BELUM MEMILIH.
   - Jika PIN peserta simulasi sudah diketahui orang lain, reset PIN mereka.

### Hari pemilihan
1. SUPERADMIN membuka **Beranda → Buka Voting**.
   - Siswa hanya dapat memilih jika status **DIBUKA** **dan** waktu saat itu berada dalam jadwal (jika jadwal diisi).
2. Siswa membuka halaman siswa, memasukkan NIS/NISN + PIN, lalu tekan **MASUK**.
3. Siswa membaca kartu kandidat → **LIHAT DETAIL** → **PILIH PASANGAN INI** → konfirmasi **YA, KIRIM SUARA**.
4. Halaman terima kasih tampil dan otomatis kembali ke awal setelah 15 detik. Ini aman untuk perangkat bersama di bilik suara.
5. Panitia memantau melalui **Monitoring Voting**: jumlah suara masuk, partisipasi, siswa yang belum memilih, dan grafik per kelas, yang diperbarui otomatis setiap 15 detik. Perolehan suara **tidak** ditampilkan selama voting berlangsung.
6. Setelah selesai, SUPERADMIN membuka **Beranda → Tutup Voting**.

### Setelah voting ditutup
- **Hasil Voting:** jumlah dan persentase suara setiap kandidat, diagram batang, diagram lingkaran, total suara sah, serta partisipasi.
- **Laporan:** isi dulu data penandatangan, lalu cetak dokumen yang dibutuhkan:
  - Cetak Hasil Voting (PDF)
  - Berita Acara Pemilihan
  - Rekapitulasi Suara
  - Hasil Perolehan Setiap Kandidat
  - Daftar Partisipasi Siswa (sudah tersedia sejak voting berlangsung)
  - Download Excel
- Untuk menyimpan sebagai PDF, pilih **"Simpan sebagai PDF"** di jendela cetak.

### Hak akses per role

| Menu | SUPERADMIN | PANITIA |
|---|:-:|:-:|
| Beranda, Monitoring | ✔ | ✔ |
| Data Siswa (tambah, edit, import, reset PIN) | ✔ | ✔ |
| Hapus siswa, Kartu PIN massal, Reset Status Memilih | ✔ | ✘ |
| Data Kandidat (kelola) | ✔ | lihat saja |
| Buka/Tutup Voting, Pengaturan | ✔ | ✘ |
| Hasil Voting, Laporan | ✔ (setelah ditutup) | ✔ (setelah ditutup) |
| Akun & Log | ✔ | ✘ |

---

## 9. Pengujian Keamanan dan Pencegahan Voting Ganda

Lakukan pengujian berikut **saat simulasi**. Setelah selesai, jalankan Reset Status Memilih.

| # | Skenario | Cara menguji | Hasil yang benar |
|---|---|---|---|
| 1 | Memilih dua kali | Siswa A memilih, lalu login lagi | Pesan "Hak suara Anda sudah digunakan pada …" |
| 2 | Dua perangkat bersamaan | Login Siswa A di HP 1 dan HP 2 (keduanya sampai halaman kandidat). Kirim suara di HP 1, lalu di HP 2 | HP 2 ditolak: "Hak suara Anda sudah digunakan". Jumlah suara hanya bertambah 1 |
| 3 | Klik ganda tombol kirim | Tekan **YA, KIRIM SUARA** berkali-kali dengan cepat | Tombol terkunci setelah klik pertama. Hanya 1 suara tersimpan |
| 4 | Token dipakai ulang | Setelah memilih, tekan tombol Back di browser lalu coba kirim lagi | Ditolak: sesi berakhir |
| 5 | Voting belum dibuka | Status BELUM DIBUKA, siswa mencoba login | Muncul informasi jadwal, siswa tidak bisa masuk |
| 6 | Voting ditutup / lewat jadwal | Tutup voting atau tunggu waktu selesai | Login dan pengiriman suara ditolak di server |
| 7 | PIN salah berulang | Masukkan PIN salah 5 kali | Akun terkunci 10 menit. Panitia dapat membuka kuncinya dengan Reset PIN |
| 8 | Hasil sementara | Buka menu Hasil Voting saat voting DIBUKA | Terkunci: "Hasil hanya dapat dibuka setelah voting ditutup" |
| 9 | Kerahasiaan pilihan | Buka sheet HASIL_VOTING | Tidak ada NIS/NISN/nama/PIN, waktu hanya tanggal, urutan baris acak |
| 10 | PIN tidak terlihat | Buka sheet DATA_SISWA dan tabel Data Siswa | Spreadsheet hanya berisi hash `v1$…`, tabel dashboard tanpa kolom PIN |
| 11 | Pembatasan role | Login sebagai PANITIA, coba buka Pengaturan | Menu tidak tersedia. Pemanggilan langsung ke server ditolak "Akses ditolak" |
| 12 | Sesi kedaluwarsa | Diamkan halaman siswa > 15 menit, lalu pilih | "Sesi berakhir, silakan masuk kembali" |
| 13 | Manipulasi browser | Buka DevTools → Console, jalankan `google.script.run.submitVote('token-palsu','KAN-xxx')` | Ditolak (SESSION_EXPIRED). Identitas pemilih selalu diambil dari sesi server |
| 14 | Fungsi setup dari luar | Dari Console web app jalankan `google.script.run.setupAdmin()` | Ditolak: hanya pemilik dari editor |
| 15 | Integritas data | Setelah simulasi, lihat kartu Ringkasan di Beranda | "Integritas data baik": jumlah suara = jumlah siswa sudah memilih |

### Mekanisme yang diterapkan
- **LockService (ScriptLock):** semua penulisan suara dan data siswa berjalan bergiliran. Di dalam lock, status siswa **dibaca ulang dari spreadsheet** sebelum suara disimpan.
- **Validasi server penuh:** browser tidak pernah mengirim identitas siswa. Server memakai token sesi (64 karakter acak, disimpan di CacheService) untuk menentukan siapa yang memilih.
- **Token sekali pakai:** sesi siswa langsung dihapus setelah suara terkirim.
- **Rollback:** jika penandaan "SUDAH MEMILIH" gagal, suara yang baru ditulis dibatalkan.
- **Hash:** password admin (500 iterasi SHA-256) dan PIN siswa memakai *salt* per akun dan *pepper* rahasia di Script Properties (tidak ada di spreadsheet).
- **Session bermasa berlaku:** siswa 15 menit, admin 120 menit, dan diperpanjang otomatis selama aktif. Admin yang dinonaktifkan langsung terputus.
- **Pembatasan percobaan login:** 5 kali gagal → dikunci 10 menit (siswa dan admin).
- **Proteksi sheet:** setiap sheet dilindungi sehingga hanya pemilik yang dapat mengedit.
- **Pencegahan formula injection** dan **escape HTML** pada semua data yang ditampilkan.

---

## 10. Catatan Teknis dan Pemecahan Masalah

**Kapasitas.** Setiap pengiriman suara memegang lock selama ±1–2 detik. Untuk sekolah dengan ratusan siswa, pengaturan bergiliran per kelas (misalnya 30–40 siswa sekaligus) berjalan lancar. Jika server sibuk, siswa mendapat pesan "Server sedang sibuk… coba lagi" tanpa kehilangan hak suara.

**Foto tidak tampil.**
- Pastikan file di Google Drive diatur *"Siapa saja yang memiliki link dapat melihat"*.
- Akun Google Workspace sekolah kadang melarang berbagi publik. Jika terjadi, gunakan akun Gmail pribadi sebagai pemilik aplikasi, atau tempel URL gambar dari tempat lain.

**Zona waktu.** `appsscript.json` memakai `Asia/Makassar` (WITA). Jika diubah, sesuaikan juga `APP.TZ_LABEL` di `Code.gs`.

**Mengubah konfigurasi.** Semua angka penting ada di objek `APP` (`Code.gs`): durasi sesi, batas percobaan login, lama blokir, dan iterasi hash.

**Mengganti tahun pemilihan.** Ubah tahun di Pengaturan. Suara disimpan per `TAHUN_PEMILIHAN`, sehingga data tahun lalu tetap tersimpan dan tidak tercampur. Status memilih siswa perlu direset dengan **Reset Status Memilih** sebelum pemilihan baru.

**"Sheet belum tersedia".** Jalankan ulang `setupDatabase()` dari editor.

**Mengubah data langsung di spreadsheet.** Hindari mengubah HASIL_VOTING atau STATUS_MEMILIH secara manual. Kartu "Integritas data" di Beranda akan memberi peringatan jika jumlah suara tidak cocok dengan jumlah siswa yang sudah memilih.
