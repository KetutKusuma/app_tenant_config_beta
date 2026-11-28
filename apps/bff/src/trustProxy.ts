// Percayai hanya hop proxy lokal/privat (nginx, load balancer internal); IP klien = hop publik terakhir
// pada X-Forwarded-For, bukan nilai pertama yang bisa dipalsukan klien.
export const TRUST_PROXY = "loopback, uniquelocal";
