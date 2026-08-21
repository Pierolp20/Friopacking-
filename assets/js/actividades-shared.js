// ============================================================
// ACTIVIDADES DIARIAS (Daily Call In) · cada persona registra su día
// directo en actividades.html (sin Excel de Microsoft Lists): se cruza
// en vivo con data.json de Compras para detectar automáticamente
// regularizaciones/correo/cotizaciones, y se guarda en GitHub
// (actividades.json) fusionando solo la entrada de esa persona+fecha.
// ============================================================
const ActividadesShared = (function(){
const GH_REPO='Melissa2026714/dashboard-friopacking';
const GH_FILE='actividades.json';
const GH_RAW='https://raw.githubusercontent.com/'+GH_REPO+'/main/'+GH_FILE;
const GH_API='https://api.github.com/repos/'+GH_REPO+'/contents/'+GH_FILE;
const GH_TOKEN_KEY='fp_gh_token_actividades';

function fetchTO(url, opts, ms){
  const ms_ = ms || 45000;
  return Promise.race([
    fetch(url, opts),
    new Promise((_,rej)=>setTimeout(()=>rej(new Error('tiempo de espera agotado ('+Math.round(ms_/1000)+'s) al hablar con GitHub — revisa tu conexión e intenta de nuevo')), ms_))
  ]);
}
function getToken(){ return (localStorage.getItem(GH_TOKEN_KEY)||'').trim(); }
function setupGHToken(){
  const cur=localStorage.getItem(GH_TOKEN_KEY)||'';
  const t=prompt('Ingresa el Token de GitHub de Actividades\n(propio de este módulo — se guarda solo en este navegador):',cur);
  if(t!==null){
    localStorage.setItem(GH_TOKEN_KEY,t.trim());
    alert(t.trim()?'✅ Token guardado.':'⚠ Token eliminado.');
  }
}

async function loadRemote(){
  try{
    const res = await fetchTO(GH_RAW+'?t='+Date.now());
    if(!res.ok) return null;
    return await res.json();
  }catch(e){
    console.error('No se pudo leer actividades.json', e);
    return null;
  }
}

// ── Registro por persona (reemplaza al Excel de Microsoft Lists) ────────────
// Equipo fijo — cada persona ve y registra su propio día. "ucomp" es el código
// de comprador tal como aparece en las OC de Compras (D.oc[].ucomp); se usa
// para cruzar regularizaciones y envío de OC. Almacén/Comex no tienen todavía
// un cruce automático propio — registran todo manual por ahora.
const EQUIPO = [
  {nombre:'Piero Linares', area:'COMPRAS', ucomp:'PLINARES'},
  {nombre:'Carolina Checa', area:'COMPRAS', ucomp:'CCHECA'},
  {nombre:'Melissa Sihuairo', area:'COMPRAS', ucomp:'MSIHUAIRO'},
  {nombre:'Jose Pomez', area:'COMPRAS', ucomp:'JPOMEZ'},
  {nombre:'Jaime Altamirano', area:'COMPRAS', ucomp:'JALTAMIRANO'},
  {nombre:'Jose Casarino', area:'COMEX'},
  {nombre:'Camila Mora', area:'COMEX'},
  // revisorNombre: como aparece en inventario.html (REVISORES=['Mary','Javier','Katherine','Jose']),
  // para cruzar el historial de "quién revisó qué requerimiento y cuándo" (D.almacenRevisores).
  {nombre:'Katherine', area:'ALMACÉN', revisorNombre:'Katherine'},
  {nombre:'Jose Mañueco', area:'ALMACÉN', revisorNombre:'Jose'},
  {nombre:'Javier Centeno', area:'ALMACÉN', revisorNombre:'Javier'},
  {nombre:'Mary Condori', area:'ALMACÉN', revisorNombre:'Mary'},
];
function hoyStr(){
  const h=new Date();
  return String(h.getDate()).padStart(2,'0')+'/'+String(h.getMonth()+1).padStart(2,'0')+'/'+h.getFullYear();
}
const GH_COMPRAS_RAW='https://raw.githubusercontent.com/'+GH_REPO+'/main/data.json';
// Lectura de SOLO LECTURA del data.json real de Compras — nunca escribe ahí,
// solo cruza para detectar automáticamente lo que la persona ya hizo hoy.
async function fetchComprasData(){
  try{
    const res = await fetchTO(GH_COMPRAS_RAW+'?t='+Date.now());
    if(!res.ok) return null;
    const j = await res.json();
    return (j && j.D) || null;
  }catch(e){
    console.error('No se pudo leer data.json de Compras para el cruce automático', e);
    return null;
  }
}
// Regularizaciones cerradas hoy (check "COMPRAS" con fecha de hoy), envío de OC
// por correo hoy, y cotizaciones marcadas hoy — todo tal como ya lo registra
// Compras, sin que la persona tenga que volver a escribirlo a mano.
// Compara solo la parte de fecha de un datetime tipo toLocaleString('es-PE')
// ("20/8/2026, 5:11:23 p. m.") contra el día real de hoy — ese formato no trae
// ceros a la izquierda, así que no calza con hoyStr() por texto y hay que
// comparar día/mes/año como números.
function esFechaHoraDeHoy(fechaHoraStr){
  if(!fechaHoraStr) return false;
  const soloFecha = String(fechaHoraStr).split(',')[0].trim();
  const m = soloFecha.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if(!m) return false;
  const hoy = new Date();
  return +m[1]===hoy.getDate() && +m[2]===(hoy.getMonth()+1) && +m[3]===hoy.getFullYear();
}
function detectarAutomaticas(persona, D){
  const out=[];
  if(!D) return out;
  const hoy=hoyStr();
  // Cuenta las revisiones de esta persona en un historial tipo {rk: [{nombre,fecha}]} y arma
  // la actividad automática — mismo cálculo para Requerimientos y para Despacho, solo cambia
  // de dónde sale el historial y el título.
  function contarRevisiones(historial, tituloBase){
    let hoyCount=0, totalCount=0;
    Object.keys(historial||{}).forEach(function(rk){
      (historial[rk]||[]).forEach(function(h){
        if(h.nombre===persona.revisorNombre){
          totalCount++;
          if(esFechaHoraDeHoy(h.fecha)) hoyCount++;
        }
      });
    });
    if(!totalCount) return null;
    return {
      titulo:tituloBase+' — '+hoyCount+' revisado(s) hoy (histórico: '+totalCount+')',
      estado: hoyCount>0?'COMPLETADO':'PENDIENTE',
      prioridad:'MEDIA',
      avance: hoyCount>0?100:0,
      obstaculo:'',
      proximosPasos:'',
      auto:true,
    };
  }
  if(persona.area==='ALMACÉN'){
    if(!persona.revisorNombre) return out;
    const reqEntry = contarRevisiones(D.almacenRevisores, 'Revisión de requerimientos');
    if(reqEntry) out.push(reqEntry);
    const despEntry = contarRevisiones(D.almacenRevisoresDespacho, 'Revisión de despachos');
    if(despEntry) out.push(despEntry);
    return out;
  }
  if(persona.area!=='COMPRAS' || !persona.ucomp) return out;
  const ocMeta=D.ocMeta||{};
  const misOC=(D.oc||[]).filter(function(r){return r.ucomp===persona.ucomp;});
  // Regularizaciones
  const misReg=misOC.filter(function(r){return ocMeta[r.oc]&&ocMeta[r.oc].reg;});
  if(misReg.length){
    const cerradasHoy=misReg.filter(function(r){return ocMeta[r.oc].fcompras===hoy;});
    const pendientes=misReg.filter(function(r){return !ocMeta[r.oc].fcompras;});
    if(cerradasHoy.length||pendientes.length){
      out.push({
        titulo:'Regularizaciones — '+cerradasHoy.length+' cerrada(s) hoy de '+misReg.length+' asignada(s)',
        estado: pendientes.length===0?'COMPLETADO':(cerradasHoy.length?'EN CURSO':'PENDIENTE'),
        prioridad: pendientes.length>0?'ALTA':'MEDIA',
        avance: Math.round((misReg.length-pendientes.length)/misReg.length*100),
        obstaculo: pendientes.length?('Quedan '+pendientes.length+' regularización(es) sin cerrar del lado Compras'):'',
        proximosPasos: pendientes.length?('Cerrar: '+pendientes.slice(0,5).map(function(r){return r.oc;}).join(', ')+(pendientes.length>5?'…':'')):'',
        auto:true,
      });
    }
  }
  // OC enviadas a proveedor (correo) hoy
  const enviadasHoy=misOC.filter(function(r){return ocMeta[r.oc]&&ocMeta[r.oc].correo&&ocMeta[r.oc].fcorreo===hoy;});
  if(enviadasHoy.length){
    out.push({
      titulo:'Envío de OC a proveedores — '+enviadasHoy.length+' enviada(s) hoy',
      estado:'COMPLETADO',
      prioridad:'MEDIA',
      avance:100,
      obstaculo:'',
      proximosPasos:'OC: '+enviadasHoy.slice(0,6).map(function(r){return r.oc;}).join(', ')+(enviadasHoy.length>6?'…':''),
      auto:true,
    });
  }
  // Cotizaciones (Sin OC) — por nombre, ya que sinoc no tiene código de comprador
  const cotMeta=D.cotMeta||{};
  const cotMetaFecha=D.cotMetaFecha||{};
  const misSinOC=(D.sinoc||[]).filter(function(r){return (r.respPed||'').toLowerCase().includes(persona.nombre.toLowerCase());});
  if(misSinOC.length){
    const keyOf=function(r){return (r.ped||'')+'_'+(r.cod||'');};
    const cotizadasHoy=misSinOC.filter(function(r){return cotMetaFecha[keyOf(r)]===hoy;});
    const pendientes=misSinOC.filter(function(r){return !cotMeta[keyOf(r)];});
    if(cotizadasHoy.length||pendientes.length){
      out.push({
        titulo:'Cotizaciones — '+cotizadasHoy.length+' marcada(s) hoy, quedan '+pendientes.length+' de '+misSinOC.length+' pendientes',
        estado: pendientes.length===0?'COMPLETADO':(cotizadasHoy.length?'EN CURSO':'PENDIENTE'),
        prioridad: pendientes.length>0?'ALTA':'MEDIA',
        avance: Math.round((misSinOC.length-pendientes.length)/misSinOC.length*100),
        obstaculo: pendientes.length?'Falta cotizar '+pendientes.length+' ítem(s) sin OC':'',
        proximosPasos:'',
        auto:true,
      });
    }
  }
  return out;
}
// Guarda el día de UNA persona sin pisar lo que ya registraron las demás — se
// quita cualquier entrada previa de esa misma persona+fecha (por si vuelve a
// guardar el mismo día) y se agregan las nuevas.
async function saveMisActividades(persona, fecha, fechaTs, entries){
  const token = getToken();
  if(!token){
    if(confirm('Para guardar (compartido con todo el equipo) necesitas un Token de GitHub.\n¿Configurarlo ahora?')) setupGHToken();
    throw new Error('Falta configurar el Token de GitHub de Actividades.');
  }
  const check = await fetchTO(GH_API, {headers:{Authorization:'token '+token, Accept:'application/vnd.github.v3+json'}});
  let sha=''; let remote={actividades:[]};
  if(check.ok){
    const meta = await check.json(); sha = meta.sha || '';
    const raw = await fetchTO(GH_RAW+'?t='+Date.now());
    if(raw.ok) remote = await raw.json();
  }
  const otros=(remote.actividades||[]).filter(function(a){return !(a.responsable===persona.nombre && a.fecha===fecha);});
  const nuevos=entries.map(function(e){
    return Object.assign({},e,{responsable:persona.nombre, area:persona.area, fecha:fecha, fechaTs:fechaTs});
  });
  const payload = JSON.stringify({actividades:otros.concat(nuevos), updatedAt:Date.now()});
  const content = btoa(unescape(encodeURIComponent(payload)));
  const body = {message:'actividades '+persona.nombre+' '+fecha, content};
  if(sha) body.sha = sha;
  const res = await fetchTO(GH_API, {method:'PUT', headers:{Authorization:'token '+token, Accept:'application/vnd.github.v3+json', 'Content-Type':'application/json'}, body:JSON.stringify(body)});
  if(!res.ok){
    let detalle='';
    try{ detalle=(await res.json()).message||''; }catch(e2){}
    throw new Error('GitHub respondió '+res.status+(detalle?': '+detalle:''));
  }
  return true;
}

return { loadRemote, setupGHToken, getToken, GH_TOKEN_KEY,
  EQUIPO, hoyStr, fetchComprasData, detectarAutomaticas, saveMisActividades };
})();
