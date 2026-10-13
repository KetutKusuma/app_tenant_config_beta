import dotenv from "dotenv";
import path from "path";

// Muat .env dari root workspace. Diimpor paling awal (lewat db.ts) agar process.env siap
// sebelum Pool & modul lain membacanya.
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
