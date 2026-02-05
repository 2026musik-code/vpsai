# Panduan Aktivasi & Setup Cloudflare R2

Project ini menggunakan Cloudflare R2 untuk penyimpanan file cloud. Berikut adalah langkah-langkah untuk mengaktifkannya agar fitur tab "Cloud Storage" di dashboard berfungsi.

## 1. Aktifkan R2 di Cloudflare Dashboard
1. Login ke [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Di menu sidebar sebelah kiri, klik **R2**.
3. Jika ini pertama kali Anda menggunakan R2, Anda mungkin diminta untuk memasukkan metode pembayaran (Cloudflare R2 memiliki tier gratis yang cukup besar: 10GB storage/bulan gratis).
4. Klik tombol **Enable R2** (jika belum aktif).

## 2. Buat Bucket Baru
1. Di halaman dashboard R2, klik tombol **Create Bucket**.
2. Masukkan nama bucket persis seperti ini:

   **`vpsia`**

   *(Penting: Nama harus `vpsia` karena sudah dikonfigurasi di file `wrangler.toml` project ini)*.

3. Klik **Create Bucket**.
4. Biarkan pengaturan lainnya (Location hint, dll) default atau sesuaikan jika Anda mengerti (biasanya `Automatic` sudah cukup baik).

## 3. Verifikasi Konfigurasi Project
Project ini sudah dikonfigurasi untuk terhubung ke bucket tersebut. Anda bisa melihatnya di file `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "vpsai_r2"
bucket_name = "vpsia"
```

Pastikan `bucket_name` di file tersebut sama dengan nama bucket yang Anda buat di langkah ke-2.

## 4. Deploy Project
Setelah bucket dibuat, lakukan deploy ulang agar Worker Anda mendapatkan akses ke R2:

```bash
npm run deploy
# atau
npx wrangler deploy
```

## 5. Selesai!
Sekarang Anda bisa membuka aplikasi web VPS AI Nexus, login, dan klik tab **R2** atau **Cloud Storage** di sidebar file manager. Anda sudah bisa mengupload dan mengelola file di cloud.
