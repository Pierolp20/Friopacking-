// ============================================================
// ACTIVIDADES DIARIAS · parseo del Excel consolidado (Piero une las
// listas individuales exportadas de Microsoft Lists) + guardado en
// GitHub (actividades.json). Mismo patrón que compras/almacen/facturas
// -shared.js: namespaced para convivir con los demás en plataforma.html.
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

// Excel a veces trae la fecha como serial numérico, a veces como texto ya formateado.
function excelDateToStr(v){
  if(v==null || v==='') return null;
  if(typeof v === 'number'){
    const d = XLSX.SSF.parse_date_code(v);
    if(!d) return null;
    return `${String(d.d).padStart(2,'0')}/${String(d.m).padStart(2,'0')}/${d.y}`;
  }
  if(v instanceof Date) return `${String(v.getDate()).padStart(2,'0')}/${String(v.getMonth()+1).padStart(2,'0')}/${v.getFullYear()}`;
  const s = String(v).trim();
  if(/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? null : `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}
function fechaStrToTs(s){
  if(!s) return 0;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if(!m) return 0;
  return new Date(+m[3], +m[2]-1, +m[1]).getTime();
}

// Encabezados flexibles: el Excel de LISTS puede variar mayúsculas/acentos entre columnas.
function norm(s){ return String(s||'').trim().toUpperCase().replace(/[ÁÀ]/g,'A').replace(/[ÉÈ]/g,'E').replace(/[ÍÌ]/g,'I').replace(/[ÓÒ]/g,'O').replace(/[ÚÙ]/g,'U'); }

function parseWorkbook(wb){
  const sh = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json(sh,{header:1,defval:''});
  let hdrIdx=0;
  for(let i=0;i<Math.min(10,raw.length);i++){
    const row=raw[i].map(norm);
    if(row.some(c=>c.includes('TITULO')) && row.some(c=>c.includes('RESPONSABLE'))){ hdrIdx=i; break; }
  }
  const hdrs = raw[hdrIdx].map(norm);
  const gi = (...cands)=>{for(const c of cands){const i=hdrs.findIndex(h=>h.includes(c));if(i>=0)return i;}return -1;};
  const iTIT  = gi('TITULO');
  const iFEC  = gi('FECHA');
  const iRESP = gi('RESPONSABLE');
  const iEST  = gi('ESTADO');
  const iPRIO = gi('PRIORIDAD');
  const iAV   = gi('AVANCE');
  const iOBS  = gi('OBSTACULO');
  const iPROX = gi('PROXIMOS PASOS','PROXIMO PASO');
  const iAREA = gi('AREA');
  const gv = (r,i)=> i>=0 ? String(r[i]==null?'':r[i]).trim() : '';

  const registros = raw.slice(hdrIdx+1)
    .filter(r=>r && r.some(c=>c!=null && c!==''))
    .map(r=>{
      const fechaStr = excelDateToStr(r[iFEC]);
      const avanceRaw = gv(r,iAV).replace('%','').replace(',','.');
      const avance = avanceRaw ? Math.round(parseFloat(avanceRaw)*(avanceRaw<=1&&avanceRaw>0?100:1)) : 0;
      return {
        titulo: gv(r,iTIT),
        fecha: fechaStr || gv(r,iFEC),
        fechaTs: fechaStrToTs(fechaStr),
        responsable: gv(r,iRESP),
        area: gv(r,iAREA).toUpperCase(),
        estado: gv(r,iEST).toUpperCase(),
        prioridad: gv(r,iPRIO).toUpperCase(),
        avance: isNaN(avance)?0:Math.max(0,Math.min(100,avance)),
        obstaculo: gv(r,iOBS),
        proximosPasos: gv(r,iPROX),
      };
    })
    .filter(r=>r.titulo || r.responsable);
  return registros;
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

// Reemplaza completamente el set de actividades — a diferencia de OC/facturas, cada
// consolidado de Piero YA es el registro completo del día(s) que cubre, así que no hay
// nada que fusionar: se sube tal cual (last-write-wins, igual que un backup diario).
async function saveActividades(registros){
  const token = getToken();
  if(!token){
    if(confirm('Para guardar (compartido con todo el equipo) necesitas un Token de GitHub.\n¿Configurarlo ahora?')) setupGHToken();
    throw new Error('Falta configurar el Token de GitHub de Actividades.');
  }
  const check = await fetchTO(GH_API, {headers:{Authorization:'token '+token, Accept:'application/vnd.github.v3+json'}});
  let sha = '';
  if(check.ok){ const meta = await check.json(); sha = meta.sha || ''; }
  const payload = JSON.stringify({actividades:registros, updatedAt:Date.now()});
  const content = btoa(unescape(encodeURIComponent(payload)));
  const body = {message:'actividades '+new Date().toISOString(), content};
  if(sha) body.sha = sha;
  const res = await fetchTO(GH_API, {method:'PUT', headers:{Authorization:'token '+token, Accept:'application/vnd.github.v3+json', 'Content-Type':'application/json'}, body:JSON.stringify(body)});
  return res.ok;
}

return { parseWorkbook, saveActividades, loadRemote, setupGHToken, getToken, GH_TOKEN_KEY };
})();
