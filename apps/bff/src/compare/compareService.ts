import { serviceAvailability, type ServiceAvailability } from "../envs";
import { SERVICES, type ServiceKey } from "../services";

// Bandingkan/Salin/Export SQL selalu di dalam satu layanan: semua env yang terlibat harus punya layanan itu.

/** Target khusus Export SQL untuk Production (tidak ada koneksi DB), tidak dicek */
const PRODUCTION_MANUAL = "production-manual";

/** Pesan error untuk env pertama yang tidak punya layanan, atau null bila semua tersedia */
export async function assertServiceInEnvs(
  service: ServiceKey,
  envs: string[],
  availability: (env: string) => Promise<ServiceAvailability[]> = serviceAvailability
): Promise<string | null> {
  for (const env of envs) {
    if (!env || env === PRODUCTION_MANUAL) continue;
    const s = (await availability(env)).find((x) => x.key === service);
    if (!s?.available) {
      return `Layanan ${SERVICES[service].label} tidak tersedia di env '${env}'${s?.reason ? `: ${s.reason}` : ""}.`;
    }
  }
  return null;
}
