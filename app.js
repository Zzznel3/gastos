(() => {
  'use strict';

  const CFG = window.APP_CONFIG || {};

  const CATEGORIAS = [
    { nombre: 'Comida', icono: '🍽️' },
    { nombre: 'Supermercado', icono: '🛒' },
    { nombre: 'Transporte', icono: '🚌' },
    { nombre: 'Casa', icono: '🏠' },
    { nombre: 'Cuentas', icono: '💡' },
    { nombre: 'Salud', icono: '💊' },
    { nombre: 'Ocio', icono: '🎬' },
    { nombre: 'Ropa', icono: '👕' },
    { nombre: 'Educación', icono: '📚' },
    { nombre: 'Otros', icono: '📦' },
  ];
  const METODOS = ['Débito', 'Crédito', 'Efectivo', 'Transferencia'];

  // Cola de cambios hechos sin conexión y copia local de cada mes.
  const COLA_KEY = 'gastos:cola';
  const MES_KEY = 'gastos:mes:';

  const $ = (sel) => document.querySelector(sel);
  const dinero = new Intl.NumberFormat('es-CL', { style: 'currency', currency: CFG.MONEDA || 'CLP' });
  const fmtMes = new Intl.DateTimeFormat('es-CL', { month: 'long', year: 'numeric' });
  const fmtDia = new Intl.DateTimeFormat('es-CL', { weekday: 'short', day: 'numeric', month: 'short' });

  const hoy = new Date();
  const estado = {
    anio: hoy.getFullYear(),
    mes: hoy.getMonth(),
    gastos: [],
    usuario: null,
    pantalla: null,
    editando: null,
  };

  // ---------- Utilidades ----------

  function leer(clave, porDefecto) {
    try {
      const v = localStorage.getItem(clave);
      return v ? JSON.parse(v) : porDefecto;
    } catch {
      return porDefecto;
    }
  }

  function escribir(clave, valor) {
    try {
      localStorage.setItem(clave, JSON.stringify(valor));
    } catch {}
  }

  function borrarDatosLocales() {
    try {
      Object.keys(localStorage).filter((k) => k.startsWith('gastos:')).forEach((k) => localStorage.removeItem(k));
    } catch {}
  }

  const escapar = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const pad = (n) => String(n).padStart(2, '0');
  const isoLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const desdeIso = (iso) => {
    const [a, m, d] = iso.split('-').map(Number);
    return new Date(a, m - 1, d);
  };
  const claveMes = () => `${estado.anio}-${pad(estado.mes + 1)}`;
  const rangoMes = () => [`${claveMes()}-01`, isoLocal(new Date(estado.anio, estado.mes + 1, 1))];
  const iconoDe = (cat) => (CATEGORIAS.find((c) => c.nombre === cat) || CATEGORIAS[CATEGORIAS.length - 1]).icono;

  let temporizadorToast;
  function aviso(texto) {
    const t = $('#toast');
    t.textContent = texto;
    t.hidden = false;
    clearTimeout(temporizadorToast);
    temporizadorToast = setTimeout(() => (t.hidden = true), 3500);
  }

  function mostrar(pantalla) {
    estado.pantalla = pantalla;
    for (const p of ['config', 'login', 'app']) $(`#pantalla-${p}`).hidden = p !== pantalla;
  }

  // ---------- Supabase ----------

  const configurado =
    CFG.SUPABASE_URL && !CFG.SUPABASE_URL.includes('TU-PROYECTO') &&
    CFG.SUPABASE_ANON_KEY && !CFG.SUPABASE_ANON_KEY.startsWith('TU-');
  const sb = configurado && window.supabase ? window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY) : null;

  // ---------- Cola offline ----------

  const cola = () => leer(COLA_KEY, []);

  function encolar(op) {
    // Un cambio nuevo sobre el mismo gasto reemplaza al anterior pendiente.
    const resto = cola().filter((o) => o.id !== op.id);
    resto.push({ ...op, ts: Date.now() });
    escribir(COLA_KEY, resto);
  }

  const ordenar = (lista) =>
    lista.sort((a, b) => b.fecha.localeCompare(a.fecha) || (b.created_at || '').localeCompare(a.created_at || ''));

  // Junta lo que vino del servidor con los cambios que aún no se suben.
  function aplicarCola(lista) {
    const [desde, hasta] = rangoMes();
    const porId = new Map(lista.map((g) => [g.id, g]));
    for (const op of cola()) {
      if (op.tipo === 'borrar' || op.fila.fecha < desde || op.fila.fecha >= hasta) porId.delete(op.id);
      else porId.set(op.id, { ...op.fila, pendiente: true });
    }
    return ordenar([...porId.values()]);
  }

  let sincronizando = false;
  async function sincronizar() {
    if (sincronizando || !sb || !estado.usuario || !navigator.onLine) return;
    sincronizando = true;
    let subidos = 0;
    try {
      for (let op = cola()[0]; op; op = cola()[0]) {
        const { error } = op.tipo === 'borrar'
          ? await sb.from('gastos').delete().eq('id', op.id)
          : await sb.from('gastos').upsert(op.fila);
        if (error) {
          // Sin código = falla de red o sesión: se reintenta más tarde.
          // Con código de Postgres = el dato es inválido: se descarta para no trabar la cola.
          if (!error.code || error.code.startsWith('PGRST')) break;
          aviso(`Un gasto no se pudo guardar (${error.message}) y se descartó.`);
        }
        escribir(COLA_KEY, cola().filter((o) => !(o.id === op.id && o.ts === op.ts)));
        subidos++;
      }
    } finally {
      sincronizando = false;
      actualizarRed();
    }
    if (subidos) await cargarMes({ desdeCopia: false });
  }

  // ---------- Datos ----------

  async function cargarMes({ desdeCopia = true } = {}) {
    const clave = claveMes();
    if (desdeCopia) {
      estado.gastos = aplicarCola(leer(MES_KEY + clave, []));
      render();
    }
    if (!sb || !navigator.onLine) return;

    const [desde, hasta] = rangoMes();
    const { data, error } = await sb
      .from('gastos')
      .select('id, monto, categoria, fecha, metodo, nota, created_at')
      .gte('fecha', desde)
      .lt('fecha', hasta)
      .order('fecha', { ascending: false })
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code) aviso('No se pudieron cargar los gastos: ' + error.message);
      return;
    }
    if (clave !== claveMes()) return; // se cambió de mes mientras cargaba
    escribir(MES_KEY + clave, data);
    estado.gastos = aplicarCola(data);
    render();
  }

  // ---------- Pintado ----------

  function render() {
    $('#mes-titulo').textContent = fmtMes.format(new Date(estado.anio, estado.mes, 1));

    const gastos = estado.gastos;
    const total = gastos.reduce((s, g) => s + Number(g.monto), 0);
    $('#total').textContent = dinero.format(total);
    $('#conteo').textContent = gastos.length === 1 ? '1 gasto' : `${gastos.length} gastos`;

    // Resumen por categoría
    const porCat = new Map();
    for (const g of gastos) porCat.set(g.categoria, (porCat.get(g.categoria) || 0) + Number(g.monto));
    const cats = [...porCat.entries()].sort((a, b) => b[1] - a[1]);
    const mayor = cats.length ? cats[0][1] : 1;
    $('#por-categoria').innerHTML = cats
      .map(([cat, monto]) => `
        <li>
          <span>${iconoDe(cat)} ${escapar(cat)}</span>
          <span class="val">${dinero.format(monto)} · ${Math.round((monto / total) * 100)}%</span>
          <div class="fondo-barra"><div class="relleno" style="width:${((monto / mayor) * 100).toFixed(1)}%"></div></div>
        </li>`)
      .join('');

    // Lista agrupada por día
    if (!gastos.length) {
      $('#lista').innerHTML = '<p class="vacio">Sin gastos este mes.<br>Toca + para agregar uno.</p>';
      return;
    }
    const porDia = new Map();
    for (const g of gastos) {
      if (!porDia.has(g.fecha)) porDia.set(g.fecha, []);
      porDia.get(g.fecha).push(g);
    }
    $('#lista').innerHTML = [...porDia.entries()]
      .map(([fecha, items]) => `
        <div class="dia">
          <h3><span>${fmtDia.format(desdeIso(fecha))}</span><span>${dinero.format(items.reduce((s, g) => s + Number(g.monto), 0))}</span></h3>
          <div class="dia-items">
            ${items.map((g) => `
              <button class="gasto" data-id="${escapar(g.id)}">
                <span class="ico">${iconoDe(g.categoria)}</span>
                <span class="txt">
                  <strong>${escapar(g.categoria)}</strong>
                  <small>${[g.nota, g.metodo].filter(Boolean).map(escapar).join(' · ')}${g.pendiente ? ' · <span class="pendiente">sin subir</span>' : ''}</small>
                </span>
                <span class="monto">${dinero.format(Number(g.monto))}</span>
              </button>`).join('')}
          </div>
        </div>`)
      .join('');
  }

  function actualizarRed() {
    const n = cola().length;
    const red = $('#red');
    if (!navigator.onLine) {
      red.textContent = 'Sin conexión · los gastos se guardan en el teléfono' + (n ? ` (${n} sin subir)` : '');
      red.hidden = false;
    } else if (n) {
      red.textContent = `Subiendo ${n} ${n === 1 ? 'cambio' : 'cambios'}…`;
      red.hidden = false;
    } else {
      red.hidden = true;
    }
  }

  // ---------- Formulario de gasto ----------

  const dlg = $('#dlg-gasto');
  const form = $('#form-gasto');

  $('#chips-categoria').innerHTML = CATEGORIAS.map((c) => `
    <label class="chip">
      <input type="radio" name="categoria" value="${c.nombre}" required>
      <span>${c.icono} ${c.nombre}</span>
    </label>`).join('');
  $('#sel-metodo').innerHTML = METODOS.map((m) => `<option>${m}</option>`).join('');

  function abrirFormulario(gasto = null) {
    estado.editando = gasto;
    form.reset();
    $('#dlg-titulo').textContent = gasto ? 'Editar gasto' : 'Nuevo gasto';
    $('#btn-borrar').hidden = !gasto;
    form.monto.value = gasto ? Number(gasto.monto) : '';
    form.fecha.value = gasto ? gasto.fecha : isoLocal(new Date());
    form.metodo.value = gasto ? gasto.metodo : leer('gastos:ultimo-metodo', METODOS[0]);
    form.nota.value = gasto?.nota || '';
    const cat = form.querySelector(`input[name="categoria"][value="${gasto ? gasto.categoria : ''}"]`);
    if (cat) cat.checked = true;
    dlg.showModal();
    if (!gasto) form.monto.focus();
  }

  function cerrarFormulario() {
    estado.editando = null;
    dlg.close();
  }

  function refrescarTrasCambio(fecha) {
    estado.gastos = aplicarCola(leer(MES_KEY + claveMes(), []));
    render();
    actualizarRed();
    const [desde, hasta] = rangoMes();
    if (fecha && (fecha < desde || fecha >= hasta)) {
      aviso(`Guardado en ${fmtMes.format(desdeIso(fecha))}`);
    }
    sincronizar();
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    const monto = Number(form.monto.value);
    if (!(monto > 0)) {
      form.monto.focus();
      return;
    }
    const previo = estado.editando;
    const fila = {
      id: previo ? previo.id : crypto.randomUUID(),
      monto,
      categoria: form.categoria.value,
      fecha: form.fecha.value,
      metodo: form.metodo.value,
      nota: form.nota.value.trim() || null,
      created_at: previo?.created_at || new Date().toISOString(),
    };
    escribir('gastos:ultimo-metodo', fila.metodo);
    encolar({ tipo: 'guardar', id: fila.id, fila });
    cerrarFormulario();
    refrescarTrasCambio(fila.fecha);
  });

  $('#btn-borrar').addEventListener('click', () => {
    const g = estado.editando;
    if (!g || !confirm(`¿Borrar este gasto de ${dinero.format(Number(g.monto))}?`)) return;
    encolar({ tipo: 'borrar', id: g.id });
    cerrarFormulario();
    refrescarTrasCambio();
  });

  $('#dlg-cerrar').addEventListener('click', cerrarFormulario);
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) cerrarFormulario(); // toque fuera del formulario
  });

  $('#btn-nuevo').addEventListener('click', () => abrirFormulario());

  $('#lista').addEventListener('click', (ev) => {
    const btn = ev.target.closest('.gasto');
    if (!btn) return;
    const g = estado.gastos.find((x) => x.id === btn.dataset.id);
    if (g) abrirFormulario(g);
  });

  // ---------- Navegación de meses ----------

  function moverMes(delta) {
    const d = new Date(estado.anio, estado.mes + delta, 1);
    estado.anio = d.getFullYear();
    estado.mes = d.getMonth();
    cargarMes();
  }

  $('#mes-ant').addEventListener('click', () => moverMes(-1));
  $('#mes-sig').addEventListener('click', () => moverMes(1));

  // ---------- Sesión ----------

  const formLogin = $('#form-login');
  const loginMsg = $('#login-msg');

  async function entrar(registro) {
    if (!formLogin.reportValidity()) return;
    const email = formLogin.email.value.trim();
    const password = formLogin.password.value;
    const botones = formLogin.querySelectorAll('button');
    botones.forEach((b) => (b.disabled = true));
    loginMsg.textContent = registro ? 'Creando cuenta…' : 'Entrando…';
    const { data, error } = registro
      ? await sb.auth.signUp({ email, password })
      : await sb.auth.signInWithPassword({ email, password });
    botones.forEach((b) => (b.disabled = false));
    if (error) {
      loginMsg.textContent = error.message === 'Invalid login credentials' ? 'Correo o contraseña incorrectos.' : error.message;
    } else if (registro && !data.session) {
      loginMsg.textContent = 'Cuenta creada. Revisa tu correo para confirmarla y luego entra.';
    } else {
      loginMsg.textContent = '';
    }
  }

  formLogin.addEventListener('submit', (ev) => {
    ev.preventDefault();
    entrar(false);
  });
  $('#btn-registro').addEventListener('click', () => entrar(true));

  $('#btn-salir').addEventListener('click', async () => {
    const n = cola().length;
    const pregunta = n
      ? `Hay ${n} ${n === 1 ? 'cambio' : 'cambios'} sin subir que se perderán. ¿Cerrar sesión igual?`
      : '¿Cerrar sesión?';
    if (!confirm(pregunta)) return;
    await sb.auth.signOut();
    borrarDatosLocales();
  });

  function alCambiarSesion(sesion) {
    const usuario = sesion?.user || null;
    if (estado.pantalla && (usuario?.id ?? null) === (estado.usuario?.id ?? null)) return;
    estado.usuario = usuario;
    if (!usuario) {
      estado.gastos = [];
      mostrar('login');
      return;
    }
    mostrar('app');
    actualizarRed();
    cargarMes();
    sincronizar();
  }

  function iniciar() {
    if (!configurado) {
      mostrar('config');
      return;
    }
    if (!sb) {
      $('#config-msg').textContent = 'No se pudo cargar la app. Revisa tu conexión y vuelve a abrirla.';
      mostrar('config');
      return;
    }
    // Supabase recomienda no llamar a sus métodos dentro de este callback: se difiere con setTimeout.
    sb.auth.onAuthStateChange((_evento, sesion) => setTimeout(() => alCambiarSesion(sesion), 0));
  }

  window.addEventListener('online', () => {
    actualizarRed();
    sincronizar();
    if (estado.usuario) cargarMes({ desdeCopia: false });
  });
  window.addEventListener('offline', actualizarRed);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') sincronizar();
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  iniciar();
})();
