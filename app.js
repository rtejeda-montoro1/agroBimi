// =====================================================================
//  Lógica de la app de recuento de ventas
// =====================================================================

// --- Comprobación de configuración ---
if (SUPABASE_URL.startsWith("PON_AQUI") || SUPABASE_ANON_KEY.startsWith("PON_AQUI")) {
  document.getElementById("lista").innerHTML =
    '<div class="error">⚠️ Falta configurar Supabase.<br>' +
    'Edita el archivo <b>config.js</b> con tu URL y tu clave anon (ver README.md).</div>';
}

const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- Referencias al DOM ---
const $ = (id) => document.getElementById(id);
const lista = $("lista");
const modal = $("modal");
const form = $("formVenta");
const fmtEUR = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

let ventasActuales = []; // cache de lo mostrado, para editar sin volver a consultar

// =====================================================================
//  AUTENTICACIÓN (Supabase Auth)
//  Las cuentas se crean desde Supabase → Authentication → Users.
//  No hay registro público: solo entra quien ya tiene usuario.
// =====================================================================
const loginScreen = $("loginScreen");
const loginForm = $("loginForm");
const loginError = $("loginError");
let ventasCargadas = false;

async function initAuth() {
  const { data: { session } } = await db.auth.getSession();
  aplicarSesion(session);
  // Reacciona a cambios de sesión (login, logout, expiración del token)
  db.auth.onAuthStateChange((_evento, session) => aplicarSesion(session));
}

function aplicarSesion(session) {
  const haySesion = !!session;
  document.body.classList.toggle("authed", haySesion);
  if (haySesion) {
    if (!ventasCargadas) { ventasCargadas = true; cargarVentas(); }
  } else {
    ventasCargadas = false;
    lista.innerHTML = "";
  }
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.textContent = "";
  const btn = $("btnLogin");
  btn.disabled = true;
  btn.textContent = "Entrando…";

  const { error } = await db.auth.signInWithPassword({
    email: $("email").value.trim(),
    password: $("password").value,
  });

  btn.disabled = false;
  btn.textContent = "Entrar";
  if (error) {
    loginError.textContent = "Email o contraseña incorrectos.";
  } else {
    loginForm.reset();
  }
});

$("btnLogout").addEventListener("click", async () => {
  await db.auth.signOut();
  toast("Sesión cerrada");
});

// --- Cargar y pintar ventas ---
async function cargarVentas() {
  let query = db.from("ventas").select("*").order("fecha", { ascending: false });

  const desde = $("desde").value;
  const hasta = $("hasta").value;
  const buscar = $("buscar").value.trim();

  if (desde) query = query.gte("fecha", desde);
  if (hasta) query = query.lte("fecha", hasta);
  if (buscar) query = query.or(`producto.ilike.%${buscar}%,factura.ilike.%${buscar}%`);

  const { data, error } = await query;

  if (error) {
    lista.innerHTML = `<div class="error">Error al cargar: ${error.message}</div>`;
    return;
  }
  ventasActuales = data || [];
  pintar(ventasActuales);
}

function pintar(ventas) {
  if (ventas.length === 0) {
    lista.innerHTML = '<div class="empty">No hay ventas para estos filtros.</div>';
  } else {
    lista.innerHTML = ventas.map((v) => `
      <div class="venta">
        <div class="fecha">${formatearFecha(v.fecha)}</div>
        <div class="prod">
          <div>${escapar(v.producto)}</div>
          ${v.factura ? `<div class="factura">Factura: ${escapar(v.factura)}</div>` : ""}
        </div>
        <div class="precio">${fmtEUR.format(v.precio)}</div>
        <div class="acciones">
          <button class="btn-edit btn-sm" data-edit="${v.id}">Editar</button>
          <button class="btn-del btn-sm" data-del="${v.id}">Eliminar</button>
        </div>
      </div>`).join("");
  }

  const total = ventas.reduce((s, v) => s + Number(v.precio), 0);
  $("total").textContent = "Total: " + fmtEUR.format(total);
  $("count").textContent = ventas.length + (ventas.length === 1 ? " venta" : " ventas");
}

// --- Modal ---
function abrirModal(venta = null) {
  form.reset();
  if (venta) {
    $("modalTitulo").textContent = "Editar venta";
    $("ventaId").value = venta.id;
    $("fecha").value = venta.fecha;
    $("producto").value = venta.producto;
    $("precio").value = venta.precio;
    $("factura").value = venta.factura || "";
  } else {
    $("modalTitulo").textContent = "Añadir venta";
    $("ventaId").value = "";
    $("fecha").value = new Date().toISOString().slice(0, 10);
  }
  modal.classList.add("open");
}
function cerrarModal() { modal.classList.remove("open"); }

// --- Guardar (crear o actualizar) ---
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("ventaId").value;
  const registro = {
    fecha: $("fecha").value,
    producto: $("producto").value.trim(),
    precio: parseFloat($("precio").value),
    factura: $("factura").value.trim() || null,
  };

  let error;
  if (id) {
    ({ error } = await db.from("ventas").update(registro).eq("id", id));
  } else {
    ({ error } = await db.from("ventas").insert(registro));
  }

  if (error) { toast("Error: " + error.message); return; }
  cerrarModal();
  toast(id ? "Venta actualizada" : "Venta añadida");
  cargarVentas();
});

// --- Acciones sobre la lista (editar / eliminar) ---
lista.addEventListener("click", async (e) => {
  const edit = e.target.closest("[data-edit]");
  const del = e.target.closest("[data-del]");

  if (edit) {
    const venta = ventasActuales.find((v) => String(v.id) === edit.dataset.edit);
    if (venta) abrirModal(venta);
  } else if (del) {
    if (!confirm("¿Eliminar esta venta? Esta acción no se puede deshacer.")) return;
    const { error } = await db.from("ventas").delete().eq("id", del.dataset.del);
    if (error) { toast("Error: " + error.message); return; }
    toast("Venta eliminada");
    cargarVentas();
  }
});

// --- Eventos de la barra de herramientas ---
$("btnAnadir").addEventListener("click", () => abrirModal());
$("btnCancelar").addEventListener("click", cerrarModal);
$("btnLimpiar").addEventListener("click", () => {
  $("desde").value = "";
  $("hasta").value = "";
  $("buscar").value = "";
  cargarVentas();
});
["desde", "hasta"].forEach((id) => $(id).addEventListener("change", cargarVentas));
let debounce;
$("buscar").addEventListener("input", () => {
  clearTimeout(debounce);
  debounce = setTimeout(cargarVentas, 300);
});
modal.addEventListener("click", (e) => { if (e.target === modal) cerrarModal(); });

// --- Utilidades ---
function formatearFecha(iso) {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
function escapar(txt) {
  const div = document.createElement("div");
  div.textContent = txt;
  return div.innerHTML;
}
function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2500);
}

// --- Arranque ---
// Primero comprobamos la sesión; las ventas se cargan solo tras iniciar sesión.
initAuth();
