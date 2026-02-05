# Panduan Setup KV Namespace (Wajib)
## Required / Wajib

Agar aplikasi ini dapat berjalan di Cloudflare Workers, Anda **harus** membuat KV Namespace dan memperbarui `wrangler.toml`. Tanpa langkah ini, deploy akan gagal atau aplikasi akan error.

### 1. Buat KV Namespace
Jalankan perintah berikut di terminal:
```bash
npx wrangler kv:namespace create vpsai_kv
```

Output akan terlihat seperti ini:
```toml
[[kv_namespaces]]
binding = "vpsai_kv"
id = "a1b2c3d4e5f6..."
```

### 2. Update `wrangler.toml`
Buka file `wrangler.toml` dan ganti bagian `[[kv_namespaces]]` dengan ID yang Anda dapatkan di atas.

Contoh:
**Sebelum:**
```toml
[[kv_namespaces]]
binding = "vpsai_kv"
id = "vpsai_kv_id"
```

**Sesudah:**
```toml
[[kv_namespaces]]
binding = "vpsai_kv"
id = "a1b2c3d4e5f6..."  <-- ID HASIL GENERATE ANDA
```

### 3. Deploy
Setelah ID diupdate, jalankan deploy ulang:
```bash
npx wrangler deploy
```
