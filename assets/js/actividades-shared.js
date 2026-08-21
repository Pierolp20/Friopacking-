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
  // comexImportaciones: cruza D.p4 (Compras Directas) filtrando OC tipo 0002 (Importaciones)
  // y las 3 fechas manuales que ella misma llena en compras.html (fEntregaProv/fZarpe/eta) —
  // ver OC_META_FECHA_CAMPOS en compras.html. Jose Casarino hace nacionalización, no esto.
  {nombre:'Camila Mora', area:'COMEX', comexImportaciones:true},
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
const GH_FACTURAS_RAW='https://raw.githubusercontent.com/'+GH_REPO+'/main/facturas_piloto.json';
// Solo lectura de facturas_piloto.json — para detectar OC del comprador que siguen sin
// guía y/o sin factura (cerrar ese flujo es parte de su trabajo diario).
async function fetchFacturasData(){
  try{
    const res = await fetchTO(GH_FACTURAS_RAW+'?t='+Date.now());
    if(!res.ok) return [];
    const j = await res.json();
    return (j && j.ordenes && j.ordenes.orders) || [];
  }catch(e){
    console.error('No se pudo leer facturas_piloto.json para el cruce automático', e);
    return [];
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
function detectarAutomaticas(persona, D, facturas){
  facturas = facturas || [];
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
    if(reqEntry){ reqEntry.categoria='almacen_requerimientos'; out.push(reqEntry); }
    const despEntry = contarRevisiones(D.almacenRevisoresDespacho, 'Revisión de despachos');
    if(despEntry){ despEntry.categoria='almacen_despacho'; out.push(despEntry); }
    return out;
  }
  if(persona.comexImportaciones){
    const ocMeta=D.ocMeta||{};
    // Solo las OC de Compras Directas (D.p4) de Tipo Importaciones (arrancan con "0002")
    // llevan las 3 fechas manuales; las Nacionales (0001) no aplican — igual que en
    // importTrackingCellsHtml() de compras.html. Se excluyen las ya Atendido Completo.
    const importaciones=(D.p4||[]).filter(function(r){return String(r.oc).startsWith('0002') && r.estado!=='Atendido Completo';});
    // Cruce de solo lectura con NEXO (facturas_piloto.json, origen 'sinreq' = Compras Directas)
    // para saber si la OC es a crédito o al contado — no es lo mismo la urgencia de una que
    // vence en 5 días a crédito que una al contado sin fecha de pago encima.
    const facturaPorOC={};
    facturas.forEach(function(f){ if(f.origen==='sinreq') facturaPorOC[f.codOrden]=f; });
    const pendientes=importaciones.filter(function(r){
      const m=ocMeta[r.oc]||{};
      return !m.fEntregaProv || !m.fZarpe || !m.eta;
    });
    if(importaciones.length){
      out.push({
        titulo:'Seguimiento de importaciones — '+pendientes.length+' de '+importaciones.length+' OC con fechas pendientes',
        estado: pendientes.length===0?'COMPLETADO':(pendientes.length<importaciones.length?'EN CURSO':'PENDIENTE'),
        prioridad: pendientes.some(function(r){const f=facturaPorOC[r.oc];return f&&f.riesgoBloqueo;})?'ALTA':'MEDIA',
        avance: Math.round((importaciones.length-pendientes.length)/importaciones.length*100),
        obstaculo: pendientes.length?(pendientes.length+' OC de importación sin las 3 fechas completas'):'',
        proximosPasos: pendientes.length?'Registrar Entrega Proveedor/Zarpe/ETA en Compras Directas':'',
        auto:true,
        categoria:'comex_importaciones',
        detalle: importaciones.map(function(r){
          const m=ocMeta[r.oc]||{};
          const faltan=[];
          if(!m.fEntregaProv) faltan.push('Entrega Proveedor');
          if(!m.fZarpe) faltan.push('Zarpe');
          if(!m.eta) faltan.push('ETA');
          const f=facturaPorOC[r.oc];
          const condicion=f?(f.diasCredito>0?'Crédito '+f.diasCredito+'d':'Contado'):'';
          return {
            titulo:r.oc+' · '+(r.prov||'Proveedor no indicado'),
            estado: faltan.length===0?'COMPLETADO':(faltan.length<3?'EN CURSO':'PENDIENTE'),
            prioridad: (f&&f.riesgoBloqueo)?'ALTA':'MEDIA',
            avance: Math.round((3-faltan.length)/3*100),
            obstaculo: faltan.length?('Falta: '+faltan.join(', ')+(condicion?' · '+condicion:'')):(condicion||''),
            proximosPasos: faltan.length?'Actualizar en Compras Directas':'',
          };
        }),
      });
    }
    return out;
  }
  if(persona.area!=='COMPRAS' || !persona.ucomp) return out;
  const ocMeta=D.ocMeta||{};
  const misOC=(D.oc||[]).filter(function(r){return r.ucomp===persona.ucomp;});
  // Cada bloque sale AGRUPADO por defecto (Manuel no quiere 60+ filas sueltas cada día);
  // el detalle individual (uno por OC/ítem) va en "detalle" y la tabla lo despliega al
  // hacer clic — así se puede seguir cada OC/cotización por separado sin saturar la vista.
  // Órdenes de compra generadas hoy (fecha de OC = hoy)
  const ocsHoy=misOC.filter(function(r){return r.foc===hoy;});
  if(ocsHoy.length){
    out.push({
      titulo:'Órdenes de compra generadas — '+ocsHoy.length+' colocada(s) hoy',
      estado:'COMPLETADO', prioridad:'MEDIA', avance:100, obstaculo:'', proximosPasos:'', auto:true,
      categoria:'oc_generadas',
      detalle: ocsHoy.map(function(r){
        // El próximo paso de toda OC generada es enviarla al proveedor — eso no cambia; lo
        // que sí cambia es si hay un obstáculo frenándolo (Manuel todavía no la aprueba).
        const sinAprobar=r.estado==='Pendiente (Sin Aprobar)';
        return {
          titulo:r.oc+' · '+(r.prov||'Proveedor no indicado'),
          estado:'COMPLETADO', prioridad:'MEDIA', avance:100,
          obstaculo: sinAprobar?'Pendiente de aprobación de Manuel':'',
          proximosPasos:'Enviar al proveedor',
        };
      }),
    });
  }
  // OC enviadas a proveedor (correo) hoy
  const enviadasHoy=misOC.filter(function(r){return ocMeta[r.oc]&&ocMeta[r.oc].correo&&ocMeta[r.oc].fcorreo===hoy;});
  if(enviadasHoy.length){
    out.push({
      titulo:'OC enviadas a proveedor — '+enviadasHoy.length+' hoy',
      estado:'COMPLETADO', prioridad:'MEDIA', avance:100, obstaculo:'', proximosPasos:'', auto:true,
      categoria:'oc_enviadas',
      detalle: enviadasHoy.map(function(r){
        return {titulo:r.oc+' · '+(r.prov||'Proveedor no indicado'), estado:'COMPLETADO', prioridad:'MEDIA', avance:100, obstaculo:'', proximosPasos:''};
      }),
    });
  }
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
        proximosPasos:'',
        auto:true,
        categoria:'regularizaciones',
        detalle: misReg.map(function(r){
          const cerrada=ocMeta[r.oc].fcompras;
          return {titulo:r.oc+' · '+(r.prov||'Proveedor no indicado'), estado: cerrada?'COMPLETADO':'PENDIENTE', prioridad: cerrada?'MEDIA':'ALTA', avance: cerrada?100:0, obstaculo:'', proximosPasos:''};
        }),
      });
    }
  }
  // Cierre de OC (guía y/o factura pendiente) — cruce con facturas_piloto.json. Solo las que
  // llevan más de 3 días sin cerrar (las recién generadas tienen su tiempo normal de trámite).
  const TRES_DIAS_MS=3*24*60*60*1000;
  const ahora=new Date();
  const misOrdenesFact=facturas.filter(function(o){return o.usuarioCompras===persona.ucomp;});
  const sinCerrar=misOrdenesFact.filter(function(o){
    const abierta=o.statusFactura!=='anulado' && ((o.facturaRefs||[]).length===0 || (o.guiaRefs||[]).length===0);
    if(!abierta) return false;
    if(!o.fechaOrden) return false;
    const fo=new Date(o.fechaOrden);
    if(isNaN(fo.getTime())) return false;
    return (ahora-fo)>TRES_DIAS_MS;
  });
  if(sinCerrar.length){
    const vencidas=sinCerrar.filter(function(o){return o.riesgoBloqueo;});
    out.push({
      titulo:'Cierre de OC (guía/factura) — '+sinCerrar.length+' pendiente(s) de más de 3 días'+(vencidas.length?' ('+vencidas.length+' vencida(s))':''),
      estado: vencidas.length?'PENDIENTE':'EN CURSO',
      prioridad: vencidas.length?'ALTA':'MEDIA',
      avance:0,
      obstaculo: vencidas.length?(vencidas.length+' OC vencida(s) sin guía ni factura'):'',
      proximosPasos:'',
      auto:true,
      categoria:'cierre_oc',
      detalle: sinCerrar.map(function(o){
        const tieneFactura=(o.facturaRefs||[]).length>0;
        const tieneGuia=(o.guiaRefs||[]).length>0;
        const falta = !tieneFactura&&!tieneGuia ? 'guía y factura' : (!tieneGuia?'guía':'factura');
        return {
          titulo:o.codOrden+' · '+(o.nombreProveedor||'Proveedor no indicado'),
          estado: o.riesgoBloqueo?'PENDIENTE':'EN CURSO',
          prioridad: o.riesgoBloqueo?'ALTA':'MEDIA',
          avance:(tieneFactura?50:0)+(tieneGuia?50:0),
          obstaculo:'Falta '+falta+(o.riesgoBloqueo?' — OC vencida':''),
          proximosPasos:'',
        };
      }),
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
        categoria:'cotizaciones',
        detalle: misSinOC.map(function(r){
          const cotizada=!!cotMeta[keyOf(r)];
          return {titulo:(r.cod||'—')+' · '+(r.prod||'Ítem sin descripción'), estado: cotizada?'COMPLETADO':'PENDIENTE', prioridad: cotizada?'MEDIA':'ALTA', avance: cotizada?100:0, obstaculo:'', proximosPasos:''};
        }),
      });
    }
  }
  return out;
}
// Si la persona ya guardó su día hoy y edita una fila automática (por ejemplo, marca como
// COMPLETADO algo que terminó más tarde), esa edición no debe perderse la próxima vez que
// entra y se vuelve a correr la detección — pero las categorías que NO tocó sí deben seguir
// actualizándose solas con la data en vivo. "editado:true" es lo que congela una categoría.
function mergeConGuardadoHoy(persona, fecha, autoFresh, guardadoHoy){
  const editadasPorCategoria={};
  const manualesGuardadas=[];
  (guardadoHoy||[]).forEach(function(e){
    if(e.responsable!==persona.nombre || e.fecha!==fecha) return;
    if(e.auto && e.categoria && e.editado){ editadasPorCategoria[e.categoria]=e; }
    else if(!e.auto){ manualesGuardadas.push(Object.assign({},e)); }
  });
  const autoMerged = autoFresh.map(function(fresco){
    const guardada = fresco.categoria && editadasPorCategoria[fresco.categoria];
    if(!guardada) return fresco;
    return Object.assign({}, fresco, {
      titulo:guardada.titulo, estado:guardada.estado, prioridad:guardada.prioridad,
      avance:guardada.avance, obstaculo:guardada.obstaculo, proximosPasos:guardada.proximosPasos,
      editado:true,
    });
  });
  return {autoEntries:autoMerged, manualEntries:manualesGuardadas};
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
  EQUIPO, hoyStr, fetchComprasData, fetchFacturasData, detectarAutomaticas, mergeConGuardadoHoy, saveMisActividades };
})();
