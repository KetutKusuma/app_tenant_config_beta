import React, { useState } from "react";
import { 
  X, 
  Search, 
  BookOpen, 
  Code2, 
  Layers, 
  ShieldAlert, 
  Filter, 
  CheckCircle2, 
  KeyRound, 
  Copy, 
  Check, 
  Sparkles
} from "lucide-react";

interface DocsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface DocSection {
  id: string;
  title: string;
  badge?: string;
  icon: any;
  summary: string;
  content: React.ReactNode;
}

export const DocsModal: React.FC<DocsModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<string>("concept");
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyCode = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2500);
  };

  const sections: DocSection[] = [
    {
      id: "concept",
      title: "Konsep & Cara Kerja",
      badge: "Core",
      icon: Layers,
      summary: "Memahami dynamic schema, tabel database, dan alur eksekusi di backend ATS.",
      content: (
        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          <div>
            <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2 mb-1.5">
              <span className="w-2 h-2 rounded-full bg-indigo-400" /> Apa itu <code className="text-indigo-300 font-mono">tenant_configurations</code>?
            </h4>
            <p>
              Merupakan tabel dinamis di database PostgreSQL ATS (<code className="text-slate-200 font-mono">public.tenant_configurations</code>). 
              Alih-alih membuat tabel fisik baru atau migrasi database (<code className="font-mono text-amber-300">ALTER TABLE</code>) setiap kali ada klien baru, 
              seluruh definisi tampilan (views), filter pencarian, validasi form, dan custom field disimpan dalam bentuk dokumen <strong>JSONB</strong>.
            </p>
          </div>

          <div className="bg-slate-950/70 p-3 rounded-lg border border-slate-800 space-y-2">
            <h5 className="font-semibold text-slate-200 text-xs">Siklus Eksekusi Request di Backend ATS:</h5>
            <ol className="list-decimal list-inside space-y-1 text-slate-400 text-[11px]">
              <li><strong className="text-slate-200">beforeExecute:</strong> Interceptor payload & injeksi izin data pengguna (auth context).</li>
              <li><strong className="text-slate-200">validation:</strong> Validasi input dinamis (REQUIRED, regex, atau kondisi kondisional <code className="text-cyan-300">when</code>).</li>
              <li><strong className="text-slate-200">SQL Query Builder:</strong> Membangun SELECT query, JOIN relasional, WHERE filterable, dan Subquery.</li>
              <li><strong className="text-slate-200">Views Projection:</strong> Mengekstrak data via ekspresi JMESPath dari kolom entity / JSONB.</li>
              <li><strong className="text-slate-200">afterExecute:</strong> Resolusi signed URL S3/GCS (<code className="text-cyan-300">ResolveFileUrls</code>) dan dekripsi data rahasia PII (<code className="text-cyan-300">ResolveEncryptedFields</code>).</li>
              <li><strong className="text-slate-200">JSON Response:</strong> Data terproyeksi dikirimkan ke frontend ATS.</li>
            </ol>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
              <span className="font-semibold text-indigo-300 block mb-0.5">Database ATS (Live)</span>
              <p className="text-slate-400">Menyimpan versi aktif di tabel <code className="font-mono text-slate-200">public.tenant_configurations</code>. Jika <code className="font-mono text-amber-300">tenant_id IS NULL</code>, berlaku sebagai Global Default.</p>
            </div>
            <div className="p-2.5 rounded bg-slate-950 border border-slate-800">
              <span className="font-semibold text-emerald-300 block mb-0.5">Audit DB (NeonDB)</span>
              <p className="text-slate-400">Menyimpan riwayat versi (history snapshot, rollback, author) di schema <code className="font-mono text-slate-200">tenant_studio</code> agar tidak membebani database utama ATS.</p>
            </div>
          </div>
        </div>
      )
    },
    {
      id: "views",
      title: "views & resolvePaths",
      badge: "Kritis",
      icon: Code2,
      summary: "Serialisasi field output, JMESPath, SQL JOIN, subquery, dan guardrail resolvePaths.",
      content: (
        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          <div>
            <h4 className="text-sm font-semibold text-slate-100 mb-1.5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-cyan-400" /> Properti Utama dalam Array <code className="text-cyan-300 font-mono">views</code>
            </h4>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div className="bg-slate-950 p-2 rounded border border-slate-800">
                <code className="text-cyan-300 font-mono">view</code>: Nama key output JSON (contoh: <code className="text-slate-300">"candidateName"</code>)
              </div>
              <div className="bg-slate-950 p-2 rounded border border-slate-800">
                <code className="text-cyan-300 font-mono">column</code>: Kolom target di DB (contoh: <code className="text-slate-300">"name"</code> atau <code className="text-slate-300">"customFields"</code>)
              </div>
              <div className="bg-slate-950 p-2 rounded border border-slate-800">
                <code className="text-cyan-300 font-mono">path</code>: Ekspresi JMESPath (contoh: <code className="text-slate-300">{"\"$candidate.profilePhotoMedia.{url: url}\""}</code>)
              </div>
              <div className="bg-slate-950 p-2 rounded border border-slate-800">
                <code className="text-cyan-300 font-mono">isFile</code>: Boolean <code className="text-slate-300">true</code> jika bertipe media/file
              </div>
            </div>
          </div>

          {/* Alert Kritis: resolvePaths */}
          <div className="bg-rose-950/40 border border-rose-500/40 rounded-lg p-3 space-y-1.5">
            <div className="flex items-center gap-2 text-rose-300 font-semibold text-xs">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>ATURAN KRITIS: Apa itu `resolvePaths` & Kenapa Error 500 UUID?</span>
            </div>
            <p className="text-[11px] text-rose-200/90 leading-normal">
              <code className="bg-rose-900/50 px-1 py-0.2 rounded font-mono text-rose-100">resolvePaths</code> adalah array path yang memberi tahu service resolver (<code className="font-mono">ResolveFileUrls</code>) 
              lokasi nested property yang harus digenerate presigned URL-nya.
            </p>
            <div className="p-2 bg-slate-950/80 rounded border border-rose-900/60 font-mono text-[10px] text-slate-300 space-y-1">
              <p className="text-red-400">✗ SALAH (Memicu 500 invalid input syntax for type uuid):</p>
              <p className="text-slate-400">Memasang resolvePaths pada kolom file langsung yang mengembalikan UUID string mentah.</p>
              <p className="text-emerald-400 pt-1">✓ BENAR:</p>
              <p className="text-slate-300">Hanya gunakan resolvePaths pada array nested <code className="text-cyan-300">customFields</code> yang memiliki sub-properti seperti <code className="text-slate-300">.meta.fileKey</code> dan <code className="text-slate-300">.meta.url</code>!</p>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-slate-200 text-xs">Contoh Proyeksi View File Custom:</span>
              <button
                onClick={() => copyCode(`{\n  "path": "$customFields[?fieldKey=='ktpId'].meta | [0].{fileKey: fileKey, url: url, mimeType: mime}",\n  "view": "ktp",\n  "label": "KTP",\n  "column": "customFields",\n  "isFile": true,\n  "resolvePaths": [\n    "$customFields[?fieldKey=='ktpId'].meta.fileKey",\n    "$customFields[?fieldKey=='ktpId'].meta.url"\n  ]\n}`, "snip-view")}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
              >
                {copiedSnippet === "snip-view" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedSnippet === "snip-view" ? "Disalin!" : "Salin JSON"}
              </button>
            </div>
            <pre className="bg-slate-950 p-2.5 rounded border border-slate-800 font-mono text-[10.5px] text-cyan-300 overflow-x-auto">
{`{
  "path": "$customFields[?fieldKey=='ktpId'].meta | [0].{fileKey: fileKey, url: url, mimeType: mime}",
  "view": "ktp",
  "label": "KTP",
  "column": "customFields",
  "isFile": true,
  "resolvePaths": [
    "$customFields[?fieldKey=='ktpId'].meta.fileKey",
    "$customFields[?fieldKey=='ktpId'].meta.url"
  ]
}`}
            </pre>
          </div>
        </div>
      )
    },
    {
      id: "filterable",
      title: "filterable & Search",
      badge: "Query",
      icon: Filter,
      summary: "Konfigurasi filter dinamis, operator SQL, data types, dan full-text search.",
      content: (
        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          <div>
            <h4 className="text-sm font-semibold text-slate-100 mb-1.5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-amber-400" /> Dynamic Filtering (<code className="text-amber-300 font-mono">filterable</code>)
            </h4>
            <p className="text-[11px] text-slate-400">
              Mendefinisikan parameter query yang diizinkan untuk menyaring data pada endpoint list/search.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-slate-200 text-xs">Contoh Konfigurasi Filter:</span>
              <button
                onClick={() => copyCode(`[\n  {\n    "key": "status",\n    "path": "$requestBody.status",\n    "type": "TEXT",\n    "column": "status",\n    "operator": "EQUALS"\n  },\n  {\n    "key": "jobPositionId",\n    "path": "$requestBody.jobPositionId",\n    "type": "UUID",\n    "column": "jobPositionId",\n    "operator": "EQUALS"\n  },\n  {\n    "key": "expiredDateFrom",\n    "type": "DATETIME",\n    "column": "expiredDate",\n    "operator": "GREATER_THAN_EQUALS"\n  }\n]`, "snip-filter")}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
              >
                {copiedSnippet === "snip-filter" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedSnippet === "snip-filter" ? "Disalin!" : "Salin JSON"}
              </button>
            </div>
            <pre className="bg-slate-950 p-2.5 rounded border border-slate-800 font-mono text-[10.5px] text-amber-200 overflow-x-auto">
{`[
  {
    "key": "status",
    "path": "$requestBody.status",
    "type": "TEXT",
    "column": "status",
    "operator": "EQUALS"
  },
  {
    "key": "jobPositionId",
    "path": "$requestBody.jobPositionId",
    "type": "UUID",
    "column": "jobPositionId",
    "operator": "EQUALS"
  },
  {
    "key": "expiredDateFrom",
    "type": "DATETIME",
    "column": "expiredDate",
    "operator": "GREATER_THAN_EQUALS"
  }
]`}
            </pre>
          </div>

          <div className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1">
            <span className="font-semibold text-slate-200 text-[11px] block">Pencarian Teks Bebas (<code className="text-amber-300 font-mono">searchable</code>):</span>
            <p className="text-[11px] text-slate-400">
              Menentukan array kolom atau JMESPath yang secara otomatis dicari menggunakan klausa <code className="font-mono text-slate-200">ILIKE</code> saat parameter <code className="font-mono text-cyan-300">?search=...</code> dikirim.
            </p>
            <pre className="bg-slate-900/80 p-2 rounded text-[10px] font-mono text-slate-300">
{`"searchable": [
  "$requestBody.name",
  "$entity.jobPosition.meta.name",
  "$entity.organization.meta.name"
]`}
            </pre>
          </div>
        </div>
      )
    },
    {
      id: "validation",
      title: "validation & Rules",
      badge: "Guard",
      icon: CheckCircle2,
      summary: "Validasi bersyarat dinamis (REQUIRED, FORMAT) dengan kondisi when.",
      content: (
        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          <div>
            <h4 className="text-sm font-semibold text-slate-100 mb-1.5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400" /> Dynamic Conditional Validation
            </h4>
            <p className="text-[11px] text-slate-400">
              Validasi dinamis per field yang dapat disesuaikan per tenant tanpa perlu memprogram ulang backend. Mendukung aturan kondisional dinamis (<code className="text-emerald-300 font-mono">when</code>).
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-slate-200 text-xs">Contoh: Wajib Isi Jika Status = ACTIVE</span>
              <button
                onClick={() => copyCode(`[\n  {\n    "key": "$requestBody.headcountQuota",\n    "rule": "REQUIRED",\n    "orCondition": [],\n    "andCondition": [\n      {\n        "when": {\n          "left": "$requestBody.status",\n          "right": "ACTIVE",\n          "operator": "EQUALS"\n        }\n      }\n    ]\n  }\n]`, "snip-valid")}
                className="flex items-center gap-1 text-[10px] text-slate-400 hover:text-slate-200"
              >
                {copiedSnippet === "snip-valid" ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                {copiedSnippet === "snip-valid" ? "Disalin!" : "Salin JSON"}
              </button>
            </div>
            <pre className="bg-slate-950 p-2.5 rounded border border-slate-800 font-mono text-[10.5px] text-emerald-300 overflow-x-auto">
{`[
  {
    "key": "$requestBody.headcountQuota",
    "rule": "REQUIRED",
    "orCondition": [],
    "andCondition": [
      {
        "when": {
          "left": "$requestBody.status",
          "right": "ACTIVE",
          "operator": "EQUALS"
        }
      }
    ]
  }
]`}
            </pre>
          </div>
        </div>
      )
    },
    {
      id: "security",
      title: "Keamanan (decryptable)",
      badge: "Security",
      icon: KeyRound,
      summary: "Perlindungan data pribadi (PII), kolom terenkripsi, dan service ResolveEncryptedFields.",
      content: (
        <div className="space-y-4 text-xs text-slate-300 leading-relaxed">
          <div>
            <h4 className="text-sm font-semibold text-slate-100 mb-1.5 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400" /> Enkripsi Data Sensitif Pelamar (UU PDP / GDPR)
            </h4>
            <p className="text-[11px] text-slate-400">
              Data pribadi (PII) seperti nomor KTP, tanggal lahir, nomor HP, dan email disimpan dalam kolom terenkripsi di database (<code className="font-mono text-purple-300">emailEncrypted</code>, <code className="font-mono text-purple-300">identityNumberEncrypted</code>).
            </p>
          </div>

          <div className="bg-slate-950 p-3 rounded border border-slate-800 space-y-2">
            <span className="font-semibold text-slate-200 text-xs block">Konfigurasi <code className="font-mono text-purple-300">decryptable</code>:</span>
            <pre className="bg-slate-900 p-2 rounded text-[10.5px] font-mono text-purple-300">
{`"decryptable": [
  "email",
  "emailEncrypted",
  "phoneNumber",
  "dateOfBirth",
  "identityNumber"
]`}
            </pre>
            <p className="text-[11px] text-slate-400">
              Service <code className="font-mono text-cyan-300">ResolveEncryptedFields</code> pada lifecycle <code className="font-mono text-indigo-300">afterExecute</code> akan secara otomatis mendeskripsi field ini menjadi plaintext <strong>hanya jika</strong> pengguna yang mengakses memiliki data permission yang sah.
            </p>
          </div>
        </div>
      )
    },
    {
      id: "troubleshoot",
      title: "FAQ & Troubleshooting",
      badge: "Solusi",
      icon: Sparkles,
      summary: "Diagnosa cepat untuk error yang sering terjadi di environment ATS.",
      content: (
        <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
          <div className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1">
            <h5 className="font-semibold text-red-300 text-xs">1. Error 500 "invalid input syntax for type uuid"</h5>
            <p className="text-[11px] text-slate-400">
              <strong>Penyebab:</strong> Properti <code className="font-mono text-red-300">resolvePaths</code> salah dipasang pada field yang mengembalikan UUID string biasa atau kolom file root.
            </p>
            <p className="text-[11px] text-emerald-300">
              <strong>Solusi:</strong> Hapus baris <code className="font-mono">resolvePaths</code> dari view tersebut. Cek panel Linter Validator di Tenant Studio untuk menemukan lokasinya.
            </p>
          </div>

          <div className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1">
            <h5 className="font-semibold text-amber-300 text-xs">2. Custom Field Tidak Muncul di Frontend</h5>
            <p className="text-[11px] text-slate-400">
              <strong>Penyebab:</strong> Field sudah terdaftar di <code className="font-mono text-amber-300">customData.fields</code>, tapi belum didaftarkan di array <code className="font-mono text-cyan-300">views</code>.
            </p>
            <p className="text-[11px] text-emerald-300">
              <strong>Solusi:</strong> Tambahkan item view baru di array views dengan <code className="font-mono">column: "customFields"</code> dan path yang sesuai.
            </p>
          </div>

          <div className="p-2.5 rounded bg-slate-950 border border-slate-800 space-y-1">
            <h5 className="font-semibold text-cyan-300 text-xs">3. Mengapa Ada Perbedaan File vs Database padahal Isinya Sama?</h5>
            <p className="text-[11px] text-slate-400">
              PostgreSQL <code className="font-mono">JSONB</code> tidak menyimpan urutan key. Gunakan fitur <strong>Sync Center</strong> di Tenant Studio yang menggunakan perbandingan kanonikal rekursif sehingga tidak memicu false-diff.
            </p>
          </div>
        </div>
      )
    }
  ];

  const filteredSections = searchFilter.trim()
    ? sections.filter(
        s =>
          s.title.toLowerCase().includes(searchFilter.toLowerCase()) ||
          s.summary.toLowerCase().includes(searchFilter.toLowerCase()) ||
          s.id.toLowerCase().includes(searchFilter.toLowerCase())
      )
    : sections;

  const currentSection = sections.find(s => s.id === activeTab) || sections[0];

  return (
    <div className="fixed inset-0 bg-slate-950/85 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-800 rounded-xl w-full max-w-5xl h-[86vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header Modal */}
        <div className="h-12 border-b border-slate-800 px-4 flex items-center justify-between bg-slate-950/60 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400 shrink-0">
              <BookOpen className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-xs flex items-center gap-2">
                Buku Panduan & Dokumentasi Tenant Configuration
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-purple-500/20 text-purple-300 font-mono border border-purple-500/30">
                  v2.0
                </span>
              </h3>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Search Box Minimalis */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchFilter}
                onChange={e => setSearchFilter(e.target.value)}
                placeholder="Cari fitur (misal: resolvePaths)..."
                className="w-56 bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-purple-500 transition"
              />
            </div>

            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-200 p-1 rounded-lg hover:bg-slate-800 transition"
              title="Tutup Panduan"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Content Body: Split Left (Tabs) & Right (Content) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Sidebar Menu */}
          <div className="w-64 border-r border-slate-800 bg-slate-950/40 p-2 space-y-1 overflow-y-auto shrink-0">
            <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Topik Pembahasan
            </div>
            {filteredSections.map(s => {
              const Icon = s.icon;
              const isActive = activeTab === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => setActiveTab(s.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium transition flex items-center justify-between gap-2 ${
                    isActive
                      ? "bg-purple-600/20 text-purple-200 border border-purple-500/30 shadow-sm"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 border border-transparent"
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? "text-purple-400" : "text-slate-500"}`} />
                    <span className="truncate">{s.title}</span>
                  </div>
                  {s.badge && (
                    <span className={`text-[9px] px-1 py-0.2 rounded font-mono shrink-0 ${
                      s.badge === "Kritis" ? "bg-red-500/20 text-red-300" : "bg-slate-800 text-slate-400"
                    }`}>
                      {s.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* Right Main Content */}
          <div className="flex-1 overflow-y-auto p-5 bg-slate-900/60 flex flex-col justify-between">
            <div className="space-y-4 max-w-3xl">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-bold text-slate-100">{currentSection.title}</h2>
                  {currentSection.badge && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded font-mono bg-purple-500/20 text-purple-300 border border-purple-500/30">
                      {currentSection.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">{currentSection.summary}</p>
              </div>

              <div className="border-t border-slate-800/80 pt-3">
                {currentSection.content}
              </div>
            </div>

            {/* Bottom Footer Info */}
            <div className="pt-4 mt-6 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
              <span>File panduan lengkap tersedia di: <code className="text-slate-400 font-mono">docs/TENANT_CONFIGURATION_GUIDE.md</code></span>
              <button
                onClick={onClose}
                className="px-3 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
