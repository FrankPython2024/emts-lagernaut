import { redis } from "./redis";

export async function naechsteBelegNr(typ: "EL" | "AL"): Promise<string> {
  const year = new Date().getFullYear();
  const key  = `beleg:${typ.toLowerCase()}:${year}`;
  try {
    const nr = await redis.incr(key);
    return `${typ}-${year}-${nr.toString().padStart(4, "0")}`;
  } catch {
    // Fallback wenn Redis nicht erreichbar: Timestamp-basiert
    const ts = Date.now().toString().slice(-5);
    return `${typ}-${year}-T${ts}`;
  }
}
