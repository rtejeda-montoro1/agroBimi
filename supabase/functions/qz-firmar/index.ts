// qz-firmar: firma las peticiones que la báscula hace a QZ Tray.
//
// QZ Tray (el programa que imprime las etiquetas en la Toshiba de la
// tablet) solo imprime sin preguntar si la petición viene firmada con la
// clave de nuestro certificado (override.crt en la carpeta de QZ Tray).
// La clave privada NO puede ir en la web, que es pública: vive aquí, en el
// secreto QZ_CLAVE_PRIVADA de Supabase.
//
// Solo firma para la cuenta de la báscula (es_bascula() en schema.sql).
//
// Entrada:  POST { "peticion": "<texto que QZ pide firmar>" }
// Salida:   la firma en base64 (texto plano), SHA512withRSA.
//
// Se crea desde el panel de Supabase (Edge Functions) pegando este archivo,
// con "Verify JWT" activado. Secretos: QZ_CLAVE_PRIVADA (el contenido de
// agroBimi/privado/qz/clave-privada.pem, con sus líneas BEGIN/END).
// SUPABASE_URL y SUPABASE_ANON_KEY ya los pone Supabase.

import { createClient } from "npm:@supabase/supabase-js@2.118.0";

// Páginas que pueden pedir firmas: la de GitHub Pages y, para probar en
// el ordenador, localhost.
const ORIGENES = [
  "https://rtejeda-montoro1.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000",
];

function cabeceras(origen: string | null): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origen && ORIGENES.includes(origen) ? origen : ORIGENES[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

let clave: CryptoKey | null = null;

async function cargarClave(): Promise<CryptoKey> {
  if (clave) return clave;
  const pem = Deno.env.get("QZ_CLAVE_PRIVADA") ?? "";
  const base64 = pem
    .replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  if (!base64) throw new Error("Falta el secreto QZ_CLAVE_PRIVADA");
  const der = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  clave = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-512" }, false, ["sign"],
  );
  return clave;
}

async function firmar(texto: string): Promise<string> {
  const firma = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", await cargarClave(), new TextEncoder().encode(texto),
  );
  let binario = "";
  for (const b of new Uint8Array(firma)) binario += String.fromCharCode(b);
  return btoa(binario);
}

Deno.serve(async (req) => {
  const cors = cabeceras(req.headers.get("Origin"));
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405, headers: cors });

  // ¿Es la cuenta de la báscula? Se pregunta a la base con su propia sesión.
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: esBascula, error } = await db.rpc("es_bascula");
  if (error || esBascula !== true) {
    return new Response("Solo la cuenta de la báscula", { status: 403, headers: cors });
  }

  let peticion: unknown;
  try {
    ({ peticion } = await req.json());
  } catch {
    return new Response("Petición no válida", { status: 400, headers: cors });
  }
  // Lo que QZ firma es un texto corto (un hash más una marca de tiempo).
  if (typeof peticion !== "string" || !peticion || peticion.length > 10000) {
    return new Response("Petición no válida", { status: 400, headers: cors });
  }

  try {
    return new Response(await firmar(peticion), {
      headers: { ...cors, "Content-Type": "text/plain" },
    });
  } catch (e) {
    console.error(e);
    return new Response("No se pudo firmar", { status: 500, headers: cors });
  }
});
