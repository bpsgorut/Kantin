# Kantin Kejujuran (Pencatatan)

Fitur:
- Produk: nama, kategori (Snack Time / Dunia Mie / Minuman), harga, aktif/nonaktif
- Transaksi: nama pembeli, multi barang + qty, total belanja, status (lunas/hutang), metode pembayaran (tunai/QRIS)
- Riwayat transaksi tetap menyimpan nama barang + kategori saat transaksi dibuat

## Menjalankan

Prasyarat: Node.js 18+ terpasang di komputer.

```bash
npm install
npm run dev
```

Buka:
- http://localhost:3000

Database SQLite otomatis dibuat di folder:
- `data/kantin.db`

## Alur Pakai Cepat

1. Buka menu **Produk** → tambah beberapa barang (isi kategori dan harga).
2. Buka menu **Transaksi** → **Tambah Transaksi** → pilih barang + qty.
3. Jika pembeli belum bayar, pilih **Belum (hutang)**. Jika sudah, pilih metode **Tunai/QRIS**.

