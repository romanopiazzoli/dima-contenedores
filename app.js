// Dima Express · Control de Contenedores v2
// Datos en Supabase: cada tabla tiene (id text, data jsonb). Acceso por perfil (tabla perfiles, id = correo).
import {createClient} from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import {SUPABASE_URL,SUPABASE_ANON_KEY} from "./supabase-config.js";

const TIPO_LINK=(location.hash.match(/[#&]type=(\w+)/)||[])[1]||"";
const ERR_LINK=/[#&?]error/.test(location.hash+location.search);
const sb=createClient(SUPABASE_URL,SUPABASE_ANON_KEY);

const TABLAS=["contenedores","clientes","contratos","pagos","ventas","proveedores","tipos","perfiles","config"];
const IVA=0.19, MIN_MESES=3;
const DIMS=["20 pies","40 pies","10 pies","A medida"], CARACS=["Maritimo","Modulo","Box"];
const TRASLADOS=["Dima Maquinarias","Externo","Dima"];
const ROLES={admin:"Administrador",editor:"Editor",lectura:"Solo lectura"};

const S={
  d:Object.fromEntries(TABLAS.map(t=>[t,new Map()])),
  cargadas:new Set(), ver:0, user:null, rol:null,
  f:{cont:{estado:"activos",tipo:"",q:""},ctr:{estado:"vigente",q:""},cli:{q:""},ven:{q:""},pag:{mes:"",q:""},mas:"tipos"},
  lim:{}, importando:null, stale:false
};

// ---------- utilidades ----------
const $=s=>document.querySelector(s);
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const clp=n=>"$"+Math.round(Number(n)||0).toLocaleString("es-CL");
const num=v=>{const n=Number(String(v??"").replace(/\./g,"").replace(",",".").replace(/[^\d.-]/g,""));return isFinite(n)?n:0};
const pad=(n,l=2)=>String(n).padStart(l,"0");
const hoy=()=>{const d=new Date();return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())};
const toUTC=s=>{const [y,m,d]=String(s).split("-").map(Number);return Date.UTC(y,(m||1)-1,d||1)};
const dias=(a,b)=>Math.round((toUTC(b)-toUTC(a))/864e5);
const fdate=s=>{if(!s)return"—";const [y,m,d]=String(s).slice(0,10).split("-");return d?d+"-"+m+"-"+y:s};
const MESES=["ene","feb","mar","abr","may","jun","jul","ago","sep","oct","nov","dic"];
const fper=p=>{if(!p)return"—";const [y,m]=p.split("-");return MESES[(+m)-1]+" "+y};
function addMonths(s,n){const [y,m,d]=String(s).split("-").map(Number);const t=new Date(Date.UTC(y,m-1+n,1));const dim=new Date(Date.UTC(t.getUTCFullYear(),t.getUTCMonth()+1,0)).getUTCDate();t.setUTCDate(Math.min(d||1,dim));return t.toISOString().slice(0,10)}
const nuevoId=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2)).replace(/-/g,"").slice(0,20);
const norm=s=>String(s||"").normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase();
const debounce=(f,ms=200)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>f(...a),ms)}};
const puedeEditar=()=>S.rol==="admin"||S.rol==="editor";
const esAdmin=()=>S.rol==="admin";
function toast(msg,ms=2800){const t=document.createElement("div");t.className="toast";t.textContent=msg;document.body.appendChild(t);setTimeout(()=>t.remove(),ms)}
function descargar(nombre,contenido,tipo){const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([contenido],{type:tipo}));a.download=nombre;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove()},1500)}
function csv(filas){return"﻿"+filas.map(r=>r.map(v=>{v=String(v??"");return/[;"\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}).join(";")).join("\n")}

// ---------- datos ----------
const get=(t,id)=>S.d[t].get(id);
const all=t=>[...S.d[t].values()];
async function cargarTabla(t){
  const m=S.d[t];let desde=0;const paso=1000;
  for(;;){const {data,error}=await sb.from(t).select("id,data").range(desde,desde+paso-1);
    if(error)throw error;data.forEach(r=>m.set(r.id,{...r.data,id:r.id}));if(data.length<paso)break;desde+=paso}
  S.cargadas.add(t);
}
function escuchar(){
  const ch=sb.channel("dima-rt");
  TABLAS.forEach(t=>ch.on("postgres_changes",{event:"*",schema:"public",table:t},p=>{
    if(p.eventType==="DELETE")S.d[t].delete(p.old.id);else S.d[t].set(p.new.id,{...p.new.data,id:p.new.id});
    cambio();
  }));
  ch.subscribe();
}
const limpiar=o=>{const {id,...r}=o;return r};
async function guardar(t,obj,msg){
  if(!puedeEditar()){toast("Tu perfil es de solo lectura.");return null}
  const id=obj.id||nuevoId();const data={...limpiar(obj),actualizado:new Date().toISOString(),por:S.user?.email||""};
  const {error}=await sb.from(t).upsert({id,data});
  if(error){toast(error.code==="42501"?"No tienes permiso para guardar.":"No se pudo guardar: "+error.message,4000);return null}
  S.d[t].set(id,{...data,id});cambio();if(msg)toast(msg);return id;
}
async function guardarVarios(t,objs){
  if(!objs.length)return true;
  const rows=objs.map(o=>({id:o.id||nuevoId(),data:{...limpiar(o),actualizado:new Date().toISOString(),por:S.user?.email||""}}));
  const {error}=await sb.from(t).upsert(rows);
  if(error){toast("No se pudo guardar: "+error.message,4000);return false}
  rows.forEach(r=>S.d[t].set(r.id,{...r.data,id:r.id}));cambio();return true;
}
async function borrar(t,id,msg){
  const {error}=await sb.from(t).delete().eq("id",id);
  if(error){toast("No se pudo eliminar: "+error.message,4000);return false}
  S.d[t].delete(id);cambio();if(msg)toast(msg);return true;
}
let renderPend=false;
function cambio(){S.ver++;if(!renderPend){renderPend=true;requestAnimationFrame(()=>{renderPend=false;render()})}}

// ---------- modal / confirmación ----------
function modal(title,bodyHTML,footHTML,onMount,ancho){
  const root=$("#modal-root");
  root.innerHTML=`<div class="scrim" id="scrim"><div class="modal${ancho?" ancho":""}" role="dialog" aria-modal="true" aria-labelledby="mt"><div class="mh"><h2 id="mt">${esc(title)}</h2><button class="sm" data-close>Cerrar</button></div><div class="mb">${bodyHTML}</div>${footHTML?`<div class="mf">${footHTML}</div>`:""}</div></div>`;
  const sc=$("#scrim");
  sc.addEventListener("click",e=>{if(e.target===sc||e.target.closest("[data-close]"))cerrarModal()});
  document.addEventListener("keydown",escKey);
  const first=sc.querySelector("input:not([type=hidden]),select,textarea");if(first)first.focus();
  if(onMount)onMount(sc);
  return sc;
}
function escKey(e){if(e.key==="Escape")cerrarModal()}
function cerrarModal(){$("#modal-root").innerHTML="";document.removeEventListener("keydown",escKey)}
function confirmar(texto,accion,boton="Eliminar"){
  modal("Confirmar",`<p style="margin:0">${esc(texto)}</p>`,`<button data-close>Cancelar</button><button class="danger" id="ok-conf">${esc(boton)}</button>`,sc=>{
    sc.querySelector("#ok-conf").onclick=async()=>{sc.querySelector("#ok-conf").disabled=true;const r=await accion();if(r!==false)cerrarModal()}
  });
}
const v=(sc,id)=>{const el=sc.querySelector("#"+id);return el?(el.type==="checkbox"?el.checked:el.value.trim()):""};

// ---------- índices derivados (se recalculan solo cuando cambian los datos) ----------
let IX=null,IXver=-1;
function ix(){
  if(IXver===S.ver&&IX)return IX;
  const activo=new Map(),venta=new Map(),mensual=new Map(),pagos=new Map(),pagados=new Map(),cliCtr=new Map(),cliVen=new Map(),contHist=new Map(),deuda=new Map();
  for(const c of S.d.contratos.values()){
    if(c.clienteId){if(!cliCtr.has(c.clienteId))cliCtr.set(c.clienteId,[]);cliCtr.get(c.clienteId).push(c)}
    let neto=0;
    for(const it of c.items||[]){
      if(!contHist.has(it.contenedorId))contHist.set(it.contenedorId,[]);contHist.get(it.contenedorId).push({tipo:"arriendo",ctr:c,item:it});
      if(c.estado==="vigente"&&!it.devolucion){activo.set(it.contenedorId,{ctr:c,item:it});neto+=num(it.tarifa)}
    }
    mensual.set(c.id,neto);
  }
  for(const vt of S.d.ventas.values()){
    if(vt.clienteId){if(!cliVen.has(vt.clienteId))cliVen.set(vt.clienteId,[]);cliVen.get(vt.clienteId).push(vt)}
    for(const it of vt.items||[]){
      if(!contHist.has(it.contenedorId))contHist.set(it.contenedorId,[]);contHist.get(it.contenedorId).push({tipo:"venta",venta:vt,item:it});
      if(vt.estado!=="anulada")venta.set(it.contenedorId,vt);
    }
  }
  for(const p of S.d.pagos.values()){
    if(!pagos.has(p.contratoId)){pagos.set(p.contratoId,[]);pagados.set(p.contratoId,new Set())}
    pagos.get(p.contratoId).push(p);if(p.periodo)pagados.get(p.contratoId).add(p.periodo);
  }
  const h=hoy();
  for(const c of S.d.contratos.values()){
    if(c.estado!=="vigente")continue;
    const desde=c.cobrarDesde||c.inicio;if(!desde)continue;
    const pag=pagados.get(c.id)||new Set();const pend=[];
    for(let n=0;n<600;n++){const f=addMonths(desde,n);if(f>h)break;const per=f.slice(0,7);if(!pag.has(per))pend.push({periodo:per,vence:f})}
    if(pend.length)deuda.set(c.id,pend);
  }
  IX={activo,venta,mensual,pagos,pagados,cliCtr,cliVen,contHist,deuda};IXver=S.ver;return IX;
}
function estadoCont(c){
  const I=ix();
  if(c.estado==="vendido"||I.venta.has(c.id))return"vendido";
  if(c.estado==="baja")return"baja";
  if(I.activo.has(c.id))return"arrendado";
  return c.estado==="mantencion"?"mantencion":"disponible";
}
const PILL={disponible:["p-disp","Disponible"],arrendado:["p-arr","Arrendado"],vendido:["p-vend","Vendido"],mantencion:["p-mant","Mantención"],baja:["p-vend","De baja"],
  vigente:["p-arr","Vigente"],cerrado:["p-vend","Cerrado"],anulado:["p-venc","Anulado"],anulada:["p-venc","Anulada"],ok:["p-disp","Emitida"],
  pagado:["p-disp","Pagado"],pendiente:["p-mant","Pendiente"],atrasado:["p-venc","Atrasado"]};
const pill=e=>PILL[e]?`<span class="pill ${PILL[e][0]}">${PILL[e][1]}</span>`:"";
const cliNom=id=>get("clientes",id)?.nombre||"—";
const contCod=id=>get("contenedores",id)?.codigo||"—";
const conIVA=n=>Math.round(num(n)*(1+IVA));
const ctrNum=c=>c?("N° "+(c.numero??"—")):"—";
const ctrLink=c=>c?`<a href="#contrato/${esc(c.id)}">${esc(ctrNum(c))}</a>`:"—";
const cliLink=id=>id&&get("clientes",id)?`<a href="#cliente/${esc(id)}">${esc(cliNom(id))}</a>`:"—";
const contLink=id=>`<button class="link mono" data-cont="${esc(id)}">${esc(contCod(id))}</button>`;
function sigNumero(t){let m=0;for(const x of S.d[t].values())m=Math.max(m,num(x.numero));return m+1}

// Tipos: los de la tabla tipos, o deducidos de los contenedores existentes
function tipos(){
  const t=all("tipos");if(t.length)return t.sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const m=new Map();
  for(const c of S.d.contenedores.values()){if(!c.tipo)continue;const pref=(c.codigo||"").replace(/-\d+$/,"");if(!m.has(c.tipo))m.set(c.tipo,{id:"",nombre:c.tipo,prefijo:pref,precioMes:c.precioMes||0,precioVenta:c.precioVenta||0})}
  return [...m.values()].sort((a,b)=>a.nombre.localeCompare(b.nombre));
}
function sigCodigo(tipoNombre){
  const t=tipos().find(x=>x.nombre===tipoNombre);const pref=t?.prefijo||"CONT";let m=0;
  for(const c of S.d.contenedores.values()){const mm=(c.codigo||"").match(/^(.*)-(\d+)$/);if(mm&&mm[1]===pref)m=Math.max(m,+mm[2])}
  return pref+"-"+pad(m+1,6);
}
// Monto del mes de un contrato (con IVA)
const mensualCtr=c=>ix().mensual.get(c.id)||0;
function estadoPagoMes(c,per){
  if(c.estado!=="vigente")return"";
  if(ix().pagados.get(c.id)?.has(per))return"pagado";
  const d=ix().deuda.get(c.id)||[];const ent=d.find(x=>x.periodo===per);
  if(!ent)return"";
  return ent.vence<hoy()&&dias(ent.vence,hoy())>5?"atrasado":"pendiente";
}

// ---------- helpers de vistas ----------
function paginar(key,rows,porPag=100){const lim=S.lim[key]||porPag;return{vis:rows.slice(0,lim),mas:rows.length>lim?`<div class="mas"><button class="sm" data-mas="${key}">Mostrar ${Math.min(porPag,rows.length-lim)} más (${rows.length-lim} restantes)</button></div>`:""}}
function chips(grupo,actual,ops){return`<div class="chips">${ops.map(([k,l,n])=>`<button class="chip" data-chip="${grupo}" data-val="${k}" aria-pressed="${actual===k}">${l}${n!=null?` <span class="muted">${n}</span>`:""}</button>`).join("")}</div>`}
const buscador=(id,val,ph)=>`<input type="search" id="${id}" class="buscar" placeholder="${esc(ph)}" value="${esc(val)}">`;
const vacio=(t,s)=>`<div class="empty"><b>${esc(t)}</b>${s?esc(s):""}</div>`;
const btnE=(html)=>puedeEditar()?html:"";

// ---------- INICIO ----------
function vInicio(){
  const I=ix();const conts=all("contenedores");
  const cnt={disponible:0,arrendado:0,vendido:0,mantencion:0,baja:0};conts.forEach(c=>cnt[estadoCont(c)]++);
  const flota=cnt.disponible+cnt.arrendado+cnt.mantencion;
  const vig=all("contratos").filter(c=>c.estado==="vigente");
  const mensual=vig.reduce((s,c)=>s+mensualCtr(c),0);
  const per=hoy().slice(0,7);
  const cobradoMes=all("pagos").filter(p=>p.periodo===per).reduce((s,p)=>s+num(p.monto),0);
  const deudas=[...I.deuda.entries()].map(([id,pend])=>({c:get("contratos",id),pend})).filter(x=>x.c).map(x=>({...x,monto:x.pend.length*conIVA(mensualCtr(x.c)),atrasados:x.pend.filter(p=>dias(p.vence,hoy())>5).length}));
  const totDeuda=deudas.reduce((s,x)=>s+x.monto,0);
  const atras=deudas.filter(x=>x.atrasados>0).sort((a,b)=>b.atrasados-a.atrasados||b.monto-a.monto);
  const delMes=vig.map(c=>({c,e:estadoPagoMes(c,per)})).filter(x=>x.e==="pendiente");
  const w=k=>flota?cnt[k]/flota*100:0;
  return `<div class="row between"><h1>Inicio</h1><div class="row">${btnE(`<button class="primary" data-accion="nuevo-contrato">+ Nuevo contrato</button><button data-accion="nueva-venta">+ Nueva venta</button><button data-accion="nuevo-pago">+ Registrar pago</button>`)}</div></div>
  <div class="tiles">
    <a class="tile" href="#contenedores"><span class="k">Flota</span><span class="v">${flota}</span><span class="s">${cnt.disponible} disponibles · ${cnt.arrendado} fuera · ${cnt.mantencion} mantención</span>
      <div class="bar" aria-hidden="true"><i style="width:${w("arrendado")}%;background:var(--info)"></i><i style="width:${w("disponible")}%;background:var(--ok)"></i><i style="width:${w("mantencion")}%;background:var(--warn)"></i></div></a>
    <a class="tile" href="#contratos"><span class="k">Contratos vigentes</span><span class="v">${vig.length}</span><span class="s">${flota?Math.round(cnt.arrendado/flota*100):0}% de ocupación</span></a>
    <div class="tile"><span class="k">Arriendo mensual</span><span class="v">${clp(mensual)}</span><span class="s">neto · ${clp(conIVA(mensual))} con IVA</span></div>
    <a class="tile" href="#pagos"><span class="k">Cobrado ${fper(per)}</span><span class="v">${clp(cobradoMes)}</span><span class="s">${delMes.length} contratos pendientes este mes</span></a>
    <div class="tile ${totDeuda?"alerta":""}"><span class="k">Por cobrar</span><span class="v">${clp(totDeuda)}</span><span class="s">${deudas.length} contratos con meses sin pago</span></div>
  </div>
  <div class="grid2">
  <div class="panel"><div class="ph"><h2>Cobranza atrasada</h2><span class="status">Meses vencidos hace más de 5 días</span></div>
    ${atras.length?`<div class="scroll"><table><thead><tr><th>Contrato</th><th>Cliente</th><th>Meses</th><th class="num">Monto c/IVA</th><th></th></tr></thead><tbody>
    ${atras.slice(0,15).map(x=>`<tr><td>${ctrLink(x.c)}</td><td>${cliLink(x.c.clienteId)}</td><td>${x.pend.slice(0,4).map(p=>fper(p.periodo)).join(", ")}${x.pend.length>4?` y ${x.pend.length-4} más`:""}</td><td class="num">${clp(x.monto)}</td><td class="num">${btnE(`<button class="sm" data-pagar="${x.c.id}">Registrar pago</button>`)}</td></tr>`).join("")}
    </tbody></table></div>${atras.length>15?`<div class="mas"><a href="#pagos">Ver todos (${atras.length})</a></div>`:""}`:`<div class="pb muted">No hay pagos atrasados.</div>`}</div>
  <div class="panel"><div class="ph"><h2>Contenedores por tipo</h2><span class="status"><span style="color:var(--ok)">●</span> Disponible <span style="color:var(--info)">●</span> Fuera</span></div>${tablaTipos(conts)}</div>
  </div>`;
}
function tablaTipos(conts){
  const g={};
  conts.forEach(c=>{const e=estadoCont(c);if(e==="vendido"||e==="baja")return;const t=c.tipo||"Otro";g[t]=g[t]||{total:0,disponible:0,arrendado:0,mantencion:0};g[t].total++;g[t][e]++});
  const ts=Object.keys(g).sort((a,b)=>g[b].total-g[a].total);if(!ts.length)return`<div class="pb muted">Sin contenedores.</div>`;
  const T={total:0,disponible:0,arrendado:0,mantencion:0};ts.forEach(t=>{for(const k in T)T[k]+=g[t][k]});
  const bar=r=>`<div class="bar" style="margin:0;min-width:70px"><i style="width:${r.arrendado/r.total*100}%;background:var(--info)"></i><i style="width:${r.disponible/r.total*100}%;background:var(--ok)"></i><i style="width:${r.mantencion/r.total*100}%;background:var(--warn)"></i></div>`;
  return`<div class="scroll"><table><thead><tr><th>Tipo</th><th class="num">Total</th><th class="num">Disp.</th><th class="num">Fuera</th><th class="num">Mant.</th><th style="width:28%"></th></tr></thead><tbody>
  ${ts.map(t=>{const r=g[t];return`<tr class="clic" data-filtro-tipo="${esc(t)}"><td>${esc(t)}</td><td class="num"><b>${r.total}</b></td><td class="num">${r.disponible||'<span class="muted">0</span>'}</td><td class="num">${r.arrendado||'<span class="muted">0</span>'}</td><td class="num">${r.mantencion||'<span class="muted">0</span>'}</td><td>${bar(r)}</td></tr>`}).join("")}
  </tbody><tfoot><tr><td><b>Total</b></td><td class="num"><b>${T.total}</b></td><td class="num"><b>${T.disponible}</b></td><td class="num"><b>${T.arrendado}</b></td><td class="num"><b>${T.mantencion}</b></td><td>${bar(T)}</td></tr></tfoot></table></div>`;
}

// ---------- CONTRATOS ----------
function vContratos(){
  const f=S.f.ctr;let rows=all("contratos");
  const n={vigente:0,cerrado:0,anulado:0,todos:rows.length};rows.forEach(c=>n[c.estado]=(n[c.estado]||0)+1);
  const deuda=ix().deuda;n.deuda=rows.filter(c=>deuda.has(c.id)).length;
  if(f.estado==="deuda")rows=rows.filter(c=>deuda.has(c.id));else if(f.estado!=="todos")rows=rows.filter(c=>c.estado===f.estado);
  if(f.q){const q=norm(f.q);rows=rows.filter(c=>norm(["n"+c.numero,c.numero,cliNom(c.clienteId),c.oc,c.obra,(c.items||[]).map(i=>i.codigo||contCod(i.contenedorId)).join(" ")].join(" ")).includes(q))}
  rows.sort((a,b)=>num(b.numero)-num(a.numero));
  const {vis,mas}=paginar("ctr",rows);
  return`<div class="row between"><h1>Contratos</h1>${btnE(`<button class="primary" data-accion="nuevo-contrato">+ Nuevo contrato</button>`)}</div>
  <div class="row between">${chips("ctr",f.estado,[["vigente","Vigentes",n.vigente],["deuda","Con meses por cobrar",n.deuda],["cerrado","Cerrados",n.cerrado],["anulado","Anulados",n.anulado],["todos","Todos",n.todos]])}${buscador("q-ctr",f.q,"Buscar N°, cliente, OC, obra o contenedor")}</div>
  <div class="panel">${rows.length?`<div class="scroll"><table><thead><tr><th>N°</th><th>Inicio</th><th>Cliente</th><th>Obra / ubicación</th><th>Contenedores</th><th class="num">Mensual neto</th><th>Estado</th><th>Pagos</th></tr></thead><tbody>
  ${vis.map(c=>{const its=c.items||[];const act=its.filter(i=>!i.devolucion);const d=deuda.get(c.id);
    return`<tr class="clic" data-href="#contrato/${esc(c.id)}"><td><b>${esc(c.numero??"—")}</b></td><td>${fdate(c.inicio)}</td><td>${esc(cliNom(c.clienteId))}</td><td class="trunc">${esc(c.obra||"—")}</td><td class="mono small">${esc((c.estado==="vigente"?act:its).slice(0,3).map(i=>i.codigo||contCod(i.contenedorId)).join(", "))}${(c.estado==="vigente"?act:its).length>3?` +${(c.estado==="vigente"?act:its).length-3}`:""}</td><td class="num">${c.estado==="vigente"?clp(mensualCtr(c)):"—"}</td><td>${pill(c.estado)}</td><td>${c.estado!=="vigente"?"":d?`<span class="pill ${d.some(p=>dias(p.vence,hoy())>5)?"p-venc":"p-mant"}">${d.length} ${d.length===1?"mes":"meses"}</span>`:pill("pagado")}</td></tr>`}).join("")}
  </tbody></table></div>${mas}`:vacio("No hay contratos con este filtro")}</div>`;
}
function vContrato(id){
  const c=get("contratos",id);if(!c)return vacio("Contrato no encontrado","Puede haber sido eliminado.")+`<p><a href="#contratos">← Volver a contratos</a></p>`;
  const its=c.items||[];const neto=mensualCtr(c);const pagos=(ix().pagos.get(c.id)||[]).slice().sort((a,b)=>(b.periodo||"").localeCompare(a.periodo||""));
  const pend=ix().deuda.get(c.id)||[];const g=c.garantia||{};const cl=get("clientes",c.clienteId)||{};
  const vig=c.estado==="vigente";
  return`<p class="small"><a href="#contratos">← Contratos</a></p>
  <div class="row between"><h1>Contrato N° ${esc(c.numero??"")} ${pill(c.estado)}</h1>
   <div class="row noprint">${btnE(`<button data-editar-ctr="${c.id}">Editar datos</button>`)}${btnE(vig?`<button data-agregar-item="${c.id}">+ Agregar contenedor</button><button class="primary" data-pagar="${c.id}">Registrar pago</button>`:"")}<button data-imprimir>Imprimir</button></div></div>
  <div class="grid2">
   <div class="panel"><div class="ph"><h2>Datos</h2></div><div class="pb"><dl class="kv">
    <dt>Cliente</dt><dd>${cliLink(c.clienteId)}${cl.rut?` · <span class="mono">${esc(cl.rut)}</span>`:""}</dd>
    <dt>Inicio</dt><dd>${fdate(c.inicio)}${c.vence?` · vence ${fdate(c.vence)}`:""}</dd>
    <dt>Orden de compra</dt><dd>${esc(c.oc||"—")}${c.ocFecha?` · ${fdate(c.ocFecha)}`:""}</dd>
    <dt>Contacto</dt><dd>${esc([c.contacto,c.telefono,c.email].filter(Boolean).join(" · ")||"—")}</dd>
    <dt>Obra / ubicación</dt><dd>${esc(c.obra||"—")}</dd>
    <dt>Traslado</dt><dd>${esc(c.traslado||"—")}</dd>
    <dt>Garantía</dt><dd>${g.documento||g.cheque||num(g.monto)?esc([g.documento,g.banco,g.cuenta&&("cta "+g.cuenta),g.cheque&&("cheque "+g.cheque),num(g.monto)?clp(g.monto):""].filter(Boolean).join(" · ")):"—"}</dd>
    ${c.notas?`<dt>Notas</dt><dd>${esc(c.notas)}</dd>`:""}
    ${c.estado==="cerrado"&&c.cierre?`<dt>Cerrado el</dt><dd>${fdate(c.cierre)}</dd>`:""}
   </dl></div></div>
   <div class="panel"><div class="ph"><h2>Cobro mensual</h2></div><div class="pb">
    <div class="calc"><span>${its.filter(i=>!i.devolucion).length} contenedores en terreno</span><b>${clp(neto)}</b><span>IVA 19%</span><b>${clp(conIVA(neto)-neto)}</b><span class="tot">Total mensual</span><b class="tot">${clp(conIVA(neto))}</b></div>
    ${vig?(pend.length?`<p class="small" style="margin:12px 0 0"><b>${pend.length} ${pend.length===1?"mes":"meses"} por cobrar:</b> ${pend.map(p=>`${fper(p.periodo)} (vence ${fdate(p.vence)})`).join(", ")}</p>`:`<p class="small" style="margin:12px 0 0;color:var(--ok)">Pagos al día.</p>`):""}
   </div></div>
  </div>
  <div class="panel"><div class="ph"><h2>Contenedores</h2><span class="status">Plazo mínimo ${MIN_MESES} meses</span></div><div class="scroll"><table><thead><tr><th>Contenedor</th><th>Tipo</th><th>Salida</th><th>Guía</th><th>Devolución</th><th class="num">Tarifa neta</th><th class="noprint"></th></tr></thead><tbody>
   ${its.map((it,i)=>{const ct=get("contenedores",it.contenedorId)||{};return`<tr><td>${contLink(it.contenedorId)}</td><td>${esc(ct.tipo||"")} <span class="muted small">${esc(ct.dimension||"")}</span></td><td>${fdate(it.salida||c.inicio)}</td><td>${esc(it.guia||"—")}</td><td>${it.devolucion?fdate(it.devolucion)+(it.obsDev?` <span class="muted small">· ${esc(it.obsDev)}</span>`:""):'<span class="pill p-arr">En terreno</span>'}</td><td class="num">${clp(it.tarifa)}</td>
    <td class="num noprint">${btnE(`<button class="sm" data-item-edit="${c.id}|${i}">Editar</button>${vig&&!it.devolucion?` <button class="sm" data-devolver="${c.id}|${i}">Registrar devolución</button>`:""}`)}</td></tr>`}).join("")||`<tr><td colspan="7" class="muted">Sin contenedores.</td></tr>`}
  </tbody></table></div></div>
  <div class="panel"><div class="ph"><h2>Pagos recibidos</h2><span class="status">${pagos.length} pagos · ${clp(pagos.reduce((s,p)=>s+num(p.monto),0))}</span></div>
   ${pagos.length?`<div class="scroll"><table><thead><tr><th>Período</th><th>Fecha pago</th><th>N° factura</th><th class="num">Monto</th><th class="noprint"></th></tr></thead><tbody>${pagos.map(p=>`<tr><td>${fper(p.periodo)}</td><td>${fdate(p.fecha)}</td><td>${esc(p.factura||"—")}</td><td class="num">${clp(p.monto)}</td><td class="num noprint">${btnE(`<button class="sm" data-pago-edit="${p.id}">Editar</button>`)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="pb muted">Sin pagos registrados.</div>`}</div>
  <div class="row noprint">${btnE(vig?`<button data-cerrar-ctr="${c.id}">Cerrar contrato</button><button class="danger" data-anular-ctr="${c.id}">Anular</button>`:`<button data-reabrir-ctr="${c.id}">Reabrir contrato</button>`)}${esAdmin()?`<button class="danger" data-borrar-ctr="${c.id}">Eliminar</button>`:""}</div>
  <p class="small muted">Última modificación: ${c.actualizado?new Date(c.actualizado).toLocaleString("es-CL"):"—"} ${c.por?"· "+esc(c.por):""}</p>`;
}

// ---------- CONTENEDORES ----------
function vContenedores(){
  const f=S.f.cont;const I=ix();let rows=all("contenedores").map(c=>({c,e:estadoCont(c)}));
  const n={activos:0,disponible:0,arrendado:0,mantencion:0,vendido:0,todos:rows.length};
  rows.forEach(x=>{n[x.e]=(n[x.e]||0)+1;if(x.e!=="vendido"&&x.e!=="baja")n.activos++});
  if(f.estado==="activos")rows=rows.filter(x=>x.e!=="vendido"&&x.e!=="baja");else if(f.estado!=="todos")rows=rows.filter(x=>x.e===f.estado);
  if(f.tipo)rows=rows.filter(x=>x.c.tipo===f.tipo);
  if(f.q){const q=norm(f.q);rows=rows.filter(x=>{const a=I.activo.get(x.c.id);return norm([x.c.codigo,x.c.tipo,x.c.ubicacion,x.c.vendidoA,a?cliNom(a.ctr.clienteId)+" "+a.ctr.obra+" n"+a.ctr.numero:""].join(" ")).includes(q)})}
  rows.sort((a,b)=>(a.c.codigo||"").localeCompare(b.c.codigo||"",undefined,{numeric:true}));
  const {vis,mas}=paginar("cont",rows);
  const tps=[...new Set(all("contenedores").map(c=>c.tipo).filter(Boolean))].sort();
  return`<div class="row between"><h1>Contenedores</h1><div class="row"><button data-accion="csv-cont">Exportar CSV</button>${btnE(`<button class="primary" data-accion="nuevo-cont">+ Nuevo contenedor</button>`)}</div></div>
  <div class="row between">${chips("cont",f.estado,[["activos","Flota",n.activos],["disponible","Disponibles",n.disponible],["arrendado","Arrendados",n.arrendado],["mantencion","Mantención",n.mantencion],["vendido","Vendidos",n.vendido],["todos","Todos",n.todos]])}
  <div class="row"><select id="f-tipo-cont" class="sel"><option value="">Todos los tipos</option>${tps.map(t=>`<option ${f.tipo===t?"selected":""}>${esc(t)}</option>`).join("")}</select>${buscador("q-cont",f.q,"Buscar código, cliente u obra")}</div></div>
  <div class="panel">${rows.length?`<div class="scroll"><table><thead><tr><th>Código</th><th>Tipo</th><th>Estado</th><th>Cliente / ubicación</th><th>Contrato</th><th>Desde</th><th class="num">Tarifa / precio</th></tr></thead><tbody>
  ${vis.map(({c,e})=>{const a=I.activo.get(c.id);const vt=I.venta.get(c.id);
    return`<tr class="clic" data-cont="${esc(c.id)}"><td class="mono"><b>${esc(c.codigo)}</b></td><td>${esc(c.tipo||"")} <span class="muted small">${esc([c.dimension,c.caracteristica].filter(Boolean).join(" · "))}</span></td><td>${pill(e)}</td>
    <td class="trunc">${a?esc(cliNom(a.ctr.clienteId))+(a.ctr.obra?` <span class="muted small">· ${esc(a.ctr.obra)}</span>`:""):e==="vendido"?`<span class="muted">${esc(vt?cliNom(vt.clienteId):c.vendidoA||"—")}</span>`:`<span class="muted">${esc(c.ubicacion||"Patio")}</span>`}</td>
    <td>${a?ctrLink(a.ctr):"—"}</td><td>${a?fdate(a.item.salida||a.ctr.inicio):"—"}</td><td class="num">${a?clp(a.item.tarifa):clp(c.precioMes)}</td></tr>`}).join("")}
  </tbody></table></div>${mas}`:vacio("No hay contenedores con este filtro")}</div>`;
}

// ---------- CLIENTES ----------
function vClientes(){
  const f=S.f.cli;const I=ix();let rows=all("clientes");
  if(f.q){const q=norm(f.q);rows=rows.filter(c=>norm([c.nombre,c.rut,c.contacto,c.email].join(" ")).includes(q))}
  const info=c=>{const cs=I.cliCtr.get(c.id)||[];const vig=cs.filter(x=>x.estado==="vigente");return{vig,fuera:vig.reduce((s,x)=>s+(x.items||[]).filter(i=>!i.devolucion).length,0),mensual:vig.reduce((s,x)=>s+mensualCtr(x),0),deuda:vig.reduce((s,x)=>s+(I.deuda.get(x.id)?.length||0)*conIVA(mensualCtr(x)),0),total:cs.length}};
  rows=rows.map(c=>({c,i:info(c)})).sort((a,b)=>b.i.mensual-a.i.mensual||a.c.nombre.localeCompare(b.c.nombre));
  const {vis,mas}=paginar("cli",rows);
  return`<div class="row between"><h1>Clientes</h1><div class="row"><button data-accion="csv-cli">Exportar CSV</button>${btnE(`<button class="primary" data-accion="nuevo-cli">+ Nuevo cliente</button>`)}</div></div>
  <div class="row">${buscador("q-cli",f.q,"Buscar nombre, RUT o contacto")}</div>
  <div class="panel">${rows.length?`<div class="scroll"><table><thead><tr><th>Cliente</th><th>RUT</th><th>Contacto</th><th class="num">Contratos vig.</th><th class="num">En terreno</th><th class="num">Mensual neto</th><th class="num">Por cobrar</th></tr></thead><tbody>
  ${vis.map(({c,i})=>`<tr class="clic" data-href="#cliente/${esc(c.id)}"><td><b>${esc(c.nombre)}</b></td><td class="mono">${esc(c.rut||"—")}</td><td class="trunc">${esc([c.contacto,c.telefono].filter(Boolean).join(" · ")||"—")}</td><td class="num">${i.vig.length||'<span class="muted">0</span>'}</td><td class="num">${i.fuera||'<span class="muted">0</span>'}</td><td class="num">${i.mensual?clp(i.mensual):"—"}</td><td class="num">${i.deuda?`<span style="color:var(--bad)">${clp(i.deuda)}</span>`:"—"}</td></tr>`).join("")}
  </tbody></table></div>${mas}`:vacio("No hay clientes","Agrega uno con “Nuevo cliente”.")}</div>`;
}
function vCliente(id){
  const c=get("clientes",id);if(!c)return vacio("Cliente no encontrado")+`<p><a href="#clientes">← Clientes</a></p>`;
  const I=ix();const cs=(I.cliCtr.get(id)||[]).slice().sort((a,b)=>num(b.numero)-num(a.numero));const vs=(I.cliVen.get(id)||[]);
  const vig=cs.filter(x=>x.estado==="vigente");const mensual=vig.reduce((s,x)=>s+mensualCtr(x),0);
  const deuda=vig.reduce((s,x)=>s+(I.deuda.get(x.id)?.length||0)*conIVA(mensualCtr(x)),0);
  return`<p class="small"><a href="#clientes">← Clientes</a></p>
  <div class="row between"><h1>${esc(c.nombre)}</h1><div class="row">${btnE(`<button data-editar-cli="${id}">Editar</button><button class="primary" data-accion="nuevo-contrato" data-cli="${id}">+ Nuevo contrato</button>`)}</div></div>
  <div class="tiles"><div class="tile"><span class="k">Contratos vigentes</span><span class="v">${vig.length}</span><span class="s">${cs.length} en total</span></div>
   <div class="tile"><span class="k">Arriendo mensual</span><span class="v">${clp(mensual)}</span><span class="s">neto</span></div>
   <div class="tile ${deuda?"alerta":""}"><span class="k">Por cobrar</span><span class="v">${clp(deuda)}</span><span class="s">con IVA</span></div>
   <div class="tile"><span class="k">Compras</span><span class="v">${vs.filter(x=>x.estado!=="anulada").length}</span><span class="s">ventas registradas</span></div></div>
  <div class="panel"><div class="pb"><dl class="kv"><dt>RUT</dt><dd class="mono">${esc(c.rut||"—")}</dd><dt>Giro</dt><dd>${esc(c.giro||"—")}</dd><dt>Contacto</dt><dd>${esc(c.contacto||"—")}</dd><dt>Teléfono</dt><dd>${esc(c.telefono||"—")}</dd><dt>Email</dt><dd>${esc(c.email||"—")}</dd><dt>Dirección</dt><dd>${esc(c.direccion||"—")}</dd>${c.notas?`<dt>Notas</dt><dd>${esc(c.notas)}</dd>`:""}</dl></div></div>
  <div class="panel"><div class="ph"><h2>Contratos</h2></div>${cs.length?`<div class="scroll"><table><thead><tr><th>N°</th><th>Inicio</th><th>Obra</th><th class="num">Contenedores</th><th class="num">Mensual</th><th>Estado</th></tr></thead><tbody>${cs.map(x=>`<tr class="clic" data-href="#contrato/${esc(x.id)}"><td><b>${esc(x.numero)}</b></td><td>${fdate(x.inicio)}</td><td class="trunc">${esc(x.obra||"—")}</td><td class="num">${(x.items||[]).length}</td><td class="num">${x.estado==="vigente"?clp(mensualCtr(x)):"—"}</td><td>${pill(x.estado)}</td></tr>`).join("")}</tbody></table></div>`:`<div class="pb muted">Sin contratos.</div>`}</div>
  ${vs.length?`<div class="panel"><div class="ph"><h2>Compras</h2></div><div class="scroll"><table><thead><tr><th>N°</th><th>Fecha</th><th>Contenedores</th><th class="num">Neto</th><th>Estado</th></tr></thead><tbody>${vs.map(x=>`<tr class="clic" data-venta="${esc(x.id)}"><td>${esc(x.numero)}</td><td>${fdate(x.fecha)}</td><td class="mono small">${esc((x.items||[]).map(i=>i.codigo||contCod(i.contenedorId)).join(", "))}</td><td class="num">${clp((x.items||[]).reduce((s,i)=>s+num(i.precio),0))}</td><td>${pill(x.estado||"ok")}</td></tr>`).join("")}</tbody></table></div></div>`:""}
  ${esAdmin()?`<div class="row"><button class="danger" data-borrar-cli="${id}">Eliminar cliente</button></div>`:""}`;
}

// ---------- VENTAS ----------
function vVentas(){
  const f=S.f.ven;let rows=all("ventas");
  if(f.q){const q=norm(f.q);rows=rows.filter(x=>norm([x.numero,cliNom(x.clienteId),x.factura,(x.items||[]).map(i=>i.codigo).join(" ")].join(" ")).includes(q))}
  rows.sort((a,b)=>(b.fecha||"").localeCompare(a.fecha||"")||num(b.numero)-num(a.numero));
  const {vis,mas}=paginar("ven",rows);const tot=rows.filter(x=>x.estado!=="anulada").reduce((s,x)=>s+(x.items||[]).reduce((t,i)=>t+num(i.precio),0),0);
  return`<div class="row between"><h1>Ventas</h1><div class="row"><button data-accion="csv-ven">Exportar CSV</button>${btnE(`<button class="primary" data-accion="nueva-venta">+ Nueva venta</button>`)}</div></div>
  <div class="row between">${buscador("q-ven",f.q,"Buscar N°, cliente, factura o contenedor")}<span class="status">${rows.length} ventas · ${clp(tot)} neto</span></div>
  <div class="panel">${rows.length?`<div class="scroll"><table><thead><tr><th>N°</th><th>Fecha</th><th>Cliente</th><th>Contenedores</th><th>Factura</th><th class="num">Neto</th><th class="num">Total c/IVA</th><th>Estado</th></tr></thead><tbody>
  ${vis.map(x=>{const n=(x.items||[]).reduce((s,i)=>s+num(i.precio),0);return`<tr class="clic" data-venta="${esc(x.id)}"><td><b>${esc(x.numero??"—")}</b></td><td>${fdate(x.fecha)}</td><td>${esc(cliNom(x.clienteId))}</td><td class="mono small">${esc((x.items||[]).slice(0,3).map(i=>i.codigo||contCod(i.contenedorId)).join(", "))}${(x.items||[]).length>3?" +"+((x.items||[]).length-3):""}</td><td>${esc(x.factura||"—")}</td><td class="num">${clp(n)}</td><td class="num">${clp(conIVA(n))}</td><td>${pill(x.estado||"ok")}</td></tr>`}).join("")}
  </tbody></table></div>${mas}`:vacio("No hay ventas registradas")}</div>`;
}

// ---------- PAGOS / COBRANZA ----------
function vPagos(){
  const f=S.f.pag;const I=ix();
  const meses=[...new Set(all("pagos").map(p=>p.periodo).filter(Boolean))].sort().reverse();
  const per=f.mes||hoy().slice(0,7);
  const vig=all("contratos").filter(c=>c.estado==="vigente"&&(c.cobrarDesde||c.inicio)&&(c.cobrarDesde||c.inicio).slice(0,7)<=per);
  let filas=vig.map(c=>({c,e:I.pagados.get(c.id)?.has(per)?"pagado":(I.deuda.get(c.id)||[]).some(p=>p.periodo===per)?estadoPagoMes(c,per):"—",p:(I.pagos.get(c.id)||[]).find(p=>p.periodo===per)}));
  if(f.q){const q=norm(f.q);filas=filas.filter(x=>norm([x.c.numero,cliNom(x.c.clienteId),x.p?.factura].join(" ")).includes(q))}
  filas.sort((a,b)=>({atrasado:0,pendiente:1,"—":2,pagado:3}[a.e]-{atrasado:0,pendiente:1,"—":2,pagado:3}[b.e])||num(a.c.numero)-num(b.c.numero));
  const cobrado=all("pagos").filter(p=>p.periodo===per).reduce((s,p)=>s+num(p.monto),0);
  const esperado=vig.reduce((s,c)=>s+conIVA(mensualCtr(c)),0);
  const pagadosN=filas.filter(x=>x.e==="pagado").length;
  const opts=[...new Set([hoy().slice(0,7),...meses])].sort().reverse().slice(0,36);
  const {vis,mas}=paginar("pag",filas);
  return`<div class="row between"><h1>Pagos y cobranza</h1><div class="row"><button data-accion="csv-pag">Exportar pagos CSV</button>${btnE(`<button class="primary" data-accion="nuevo-pago">+ Registrar pago</button>`)}</div></div>
  <div class="row between"><div class="row"><label class="inline">Mes <select id="f-mes" class="sel">${opts.map(m=>`<option value="${m}" ${m===per?"selected":""}>${fper(m)}</option>`).join("")}</select></label></div>${buscador("q-pag",f.q,"Buscar contrato, cliente o factura")}</div>
  <div class="tiles"><div class="tile"><span class="k">Cobrado ${fper(per)}</span><span class="v">${clp(cobrado)}</span><span class="s">${pagadosN} de ${vig.length} contratos</span></div>
   <div class="tile"><span class="k">Esperado del mes</span><span class="v">${clp(esperado)}</span><span class="s">con IVA, contratos vigentes</span></div>
   <div class="tile ${esperado-cobrado>0?"alerta":""}"><span class="k">Falta por cobrar</span><span class="v">${clp(Math.max(0,esperado-cobrado))}</span><span class="s">de ${fper(per)}</span></div></div>
  <div class="panel">${filas.length?`<div class="scroll"><table><thead><tr><th>Contrato</th><th>Cliente</th><th class="num">Mensual c/IVA</th><th>Estado ${fper(per)}</th><th>Factura</th><th class="num">Pagado</th><th></th></tr></thead><tbody>
  ${vis.map(x=>`<tr><td>${ctrLink(x.c)}</td><td>${cliLink(x.c.clienteId)}</td><td class="num">${clp(conIVA(mensualCtr(x.c)))}</td><td>${pill(x.e)||'<span class="muted small">no corresponde</span>'}</td><td>${esc(x.p?.factura||"—")}</td><td class="num">${x.p?clp(x.p.monto):"—"}</td><td class="num">${x.p?btnE(`<button class="sm" data-pago-edit="${x.p.id}">Editar</button>`):btnE(`<button class="sm" data-pagar="${x.c.id}" data-per="${per}">Registrar</button>`)}</td></tr>`).join("")}
  </tbody></table></div>${mas}`:vacio("No hay contratos vigentes en este mes")}</div>`;
}

// ---------- MÁS: tipos, proveedores, usuarios, respaldo ----------
function vMas(){
  const tab=S.f.mas;
  const tabs=[["tipos","Tipos de contenedor"],["proveedores","Proveedores"],["usuarios","Usuarios"],["respaldo","Respaldo"]];
  let cuerpo="";
  if(tab==="tipos"){const ts=tipos();const cuenta=t=>all("contenedores").filter(c=>c.tipo===t&&estadoCont(c)!=="vendido").length;
    cuerpo=`<div class="row between"><p class="muted small" style="margin:0">El prefijo arma el código de cada contenedor nuevo (ej. OFI-000286). Los precios se proponen al arrendar o vender.</p>${btnE(`<button class="primary" data-accion="nuevo-tipo">+ Nuevo tipo</button>`)}</div>
    <div class="panel"><div class="scroll"><table><thead><tr><th>Tipo</th><th>Prefijo</th><th class="num">Arriendo mensual</th><th class="num">Precio venta</th><th class="num">En flota</th><th></th></tr></thead><tbody>${ts.map(t=>`<tr><td><b>${esc(t.nombre)}</b></td><td class="mono">${esc(t.prefijo)}</td><td class="num">${clp(t.precioMes)}</td><td class="num">${clp(t.precioVenta)}</td><td class="num">${cuenta(t.nombre)}</td><td class="num">${btnE(`<button class="sm" data-tipo-edit="${esc(t.id||"nuevo:"+t.nombre)}">Editar</button>`)}</td></tr>`).join("")}</tbody></table></div></div>`}
  if(tab==="proveedores"){const ps=all("proveedores").sort((a,b)=>a.nombre.localeCompare(b.nombre));
    cuerpo=`<div class="row between"><span></span>${btnE(`<button class="primary" data-accion="nuevo-prov">+ Nuevo proveedor</button>`)}</div>
    <div class="panel">${ps.length?`<div class="scroll"><table><thead><tr><th>Proveedor</th><th>RUT</th><th>Contacto</th><th>Teléfono</th><th>Email</th><th class="num">Contenedores</th><th></th></tr></thead><tbody>${ps.map(p=>`<tr><td><b>${esc(p.nombre)}</b></td><td class="mono">${esc(p.rut||"—")}</td><td>${esc(p.contacto||"—")}</td><td>${esc(p.telefono||"—")}</td><td>${esc(p.email||"—")}</td><td class="num">${all("contenedores").filter(c=>c.proveedorId===p.id).length}</td><td class="num">${btnE(`<button class="sm" data-prov-edit="${p.id}">Editar</button>`)}</td></tr>`).join("")}</tbody></table></div>`:vacio("Sin proveedores","Registra a quién le compras contenedores.")}</div>`}
  if(tab==="usuarios"){const us=all("perfiles").sort((a,b)=>a.id.localeCompare(b.id));
    cuerpo=`<div class="row between"><p class="muted small" style="margin:0;max-width:70ch">Agrega aquí el correo de cada persona. Luego esa persona entra al link de la plataforma, presiona <b>“Crear mi cuenta”</b> y elige su contraseña. Solo pueden crear cuenta los correos de esta lista.</p>${esAdmin()?`<button class="primary" data-accion="nuevo-usuario">+ Agregar usuario</button>`:""}</div>
    <div class="panel"><div class="scroll"><table><thead><tr><th>Correo</th><th>Nombre</th><th>Perfil</th><th>Estado</th><th></th></tr></thead><tbody>${us.map(u=>`<tr><td>${esc(u.id)}</td><td>${esc(u.nombre||"—")}</td><td>${esc(ROLES[u.rol]||u.rol)}</td><td>${u.activo===false?'<span class="pill p-venc">Bloqueado</span>':'<span class="pill p-disp">Activo</span>'}</td><td class="num">${esAdmin()&&u.id!==S.user.email?`<button class="sm" data-user-edit="${esc(u.id)}">Editar</button>`:""}</td></tr>`).join("")}</tbody></table></div></div>`}
  if(tab==="respaldo"){
    cuerpo=`<div class="panel"><div class="pb" style="display:flex;flex-direction:column;gap:14px">
     <p style="margin:0">Descarga una copia completa de la plataforma (contenedores, clientes, contratos, pagos, ventas, proveedores y tipos). Guárdala en Drive o en tu correo, idealmente una vez por semana.</p>
     <div class="row"><button class="primary" data-accion="respaldo">Descargar respaldo completo</button></div>
     ${esAdmin()?`<hr><p style="margin:0"><b>Restaurar o importar:</b> carga un respaldo descargado desde aquí. Los registros del archivo reemplazan a los que tengan el mismo identificador; el resto se mantiene.</p>
     <div class="row"><label class="btn" style="cursor:pointer">Elegir archivo…<input type="file" id="rest-file" accept=".json,application/json" hidden></label></div>`:""}
    </div></div>`}
  return`<h1>Configuración</h1>${chips("mas",tab,tabs.map(([k,l])=>[k,l]))}${cuerpo}`;
}

// ---------- selectores ----------
// ---------- selector con búsqueda (escribe y filtra) ----------
function combo(id,opciones,sel,ph){const o=opciones.find(x=>x.v===sel);
  return`<div class="combo" data-combo="${id}"><input type="hidden" id="${id}" value="${esc(o?sel:"")}"><input id="${id}-q" class="combo-q" autocomplete="off" spellcheck="false" placeholder="${esc(ph)}" value="${esc(o?o.t:"")}"><div class="combo-list" hidden></div></div>`}
function montarCombo(sc,id,opciones,onPick){
  const box=sc.querySelector(`[data-combo="${id}"]`);if(!box)return;const q=box.querySelector(".combo-q"),h=box.querySelector("input[type=hidden]"),list=box.querySelector(".combo-list");let act=0,vis=[];
  const marcar=(t,w)=>{let r=esc(t);w.forEach(x=>{if(!x)return;const i=norm(t).indexOf(x);if(i>=0)r=esc(t.slice(0,i))+"<mark>"+esc(t.slice(i,i+x.length))+"</mark>"+esc(t.slice(i+x.length))});return r};
  const pintar=()=>{const w=norm(q.value).split(/\s+/).filter(Boolean);const sel=opciones.find(o=>o.v===h.value);const ws=sel&&q.value===sel.t?[]:w;
    vis=opciones.filter(o=>{const t=norm(o.t+" "+(o.s||""));return ws.every(x=>t.includes(x))});const total=vis.length;vis=vis.slice(0,60);act=0;
    list.innerHTML=vis.length?vis.map((o,i)=>`<div class="combo-op${i===act?" act":""}" data-i="${i}">${marcar(o.t,ws.slice(0,1))}${o.s?` <span class="muted small">${esc(o.s)}</span>`:""}</div>`).join("")+(total>60?`<div class="combo-vacio">Sigue escribiendo para ver más (${total} resultados)</div>`:""):`<div class="combo-vacio">Sin resultados para “${esc(q.value)}”</div>`;list.hidden=false};
  const elegir=i=>{const o=vis[i];if(!o)return;h.value=o.v;q.value=o.t;list.hidden=true;if(onPick)onPick(o.v)};
  q.addEventListener("focus",()=>{q.select();pintar()});
  q.addEventListener("input",()=>{h.value="";pintar()});
  q.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&!list.hidden){e.stopPropagation();list.hidden=true;return}
    if(list.hidden&&(e.key==="ArrowDown")){pintar();return}
    if(list.hidden)return;
    if(e.key==="ArrowDown")act=Math.min(act+1,vis.length-1);else if(e.key==="ArrowUp")act=Math.max(act-1,0);else if(e.key==="Enter"){e.preventDefault();elegir(act);return}else if(e.key==="Tab"){if(q.value&&!h.value&&vis.length)elegir(act);return}else return;
    e.preventDefault();list.querySelectorAll(".combo-op").forEach((d,i)=>d.classList.toggle("act",i===act));list.querySelector(".act")?.scrollIntoView({block:"nearest"})});
  list.addEventListener("mousedown",e=>{e.preventDefault();const d=e.target.closest(".combo-op");if(d)elegir(+d.dataset.i)});
  q.addEventListener("blur",()=>setTimeout(()=>{list.hidden=true;if(!h.value&&q.value){const ex=opciones.find(o=>norm(o.t)===norm(q.value));if(ex){h.value=ex.v;q.value=ex.t;if(onPick)onPick(ex.v)}}},120));
}
const opsClientes=()=>all("clientes").sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(c=>({v:c.id,t:c.nombre,s:[c.rut,c.contacto].filter(Boolean).join(" · ")}));
const optsClientes=sel=>`<option value="">Selecciona un cliente…</option>`+all("clientes").sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(c=>`<option value="${esc(c.id)}" ${c.id===sel?"selected":""}>${esc(c.nombre)}${c.rut?" · "+esc(c.rut):""}</option>`).join("");
function datalistDisponibles(id,incluir=[]){
  const ok=all("contenedores").filter(c=>estadoCont(c)==="disponible"||incluir.includes(c.id)).sort((a,b)=>a.codigo.localeCompare(b.codigo,undefined,{numeric:true}));
  return`<datalist id="${id}">${ok.map(c=>`<option value="${esc(c.codigo)}">${esc(c.tipo||"")} ${esc(c.dimension||"")}</option>`).join("")}</datalist>`;
}
const contPorCodigo=cod=>{cod=String(cod||"").trim().toUpperCase();return all("contenedores").find(c=>(c.codigo||"").toUpperCase()===cod)};
const precioSugerido=(c,campo)=>num(c?.[campo])||num(tipos().find(t=>t.nombre===c?.tipo)?.[campo]);

// ---------- CLIENTE ----------
function formCliente(c,despues){
  const nuevo=!c;c=c||{};
  modal(nuevo?"Nuevo cliente":"Editar cliente",`<div class="fg">
    <label class="full">Nombre o razón social *<input id="c-nombre" value="${esc(c.nombre)}"></label>
    <label>RUT<input id="c-rut" value="${esc(c.rut)}" placeholder="76.123.456-7"></label>
    <label>Giro<input id="c-giro" value="${esc(c.giro)}"></label>
    <label>Persona de contacto<input id="c-contacto" value="${esc(c.contacto)}"></label>
    <label>Teléfono<input id="c-tel" value="${esc(c.telefono)}"></label>
    <label>Email<input id="c-email" type="email" value="${esc(c.email)}"></label>
    <label class="full">Dirección<input id="c-dir" value="${esc(c.direccion)}"></label>
    <label class="full">Notas<textarea id="c-notas">${esc(c.notas)}</textarea></label></div>`,
  `<button data-close>Cancelar</button><button class="primary" id="ok">${nuevo?"Agregar cliente":"Guardar"}</button>`,sc=>{
    sc.querySelector("#ok").onclick=async()=>{
      const nombre=v(sc,"c-nombre");if(!nombre){toast("Escribe el nombre del cliente");return}
      const dup=all("clientes").find(x=>x.id!==c.id&&norm(x.nombre)===norm(nombre));if(dup&&nuevo){toast("Ya existe un cliente con ese nombre");return}
      const id=await guardar("clientes",{...c,nombre,rut:v(sc,"c-rut"),giro:v(sc,"c-giro"),contacto:v(sc,"c-contacto"),telefono:v(sc,"c-tel"),email:v(sc,"c-email"),direccion:v(sc,"c-dir"),notas:v(sc,"c-notas")},nuevo?"Cliente agregado":"Cliente actualizado");
      if(id){cerrarModal();if(despues)despues(id)}
    };
  });
}

// ---------- CONTENEDOR ----------
function formContenedor(c){
  const nuevo=!c;c=c||{};const ts=tipos();
  const tipoIni=c.tipo||ts[0]?.nombre||"";
  modal(nuevo?"Nuevo contenedor":"Editar "+c.codigo,`<div class="fg">
    <label>Tipo *<select id="k-tipo">${ts.map(t=>`<option ${t.nombre===tipoIni?"selected":""}>${esc(t.nombre)}</option>`).join("")}${c.tipo&&!ts.some(t=>t.nombre===c.tipo)?`<option selected>${esc(c.tipo)}</option>`:""}</select></label>
    <label>Código *<input id="k-cod" class="mono" value="${esc(c.codigo||sigCodigo(tipoIni))}"></label>
    <label>Dimensión<select id="k-dim">${DIMS.map(d=>`<option ${c.dimension===d?"selected":""}>${d}</option>`).join("")}</select></label>
    <label>Característica<select id="k-car">${CARACS.map(d=>`<option ${c.caracteristica===d?"selected":""}>${d}</option>`).join("")}</select></label>
    <label>Estado en patio<select id="k-est">${[["disponible","Disponible"],["mantencion","En mantención"],["vendido","Vendido"],["baja","De baja"]].map(([k,l])=>`<option value="${k}" ${(c.estado||"disponible")===k?"selected":""}>${l}</option>`).join("")}</select></label>
    <label>Ubicación<input id="k-ubi" value="${esc(c.ubicacion||"Patio Dima Express")}"></label>
    <label>Arriendo mensual neto<input id="k-pm" inputmode="numeric" value="${esc(c.precioMes||"")}"></label>
    <label>Precio venta neto<input id="k-pv" inputmode="numeric" value="${esc(c.precioVenta||"")}"></label>
    <label>Proveedor<select id="k-prov"><option value="">—</option>${all("proveedores").map(p=>`<option value="${p.id}" ${c.proveedorId===p.id?"selected":""}>${esc(p.nombre)}</option>`).join("")}</select></label>
    <label>Costo de compra<input id="k-costo" inputmode="numeric" value="${esc(c.costo||"")}"></label>
    ${c.estado==="vendido"||c.vendidoA?`<label class="full">Vendido a<input id="k-vend" value="${esc(c.vendidoA)}"></label>`:""}
    <label class="full">Notas<textarea id="k-notas">${esc(c.notas)}</textarea></label></div>`,
  `<button data-close>Cancelar</button><button class="primary" id="ok">${nuevo?"Agregar":"Guardar"}</button>`,sc=>{
    const tsel=sc.querySelector("#k-tipo");
    tsel.onchange=()=>{if(nuevo)sc.querySelector("#k-cod").value=sigCodigo(tsel.value);const t=ts.find(x=>x.nombre===tsel.value);if(t&&!v(sc,"k-pm"))sc.querySelector("#k-pm").value=t.precioMes||"";if(t&&!v(sc,"k-pv"))sc.querySelector("#k-pv").value=t.precioVenta||""};
    if(nuevo)tsel.onchange();
    sc.querySelector("#ok").onclick=async()=>{
      const codigo=v(sc,"k-cod").toUpperCase();if(!codigo){toast("Falta el código");return}
      if(all("contenedores").some(x=>x.id!==c.id&&(x.codigo||"").toUpperCase()===codigo)){toast("Ya existe un contenedor con el código "+codigo);return}
      const o={...c,codigo,tipo:v(sc,"k-tipo"),dimension:v(sc,"k-dim"),caracteristica:v(sc,"k-car"),estado:v(sc,"k-est"),ubicacion:v(sc,"k-ubi"),precioMes:num(v(sc,"k-pm")),precioVenta:num(v(sc,"k-pv")),proveedorId:v(sc,"k-prov"),costo:num(v(sc,"k-costo")),notas:v(sc,"k-notas")};
      if(sc.querySelector("#k-vend"))o.vendidoA=v(sc,"k-vend");
      if(nuevo)o.id=codigo.replace(/[^A-Za-z0-9_.-]/g,"_");
      if(await guardar("contenedores",o,nuevo?"Contenedor agregado":"Cambios guardados"))cerrarModal();
    };
  });
}
function verContenedor(id){
  const c=get("contenedores",id);if(!c)return;const I=ix();const e=estadoCont(c);const a=I.activo.get(id);
  const hist=(I.contHist.get(id)||[]).slice().sort((x,y)=>((y.item.salida||y.ctr?.inicio||y.venta?.fecha||"")).localeCompare(x.item.salida||x.ctr?.inicio||x.venta?.fecha||""));
  const prov=get("proveedores",c.proveedorId);
  modal(c.codigo,`<dl class="kv"><dt>Tipo</dt><dd>${esc([c.tipo,c.dimension,c.caracteristica].filter(Boolean).join(" · "))}</dd><dt>Estado</dt><dd>${pill(e)}${a?` en ${ctrLink(a.ctr)} · ${esc(cliNom(a.ctr.clienteId))}`:""}${e==="vendido"&&c.vendidoA?" a "+esc(c.vendidoA):""}</dd>
   <dt>Ubicación</dt><dd>${esc(a?a.ctr.obra||"—":c.ubicacion||"—")}</dd><dt>Precios</dt><dd>${clp(c.precioMes)}/mes · venta ${clp(c.precioVenta)}</dd>${prov?`<dt>Proveedor</dt><dd>${esc(prov.nombre)}${c.costo?" · costo "+clp(c.costo):""}</dd>`:""}${c.notas?`<dt>Notas</dt><dd>${esc(c.notas)}</dd>`:""}</dl>
   <h3 class="sub">Historial</h3>
   ${hist.length?`<div class="scroll panel"><table><thead><tr><th>Operación</th><th>Cliente</th><th>Desde</th><th>Hasta</th><th class="num">Monto</th></tr></thead><tbody>${hist.map(h=>h.tipo==="arriendo"?`<tr><td>Arriendo ${ctrLink(h.ctr)}</td><td>${esc(cliNom(h.ctr.clienteId))}</td><td>${fdate(h.item.salida||h.ctr.inicio)}</td><td>${h.item.devolucion?fdate(h.item.devolucion):h.ctr.estado==="vigente"?'<span class="pill p-arr">En terreno</span>':fdate(h.ctr.cierre)}</td><td class="num">${clp(h.item.tarifa)}/mes</td></tr>`:`<tr><td>Venta N° ${esc(h.venta.numero)}</td><td>${esc(cliNom(h.venta.clienteId))}</td><td>${fdate(h.venta.fecha)}</td><td>${pill(h.venta.estado||"ok")}</td><td class="num">${clp(h.item.precio)}</td></tr>`).join("")}</tbody></table></div>`:`<p class="muted" style="margin:0">Sin movimientos registrados.</p>`}`,
  `${esAdmin()?`<button class="danger" id="del">Eliminar</button><span style="flex:1"></span>`:""}${btnE(`<button id="ed">Editar</button>`)}${btnE(e==="disponible"?`<button id="arr">Arrendar</button><button id="ven">Vender</button>`:"")}${btnE(e==="arrendado"?`<button class="primary" id="dev">Registrar devolución</button>`:"")}`,sc=>{
    const b=(s,f)=>{const el=sc.querySelector(s);if(el)el.onclick=f};
    b("#ed",()=>formContenedor(c));b("#arr",()=>formContrato(null,{contenedorId:id}));b("#ven",()=>formVenta(null,{contenedorId:id}));
    b("#dev",()=>{const i=a.ctr.items.indexOf(a.item);formDevolucion(a.ctr,i)});
    b("#del",()=>confirmar(`¿Eliminar el contenedor ${c.codigo}? Su historial en contratos se mantiene.`,()=>borrar("contenedores",id,"Contenedor eliminado")));
  },true);
}

// ---------- CONTRATO ----------
function filaItem(it,i){
  return`<tr data-fila="${i}"><td><input class="mono it-cod" list="dl-disp" value="${esc(it.codigo||(it.contenedorId?contCod(it.contenedorId):""))}" placeholder="Código" ${it.fijo?"disabled":""}></td><td class="it-tipo small muted">${esc(get("contenedores",it.contenedorId)?.tipo||"")}</td><td><input class="it-tar" inputmode="numeric" value="${esc(it.tarifa||"")}" placeholder="Tarifa neta"></td><td><input class="it-sal" type="date" value="${esc(it.salida||"")}"></td><td><input class="it-guia" value="${esc(it.guia||"")}" placeholder="N° guía"></td><td>${it.fijo?"":`<button class="sm" data-quitar="${i}" type="button" aria-label="Quitar">✕</button>`}</td></tr>`;
}
function formContrato(c,pre={}){
  const nuevo=!c;c=c?JSON.parse(JSON.stringify(c)):{numero:sigNumero("contratos"),inicio:hoy(),traslado:"Dima Maquinarias",clienteId:pre.clienteId||"",items:[]};
  if(nuevo&&pre.contenedorId){const k=get("contenedores",pre.contenedorId);c.items.push({contenedorId:k.id,codigo:k.codigo,tarifa:precioSugerido(k,"precioMes")})}
  if(nuevo&&!c.items.length)c.items.push({});
  const g=c.garantia||{};
  const sc=modal(nuevo?"Nuevo contrato":"Editar contrato N° "+c.numero,`<div class="fg">
    <label>N° contrato<input id="t-num" inputmode="numeric" value="${esc(c.numero)}"></label>
    <label>Fecha de inicio *<input id="t-ini" type="date" value="${esc(c.inicio)}"></label>
    <div class="lbl full">Cliente *<div class="row" style="flex-wrap:nowrap">${combo("t-cli",opsClientes(),c.clienteId,"Escribe para buscar: nombre, RUT o contacto")}<button class="sm" type="button" id="t-ncli">+ Nuevo</button></div></div>
    <label>N° orden de compra<input id="t-oc" value="${esc(c.oc)}"></label><label>Fecha OC<input id="t-ocf" type="date" value="${esc(c.ocFecha)}"></label>
    <label>Contacto<input id="t-con" value="${esc(c.contacto)}"></label><label>Teléfono<input id="t-tel" value="${esc(c.telefono)}"></label>
    <label>Email<input id="t-mail" value="${esc(c.email)}"></label><label>Traslado<select id="t-tras">${TRASLADOS.map(x=>`<option ${c.traslado===x?"selected":""}>${x}</option>`).join("")}</select></label>
    <label class="full">Obra / dirección de instalación<input id="t-obra" value="${esc(c.obra)}"></label>
    <label>Vence (opcional)<input id="t-ven" type="date" value="${esc(c.vence)}"></label><label>Cobrar desde<input id="t-cob" type="date" value="${esc(c.cobrarDesde||"")}" title="Por defecto, la fecha de inicio"></label>
  </div>
  <h3 class="sub">Contenedores</h3>${datalistDisponibles("dl-disp",c.items.map(i=>i.contenedorId).filter(Boolean))}
  <div class="scroll"><table class="items"><thead><tr><th>Código</th><th>Tipo</th><th>Tarifa neta/mes</th><th>Salida</th><th>Guía despacho</th><th></th></tr></thead><tbody id="t-items">${c.items.map((it,i)=>filaItem({...it,fijo:!nuevo&&it.contenedorId},i)).join("")}</tbody></table></div>
  <div class="row between"><button class="sm" type="button" id="t-add">+ Agregar contenedor</button><div class="calc" id="t-calc" style="min-width:260px"></div></div>
  <details ${g.documento||g.cheque?"open":""}><summary>Garantía</summary><div class="fg" style="margin-top:10px">
    <label>Documento<input id="g-doc" value="${esc(g.documento)}" placeholder="Cheque, pagaré, vale vista…"></label><label>Banco<input id="g-ban" value="${esc(g.banco)}"></label>
    <label>Cuenta N°<input id="g-cta" value="${esc(g.cuenta)}"></label><label>Cheque N°<input id="g-che" value="${esc(g.cheque)}"></label><label>Monto<input id="g-mon" inputmode="numeric" value="${esc(g.monto||"")}"></label></div></details>
  <label class="full">Notas<textarea id="t-notas">${esc(c.notas)}</textarea></label>`,
  `<button data-close>Cancelar</button><button class="primary" id="ok">${nuevo?"Crear contrato":"Guardar cambios"}</button>`,null,true);
  montarCombo(sc,"t-cli",opsClientes());
  const body=sc.querySelector("#t-items");
  const leer=()=>[...body.querySelectorAll("tr")].map(tr=>{const i=+tr.dataset.fila;const old=c.items[i]||{};const cod=tr.querySelector(".it-cod").value.trim();const k=contPorCodigo(cod);return{...old,contenedorId:k?.id||old.contenedorId||"",codigo:k?.codigo||cod,tarifa:num(tr.querySelector(".it-tar").value),salida:tr.querySelector(".it-sal").value,guia:tr.querySelector(".it-guia").value.trim()}});
  const calc=()=>{const its=leer().filter(i=>i.contenedorId&&!i.devolucion);const n=its.reduce((s,i)=>s+num(i.tarifa),0);sc.querySelector("#t-calc").innerHTML=`<span>${its.length} contenedor(es)</span><b>${clp(n)}</b><span class="tot">Mensual c/IVA</span><b class="tot">${clp(conIVA(n))}</b>`};
  body.addEventListener("input",e=>{const tr=e.target.closest("tr");if(e.target.classList.contains("it-cod")){const k=contPorCodigo(e.target.value);tr.querySelector(".it-tipo").textContent=k?(k.tipo+" "+(k.dimension||"")):"";if(k&&!tr.querySelector(".it-tar").value)tr.querySelector(".it-tar").value=precioSugerido(k,"precioMes")||""}calc()});
  body.addEventListener("click",e=>{const q=e.target.closest("[data-quitar]");if(q){c.items=leer();c.items.splice(+q.dataset.quitar,1);body.innerHTML=c.items.map((it,i)=>filaItem({...it,fijo:!nuevo&&get("contratos",c.id)?.items?.some(x=>x.contenedorId===it.contenedorId)},i)).join("");calc()}});
  sc.querySelector("#t-add").onclick=()=>{c.items=leer();c.items.push({});body.insertAdjacentHTML("beforeend",filaItem({},c.items.length-1));body.querySelector("tr:last-child .it-cod").focus()};
  sc.querySelector("#t-ncli").onclick=()=>{const borrador={...c,items:leer()};formCliente(null,id=>formContrato(nuevo?null:get("contratos",c.id),{...pre,clienteId:id,_b:borrador}))};
  if(pre._b){/* restaurar borrador tras crear cliente */}
  calc();
  sc.querySelector("#ok").onclick=async()=>{
    const clienteId=v(sc,"t-cli"),inicio=v(sc,"t-ini");
    if(!clienteId){toast("Elige el cliente");return}if(!inicio){toast("Indica la fecha de inicio");return}
    let items=leer().filter(i=>i.codigo||i.contenedorId);
    for(const it of items){if(!it.contenedorId){toast("No existe el contenedor "+it.codigo);return}if(!it.tarifa){toast("Falta la tarifa de "+it.codigo);return}it.salida=it.salida||inicio;delete it.fijo}
    const ids=items.map(i=>i.contenedorId);if(new Set(ids).size!==ids.length){toast("Hay un contenedor repetido");return}
    for(const it of items){const a=ix().activo.get(it.contenedorId);if(a&&a.ctr.id!==c.id){toast(`${it.codigo} ya está arrendado en el contrato N° ${a.ctr.numero}`);return}
      const k=get("contenedores",it.contenedorId);if(estadoCont(k)==="vendido"){toast(it.codigo+" está vendido");return}}
    const n=num(v(sc,"t-num"));if(all("contratos").some(x=>x.id!==c.id&&num(x.numero)===n)){toast("Ya existe el contrato N° "+n);return}
    const vence=v(sc,"t-ven");if(vence&&vence<addMonths(inicio,MIN_MESES)){toast(`El plazo mínimo es ${MIN_MESES} meses: debe vencer desde el ${fdate(addMonths(inicio,MIN_MESES))}`);return}
    const o={...c,numero:n,clienteId,inicio,fecha:c.fecha||hoy(),oc:v(sc,"t-oc"),ocFecha:v(sc,"t-ocf"),contacto:v(sc,"t-con"),telefono:v(sc,"t-tel"),email:v(sc,"t-mail"),traslado:v(sc,"t-tras"),obra:v(sc,"t-obra"),vence,cobrarDesde:v(sc,"t-cob"),notas:v(sc,"t-notas"),
      garantia:{documento:v(sc,"g-doc"),banco:v(sc,"g-ban"),cuenta:v(sc,"g-cta"),cheque:v(sc,"g-che"),monto:num(v(sc,"g-mon"))},items,estado:c.estado||"vigente"};
    const id=await guardar("contratos",o,nuevo?"Contrato creado":"Contrato actualizado");
    if(id){cerrarModal();if(nuevo)location.hash="#contrato/"+id}
  };
  if(pre._b){const b=pre._b;["t-oc","t-con","t-tel","t-mail","t-obra"].forEach(k=>{const map={"t-oc":"oc","t-con":"contacto","t-tel":"telefono","t-mail":"email","t-obra":"obra"};if(b[map[k]])sc.querySelector("#"+k).value=b[map[k]]});
    if(b.items?.length){c.items=b.items;body.innerHTML=c.items.map((it,i)=>filaItem(it,i)).join("");calc()}}
}
function formItem(c,i){
  const it=c.items[i];
  modal(`${it.codigo||contCod(it.contenedorId)} · contrato N° ${c.numero}`,`<div class="fg">
    <label>Tarifa neta mensual<input id="i-tar" inputmode="numeric" value="${esc(it.tarifa)}"></label><label>Fecha de salida<input id="i-sal" type="date" value="${esc(it.salida||c.inicio)}"></label>
    <label>Guía de despacho<input id="i-guia" value="${esc(it.guia)}"></label><label>Devolución<input id="i-dev" type="date" value="${esc(it.devolucion||"")}"></label>
    <label>Guía de recepción<input id="i-gd" value="${esc(it.guiaDev)}"></label><label>Observación recepción<input id="i-obs" value="${esc(it.obsDev)}"></label></div>`,
  `<button class="danger" id="del">Quitar del contrato</button><span style="flex:1"></span><button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>`,sc=>{
    sc.querySelector("#ok").onclick=async()=>{const items=c.items.slice();items[i]={...it,tarifa:num(v(sc,"i-tar")),salida:v(sc,"i-sal"),guia:v(sc,"i-guia"),devolucion:v(sc,"i-dev"),guiaDev:v(sc,"i-gd"),obsDev:v(sc,"i-obs")};if(await guardar("contratos",{...c,items},"Contenedor actualizado"))cerrarModal()};
    sc.querySelector("#del").onclick=()=>confirmar("¿Quitar este contenedor del contrato? Úsalo solo si se agregó por error; si fue devuelto, registra la devolución.",async()=>{const items=c.items.slice();items.splice(i,1);return !!(await guardar("contratos",{...c,items},"Contenedor quitado"))},"Quitar");
  });
}
function formDevolucion(c,i){
  const it=c.items[i];const min=addMonths(it.salida||c.inicio,MIN_MESES);
  modal("Registrar devolución",`<dl class="kv"><dt>Contenedor</dt><dd class="mono">${esc(it.codigo||contCod(it.contenedorId))}</dd><dt>Contrato</dt><dd>N° ${esc(c.numero)} · ${esc(cliNom(c.clienteId))}</dd><dt>Salió el</dt><dd>${fdate(it.salida||c.inicio)}</dd></dl>
   <div class="fg"><label>Fecha de devolución *<input id="d-f" type="date" value="${hoy()}"></label><label>Estado al volver<select id="d-e"><option value="disponible">Disponible</option><option value="mantencion">Requiere mantención</option></select></label>
   <label>Guía de recepción<input id="d-g"></label><label class="full">Observaciones<textarea id="d-o" placeholder="Daños, faltantes, limpieza…"></textarea></label></div>
   <p class="small muted" id="d-min" style="margin:0"></p>`,
  `<button data-close>Cancelar</button><button class="primary" id="ok">Registrar devolución</button>`,sc=>{
    const chk=()=>{sc.querySelector("#d-min").textContent=v(sc,"d-f")<min?`Ojo: vuelve antes del plazo mínimo de ${MIN_MESES} meses (${fdate(min)}).`:""};sc.querySelector("#d-f").oninput=chk;chk();
    sc.querySelector("#ok").onclick=async()=>{
      const f=v(sc,"d-f");if(!f){toast("Indica la fecha");return}if(f<(it.salida||c.inicio)){toast("La devolución no puede ser antes de la salida");return}
      const items=c.items.slice();items[i]={...it,devolucion:f,guiaDev:v(sc,"d-g"),obsDev:v(sc,"d-o")};
      const quedan=items.filter(x=>!x.devolucion).length;
      if(!(await guardar("contratos",{...c,items},"Devolución registrada")))return;
      const k=get("contenedores",it.contenedorId);if(k)await guardar("contenedores",{...k,estado:v(sc,"d-e"),ubicacion:"Patio Dima Express"});
      cerrarModal();
      if(!quedan)confirmar(`Ya no quedan contenedores en terreno en el contrato N° ${c.numero}. ¿Cerrarlo con fecha ${fdate(f)}?`,async()=>!!(await guardar("contratos",{...get("contratos",c.id),estado:"cerrado",cierre:f},"Contrato cerrado")),"Cerrar contrato");
    };
  });
}
function formCerrar(c){
  const act=(c.items||[]).filter(i=>!i.devolucion);
  modal("Cerrar contrato N° "+c.numero,`<p style="margin:0">${act.length?`Quedan ${act.length} contenedores en terreno. Se marcarán como devueltos en la fecha de cierre.`:"Todos los contenedores fueron devueltos."}</p><div class="fg"><label>Fecha de cierre<input id="z-f" type="date" value="${hoy()}"></label></div>`,
  `<button data-close>Cancelar</button><button class="primary" id="ok">Cerrar contrato</button>`,sc=>{
    sc.querySelector("#ok").onclick=async()=>{const f=v(sc,"z-f");const items=(c.items||[]).map(i=>i.devolucion?i:{...i,devolucion:f});if(await guardar("contratos",{...c,items,estado:"cerrado",cierre:f},"Contrato cerrado"))cerrarModal()};
  });
}

// ---------- PAGO ----------
function formPago(p,pre={}){
  const nuevo=!p;p=p||{fecha:hoy(),contratoId:pre.contratoId||"",periodo:pre.periodo||""};
  const vig=all("contratos").filter(c=>c.estado==="vigente"||c.id===p.contratoId).sort((a,b)=>num(b.numero)-num(a.numero));
  const opsCtr=vig.map(c=>({v:c.id,t:`N° ${c.numero} · ${cliNom(c.clienteId)}`,s:[c.obra,(c.items||[]).filter(i=>!i.devolucion).map(i=>i.codigo).slice(0,3).join(" ")].filter(Boolean).join(" · ")}));
  const sugerir=(cid)=>{const d=ix().deuda.get(cid);return d?.[0]?.periodo||hoy().slice(0,7)};
  if(nuevo&&p.contratoId&&!p.periodo)p.periodo=sugerir(p.contratoId);
  modal(nuevo?"Registrar pago":"Editar pago",`<div class="fg">
    <div class="lbl full">Contrato *${combo("p-ctr",opsCtr,p.contratoId,"Escribe N° de contrato, cliente u obra")}</div>
    <label>Período (mes que se paga) *<input id="p-per" type="month" value="${esc(p.periodo||hoy().slice(0,7))}"></label>
    <label>Fecha del pago<input id="p-f" type="date" value="${esc(p.fecha)}"></label>
    <label>Monto recibido (con IVA) *<input id="p-m" inputmode="numeric" value="${esc(p.monto||"")}"></label>
    <label>N° factura<input id="p-fac" value="${esc(p.factura)}"></label>
    <label class="full">Notas<input id="p-n" value="${esc(p.notas)}"></label></div><p class="small muted" id="p-info" style="margin:0"></p>`,
  `${!nuevo&&puedeEditar()?`<button class="danger" id="del">Eliminar</button><span style="flex:1"></span>`:""}<button data-close>Cancelar</button><button class="primary" id="ok">${nuevo?"Registrar pago":"Guardar"}</button>`,sc=>{
    const info=()=>{const c=get("contratos",v(sc,"p-ctr"));if(!c){sc.querySelector("#p-info").textContent="";return}const m=conIVA(mensualCtr(c));const d=ix().deuda.get(c.id)||[];
      sc.querySelector("#p-info").textContent=`Mensual con IVA: ${clp(m)}. ${d.length?`Meses por cobrar: ${d.map(x=>fper(x.periodo)).join(", ")}.`:"Al día."}`;
      if(nuevo&&!v(sc,"p-m"))sc.querySelector("#p-m").value=m||""};
    montarCombo(sc,"p-ctr",opsCtr,()=>{if(nuevo)sc.querySelector("#p-per").value=sugerir(v(sc,"p-ctr"));sc.querySelector("#p-m").value="";info()});info();
    sc.querySelector("#ok").onclick=async()=>{
      const contratoId=v(sc,"p-ctr"),periodo=v(sc,"p-per"),monto=num(v(sc,"p-m"));
      if(!contratoId||!periodo||!monto){toast("Completa contrato, período y monto");return}
      const dup=all("pagos").find(x=>x.id!==p.id&&x.contratoId===contratoId&&x.periodo===periodo);
      if(dup&&nuevo){toast(`Ya hay un pago de ${fper(periodo)} para ese contrato (factura ${dup.factura||"sin N°"}). Edítalo en vez de duplicarlo.`,4500);return}
      if(await guardar("pagos",{...p,contratoId,periodo,monto,fecha:v(sc,"p-f"),factura:v(sc,"p-fac"),notas:v(sc,"p-n")},nuevo?"Pago registrado":"Pago actualizado"))cerrarModal();
    };
    const d=sc.querySelector("#del");if(d)d.onclick=()=>confirmar("¿Eliminar este pago?",()=>borrar("pagos",p.id,"Pago eliminado"));
  });
}

// ---------- VENTA ----------
function formVenta(vt,pre={}){
  const nuevo=!vt;vt=vt?JSON.parse(JSON.stringify(vt)):{numero:sigNumero("ventas"),fecha:hoy(),clienteId:pre.clienteId||"",items:[],estado:"ok"};
  if(nuevo&&pre.contenedorId){const k=get("contenedores",pre.contenedorId);vt.items.push({contenedorId:k.id,codigo:k.codigo,precio:precioSugerido(k,"precioVenta")})}
  if(!vt.items.length)vt.items.push({});
  const fila=(it,i)=>`<tr data-fila="${i}"><td><input class="mono it-cod" list="dl-dv" value="${esc(it.codigo||"")}" placeholder="Código"></td><td class="it-tipo small muted">${esc(get("contenedores",it.contenedorId)?.tipo||"")}</td><td><input class="it-pre" inputmode="numeric" value="${esc(it.precio||"")}" placeholder="Precio neto"></td><td><button class="sm" type="button" data-quitar="${i}">✕</button></td></tr>`;
  const sc=modal(nuevo?"Nueva venta":"Venta N° "+vt.numero,`<div class="fg">
    <label>N° venta<input id="v-num" inputmode="numeric" value="${esc(vt.numero)}"></label><label>Fecha *<input id="v-f" type="date" value="${esc(vt.fecha)}"></label>
    <div class="lbl full">Cliente *${combo("v-cli",opsClientes(),vt.clienteId,"Escribe para buscar: nombre, RUT o contacto")}</div>
    <label>N° factura<input id="v-fac" value="${esc(vt.factura)}"></label><label>N° OC<input id="v-oc" value="${esc(vt.oc)}"></label></div>
    <h3 class="sub">Contenedores vendidos</h3>${datalistDisponibles("dl-dv",vt.items.map(i=>i.contenedorId).filter(Boolean))}
    <div class="scroll"><table class="items"><thead><tr><th>Código</th><th>Tipo</th><th>Precio neto</th><th></th></tr></thead><tbody id="v-items">${vt.items.map(fila).join("")}</tbody></table></div>
    <div class="row between"><button class="sm" type="button" id="v-add">+ Agregar contenedor</button><div class="calc" id="v-calc" style="min-width:260px"></div></div>
    <label class="full">Notas<textarea id="v-n">${esc(vt.notas)}</textarea></label>`,
  `${!nuevo&&puedeEditar()?`<button class="danger" id="anu">${vt.estado==="anulada"?"Reactivar venta":"Anular venta"}</button><span style="flex:1"></span>`:""}<button data-close>Cancelar</button>${btnE(`<button class="primary" id="ok">${nuevo?"Registrar venta":"Guardar"}</button>`)}`,null,true);
  montarCombo(sc,"v-cli",opsClientes());
  const body=sc.querySelector("#v-items");
  const leer=()=>[...body.querySelectorAll("tr")].map(tr=>{const cod=tr.querySelector(".it-cod").value.trim();const k=contPorCodigo(cod);return{contenedorId:k?.id||"",codigo:k?.codigo||cod,precio:num(tr.querySelector(".it-pre").value)}});
  const calc=()=>{const n=leer().reduce((s,i)=>s+num(i.precio),0);sc.querySelector("#v-calc").innerHTML=`<span>Neto</span><b>${clp(n)}</b><span>IVA</span><b>${clp(conIVA(n)-n)}</b><span class="tot">Total</span><b class="tot">${clp(conIVA(n))}</b>`};
  body.addEventListener("input",e=>{const tr=e.target.closest("tr");if(e.target.classList.contains("it-cod")){const k=contPorCodigo(e.target.value);tr.querySelector(".it-tipo").textContent=k?k.tipo:"";if(k&&!tr.querySelector(".it-pre").value)tr.querySelector(".it-pre").value=precioSugerido(k,"precioVenta")||""}calc()});
  body.addEventListener("click",e=>{const q=e.target.closest("[data-quitar]");if(q){vt.items=leer();vt.items.splice(+q.dataset.quitar,1);if(!vt.items.length)vt.items.push({});body.innerHTML=vt.items.map(fila).join("");calc()}});
  sc.querySelector("#v-add").onclick=()=>{vt.items=leer();vt.items.push({});body.insertAdjacentHTML("beforeend",fila({},vt.items.length-1))};
  calc();
  const ok=sc.querySelector("#ok");if(ok)ok.onclick=async()=>{
    const clienteId=v(sc,"v-cli");if(!clienteId){toast("Elige el cliente");return}
    const items=leer().filter(i=>i.codigo);for(const it of items){if(!it.contenedorId){toast("No existe el contenedor "+it.codigo);return}
      const e=estadoCont(get("contenedores",it.contenedorId));const ya=ix().venta.get(it.contenedorId);if((e==="arrendado")||(e==="vendido"&&(!ya||ya.id!==vt.id))){toast(it.codigo+" no está disponible ("+e+")");return}}
    if(!items.length){toast("Agrega al menos un contenedor");return}
    const id=await guardar("ventas",{...vt,numero:num(v(sc,"v-num")),fecha:v(sc,"v-f"),clienteId,factura:v(sc,"v-fac"),oc:v(sc,"v-oc"),notas:v(sc,"v-n"),items},nuevo?"Venta registrada":"Venta actualizada");
    if(id){const cl=cliNom(clienteId);await guardarVarios("contenedores",items.map(it=>({...get("contenedores",it.contenedorId),estado:"vendido",vendidoA:cl})));cerrarModal()}
  };
  const an=sc.querySelector("#anu");if(an)an.onclick=()=>{const reac=vt.estado==="anulada";confirmar(reac?"¿Reactivar esta venta? Los contenedores vuelven a quedar vendidos.":"¿Anular esta venta? Los contenedores vuelven a quedar disponibles.",async()=>{
    if(!(await guardar("ventas",{...vt,estado:reac?"ok":"anulada"},reac?"Venta reactivada":"Venta anulada")))return false;
    await guardarVarios("contenedores",(vt.items||[]).map(it=>get("contenedores",it.contenedorId)).filter(Boolean).map(k=>({...k,estado:reac?"vendido":"disponible",vendidoA:reac?cliNom(vt.clienteId):""})));cerrarModal()},reac?"Reactivar":"Anular")};
}

// ---------- TIPO / PROVEEDOR / USUARIO ----------
function formTipo(t){
  const nuevo=!t?.id;t=t||{};
  modal(nuevo?"Tipo de contenedor":"Editar "+t.nombre,`<div class="fg"><label>Nombre *<input id="y-n" value="${esc(t.nombre)}"></label><label>Prefijo de código *<input id="y-p" class="mono" value="${esc(t.prefijo)}" placeholder="OFI"></label>
   <label>Arriendo mensual sugerido<input id="y-m" inputmode="numeric" value="${esc(t.precioMes||"")}"></label><label>Precio venta sugerido<input id="y-v" inputmode="numeric" value="${esc(t.precioVenta||"")}"></label></div>`,
  `<button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>`,sc=>{
    sc.querySelector("#ok").onclick=async()=>{const nombre=v(sc,"y-n"),prefijo=v(sc,"y-p").toUpperCase();if(!nombre||!prefijo){toast("Completa nombre y prefijo");return}
      if(!all("tipos").length){await guardarVarios("tipos",tipos().filter(x=>x.nombre!==t.nombre).map(x=>({...x,id:nuevoId()})))}
      if(await guardar("tipos",{...t,id:t.id||nuevoId(),nombre,prefijo,precioMes:num(v(sc,"y-m")),precioVenta:num(v(sc,"y-v"))},"Tipo guardado")){
        if(t.nombre&&t.nombre!==nombre){const cs=all("contenedores").filter(c=>c.tipo===t.nombre);if(cs.length)await guardarVarios("contenedores",cs.map(c=>({...c,tipo:nombre})))}
        cerrarModal()}};
  });
}
function formProveedor(p){
  const nuevo=!p;p=p||{};
  modal(nuevo?"Nuevo proveedor":"Editar proveedor",`<div class="fg"><label class="full">Nombre *<input id="r-n" value="${esc(p.nombre)}"></label><label>RUT<input id="r-r" value="${esc(p.rut)}"></label><label>Contacto<input id="r-c" value="${esc(p.contacto)}"></label>
   <label>Teléfono<input id="r-t" value="${esc(p.telefono)}"></label><label>Email<input id="r-e" value="${esc(p.email)}"></label><label class="full">Notas<textarea id="r-o">${esc(p.notas)}</textarea></label></div>`,
  `${!nuevo&&esAdmin()?`<button class="danger" id="del">Eliminar</button><span style="flex:1"></span>`:""}<button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>`,sc=>{
    sc.querySelector("#ok").onclick=async()=>{const nombre=v(sc,"r-n");if(!nombre){toast("Falta el nombre");return}if(await guardar("proveedores",{...p,nombre,rut:v(sc,"r-r"),contacto:v(sc,"r-c"),telefono:v(sc,"r-t"),email:v(sc,"r-e"),notas:v(sc,"r-o")},"Proveedor guardado"))cerrarModal()};
    const d=sc.querySelector("#del");if(d)d.onclick=()=>confirmar("¿Eliminar este proveedor?",()=>borrar("proveedores",p.id,"Proveedor eliminado"));
  });
}
function formUsuario(u){
  const nuevo=!u;u=u||{rol:"editor",activo:true};
  modal(nuevo?"Agregar usuario":"Editar usuario",`<div class="fg"><label class="full">Correo *<input id="u-e" type="email" value="${esc(u.id||"")}" ${nuevo?"":"disabled"}></label><label>Nombre<input id="u-n" value="${esc(u.nombre)}"></label>
   <label>Perfil<select id="u-r">${Object.entries(ROLES).map(([k,l])=>`<option value="${k}" ${u.rol===k?"selected":""}>${l}</option>`).join("")}</select></label>
   <label class="full" style="flex-direction:row;align-items:center;gap:8px"><input type="checkbox" id="u-a" style="width:auto" ${u.activo!==false?"checked":""}> Acceso activo</label></div>
   <p class="small muted" style="margin:0">Administrador: todo, incluido usuarios. Editor: registra y edita. Solo lectura: puede ver pero no cambiar nada.</p>`,
  `${!nuevo?`<button class="danger" id="del">Quitar acceso</button><span style="flex:1"></span>`:""}<button data-close>Cancelar</button><button class="primary" id="ok">Guardar</button>`,sc=>{
    sc.querySelector("#ok").onclick=async()=>{const id=(u.id||v(sc,"u-e")).toLowerCase();if(!/^\S+@\S+\.\S+$/.test(id)){toast("Escribe un correo válido");return}
      if(await guardar("perfiles",{...u,id,nombre:v(sc,"u-n"),rol:v(sc,"u-r"),activo:v(sc,"u-a")},nuevo?"Usuario agregado. Ahora puede entrar con “Crear mi cuenta”.":"Usuario actualizado")){cerrarModal()}};
    const d=sc.querySelector("#del");if(d)d.onclick=()=>confirmar(`¿Quitar el acceso de ${u.id}?`,()=>borrar("perfiles",u.id,"Acceso quitado"),"Quitar acceso");
  });
}

// ---------- rutas y render ----------
const RUTAS={inicio:vInicio,contratos:vContratos,contrato:vContrato,contenedores:vContenedores,clientes:vClientes,cliente:vCliente,ventas:vVentas,pagos:vPagos,mas:vMas};
function ruta(){const h=decodeURIComponent(location.hash.slice(1));const [r,id]=h.split("/");return RUTAS[r]?{r,id}:{r:"inicio"}}
function render(){
  if(!S.user||!S.listo)return;
  const {r,id}=ruta();const nav=r==="contrato"?"contratos":r==="cliente"?"clientes":r;
  document.querySelectorAll("#nav a").forEach(a=>a.setAttribute("aria-current",a.getAttribute("href")==="#"+nav?"page":"false"));
  const act=document.activeElement,aid=act&&act.id,pos=act&&act.selectionStart;
  const y=window.scrollY;
  $("#app").innerHTML=(S.importando?`<div class="note"><span>Importando datos… ${S.importando.hechos} de ${S.importando.total}. No cierres esta página.</span></div>`:"")
    +(S.stale?`<div class="note">Sin conexión con la base de datos: lo que ves puede no estar actualizado.</div>`:"")
    +(!all("contenedores").length&&esAdmin()&&!S.importando?`<div class="note"><span>La base de datos está vacía. Carga un respaldo o la migración desde el sistema anterior.</span><label class="btn sm primary" style="cursor:pointer">Elegir archivo…<input type="file" id="rest-file" accept=".json,application/json" hidden></label></div>`:"")
    +RUTAS[r](id);
  if(aid){const el=document.getElementById(aid);if(el&&el.tagName==="INPUT"){el.focus();try{el.setSelectionRange(pos,pos)}catch(e){}}}
  window.scrollTo(0,y);
}
window.addEventListener("hashchange",()=>{cerrarModal();S.lim={};render();window.scrollTo(0,0)});

// ---------- eventos ----------
document.addEventListener("click",e=>{
  if(e.target.closest("#modal-root")&&!e.target.closest("[data-cont],[data-pagar]"))return;
  const t=e.target.closest("button,tr.clic,[data-cont],[data-chip]");if(!t)return;const d=t.dataset;
  if(t.tagName==="TR"&&e.target.closest("a,button,input"))return;
  if(d.href){location.hash=d.href;return}
  if(d.cont){cerrarModal();verContenedor(d.cont);return}
  if(d.chip){if(d.chip==="ctr")S.f.ctr.estado=d.val;if(d.chip==="cont")S.f.cont.estado=d.val;if(d.chip==="mas")S.f.mas=d.val;S.lim={};render();return}
  if(d.mas){S.lim[d.mas]=(S.lim[d.mas]||100)+100;render();return}
  if(d.filtroTipo){S.f.cont={estado:"activos",tipo:d.filtroTipo,q:""};location.hash="#contenedores";return}
  if(d.venta){formVenta(get("ventas",d.venta));return}
  if(d.pagar){cerrarModal();formPago(null,{contratoId:d.pagar,periodo:d.per});return}
  if(d.pagoEdit){formPago(get("pagos",d.pagoEdit));return}
  if(d.editarCtr){formContrato(get("contratos",d.editarCtr));return}
  if(d.agregarItem){const c=get("contratos",d.agregarItem);formContrato(c);return}
  if(d.itemEdit){const [cid,i]=d.itemEdit.split("|");formItem(get("contratos",cid),+i);return}
  if(d.devolver){const [cid,i]=d.devolver.split("|");formDevolucion(get("contratos",cid),+i);return}
  if(d.cerrarCtr){formCerrar(get("contratos",d.cerrarCtr));return}
  if(d.anularCtr){const c=get("contratos",d.anularCtr);confirmar(`¿Anular el contrato N° ${c.numero}? Sus contenedores quedan disponibles y no se cobrará.`,async()=>!!(await guardar("contratos",{...c,estado:"anulado"},"Contrato anulado")),"Anular");return}
  if(d.reabrirCtr){const c=get("contratos",d.reabrirCtr);confirmar(`¿Reabrir el contrato N° ${c.numero}?`,async()=>!!(await guardar("contratos",{...c,estado:"vigente",cierre:""},"Contrato reabierto")),"Reabrir");return}
  if(d.borrarCtr){const c=get("contratos",d.borrarCtr);confirmar(`¿Eliminar definitivamente el contrato N° ${c.numero} y sus pagos? Esto no se puede deshacer.`,async()=>{const ps=ix().pagos.get(c.id)||[];for(const p of ps)await borrar("pagos",p.id);const ok=await borrar("contratos",c.id,"Contrato eliminado");if(ok)location.hash="#contratos";return ok});return}
  if(d.editarCli){formCliente(get("clientes",d.editarCli));return}
  if(d.borrarCli){const c=get("clientes",d.borrarCli);const n=(ix().cliCtr.get(c.id)||[]).length;if(n){toast(`No se puede eliminar: tiene ${n} contratos. Puedes editar sus datos.`,4000);return}confirmar(`¿Eliminar a ${c.nombre}?`,async()=>{const ok=await borrar("clientes",c.id,"Cliente eliminado");if(ok)location.hash="#clientes";return ok});return}
  if(d.tipoEdit){const id=d.tipoEdit;formTipo(id.startsWith("nuevo:")?tipos().find(t=>t.nombre===id.slice(6)):get("tipos",id));return}
  if(d.provEdit){formProveedor(get("proveedores",d.provEdit));return}
  if(d.userEdit){formUsuario(get("perfiles",d.userEdit));return}
  if(d.imprimir!==undefined){window.print();return}
  const a=d.accion;if(!a)return;
  if(a==="nuevo-contrato")formContrato(null,{clienteId:d.cli});
  if(a==="nueva-venta")formVenta();
  if(a==="nuevo-pago")formPago();
  if(a==="nuevo-cont")formContenedor();
  if(a==="nuevo-cli")formCliente();
  if(a==="nuevo-tipo")formTipo();
  if(a==="nuevo-prov")formProveedor();
  if(a==="nuevo-usuario")formUsuario();
  if(a==="respaldo")respaldo();
  if(a==="csv-cont")exportar("contenedores");if(a==="csv-cli")exportar("clientes");if(a==="csv-ven")exportar("ventas");if(a==="csv-pag")exportar("pagos");
});
const buscar=debounce((id,val)=>{const m={"q-ctr":["ctr","q"],"q-cont":["cont","q"],"q-cli":["cli","q"],"q-ven":["ven","q"],"q-pag":["pag","q"]}[id];if(m){S.f[m[0]][m[1]]=val;S.lim={};render()}},180);
document.addEventListener("input",e=>{if(e.target.classList.contains("buscar"))buscar(e.target.id,e.target.value)});
document.addEventListener("change",e=>{
  if(e.target.id==="f-tipo-cont"){S.f.cont.tipo=e.target.value;S.lim={};render()}
  if(e.target.id==="f-mes"){S.f.pag.mes=e.target.value;render()}
  if(e.target.id==="rest-file")leerArchivo(e.target);
});

// ---------- exportar / respaldo / importar ----------
function exportar(t){
  let filas=[];
  if(t==="contenedores")filas=[["Código","Tipo","Dimensión","Característica","Estado","Cliente","Contrato","Obra/Ubicación","Tarifa/mes","Precio venta"],...all("contenedores").map(c=>{const a=ix().activo.get(c.id);return[c.codigo,c.tipo,c.dimension,c.caracteristica,estadoCont(c),a?cliNom(a.ctr.clienteId):c.vendidoA||"",a?a.ctr.numero:"",a?a.ctr.obra:c.ubicacion,a?a.item.tarifa:c.precioMes,c.precioVenta]})];
  if(t==="clientes")filas=[["Nombre","RUT","Giro","Contacto","Teléfono","Email","Dirección"],...all("clientes").map(c=>[c.nombre,c.rut,c.giro,c.contacto,c.telefono,c.email,c.direccion])];
  if(t==="ventas")filas=[["N°","Fecha","Cliente","Factura","Contenedor","Precio neto","Estado"],...all("ventas").flatMap(x=>(x.items||[]).map(i=>[x.numero,x.fecha,cliNom(x.clienteId),x.factura,i.codigo,i.precio,x.estado||"ok"]))];
  if(t==="pagos")filas=[["Contrato","Cliente","Período","Fecha pago","Factura","Monto"],...all("pagos").sort((a,b)=>(a.periodo||"").localeCompare(b.periodo||"")).map(p=>{const c=get("contratos",p.contratoId);return[c?.numero,cliNom(c?.clienteId),p.periodo,p.fecha,p.factura,p.monto]})];
  descargar(`${t}-dima-${hoy()}.csv`,csv(filas),"text/csv");
}
function respaldo(){
  const tablas=Object.fromEntries(TABLAS.filter(t=>t!=="perfiles").map(t=>[t,all(t)]));
  descargar(`respaldo-dima-${hoy()}.json`,JSON.stringify({version:2,fecha:new Date().toISOString(),tablas}),"application/json");
  toast("Respaldo descargado");
}
async function leerArchivo(input){
  const f=input.files&&input.files[0];if(!f)return;input.value="";
  let o;try{o=JSON.parse(await f.text())}catch(e){toast("El archivo no es un respaldo válido.");return}
  let tablas=o.tablas;
  if(!tablas&&Array.isArray(o)){tablas={};o.forEach(x=>{if(x.c&&x.id){(tablas[x.c]=tablas[x.c]||[]).push({...x.d,id:x.id})}})}
  if(!tablas&&o.contenedores)tablas={contenedores:o.contenedores,clientes:o.clientes||[]};
  if(!tablas){toast("El archivo no tiene datos de la plataforma.");return}
  const ok=Object.keys(tablas).filter(t=>TABLAS.includes(t)&&t!=="perfiles"&&tablas[t]?.length);
  const resumen=ok.map(t=>`${tablas[t].length} ${t}`).join(", ");
  confirmar(`Se van a cargar: ${resumen}. Los registros con el mismo identificador se reemplazan.`,async()=>{cerrarModal();await importar(ok.map(t=>[t,tablas[t]]));},"Cargar datos");
}
async function importar(pares){
  const total=pares.reduce((s,[,rows])=>s+rows.length,0);S.importando={hechos:0,total};render();let fallos=0;
  for(const [t,rows] of pares){
    for(let i=0;i<rows.length;i+=200){
      const lote=rows.slice(i,i+200).map(r=>({id:String(r.id),data:limpiar(r)}));
      let ok=false;for(let k=0;k<4&&!ok;k++){const {error}=await sb.from(t).upsert(lote);if(!error)ok=true;else await new Promise(r=>setTimeout(r,800*(k+1)))}
      if(ok)lote.forEach(r=>S.d[t].set(r.id,{...r.data,id:r.id}));else fallos+=lote.length;
      S.importando.hechos+=lote.length;S.ver++;render();
    }
  }
  S.importando=null;cambio();
  toast(fallos?`Carga terminada con ${fallos} registros sin guardar. Vuelve a intentarlo.`:`Carga terminada: ${total} registros.`,5000);
}

// ---------- acceso ----------
function pantalla(html){$("#nav").hidden=true;$("#userbox").hidden=true;$("#app").innerHTML=`<div class="login panel"><div class="pb">${html}</div></div>`}
function pantallaLogin(msg,ok){
  pantalla(`<h1>Ingresar</h1><p class="muted" style="margin:0">Plataforma de control de contenedores Dima Express.</p>
    <form id="f-login" class="fg" style="grid-template-columns:1fr">
      <label>Correo<input id="l-email" type="email" autocomplete="username" required></label>
      <label>Contraseña<input id="l-pass" type="password" autocomplete="current-password" required></label>
      <p id="l-msg" class="small" style="margin:0;color:var(${ok?"--ok":"--bad"})">${esc(msg||"")}</p>
      <button class="primary" type="submit" id="l-btn">Entrar</button>
    </form>
    <div class="row between small"><button class="link" type="button" id="l-crear">¿Primera vez? Crear mi cuenta</button><button class="link" type="button" id="l-reset">Olvidé mi contraseña</button></div>`);
  $("#f-login").addEventListener("submit",async e=>{e.preventDefault();$("#l-btn").disabled=true;$("#l-msg").textContent="";
    const {error}=await sb.auth.signInWithPassword({email:$("#l-email").value.trim().toLowerCase(),password:$("#l-pass").value});
    if(error){$("#l-btn").disabled=false;$("#l-msg").style.color="var(--bad)";$("#l-msg").textContent=/invalid/i.test(error.message)?"Correo o contraseña incorrectos.":/rate|many/i.test(error.message)?"Demasiados intentos. Espera unos minutos.":/confirm/i.test(error.message)?"Tu correo aún no está confirmado.":"No se pudo ingresar: "+error.message}});
  $("#l-crear").onclick=pantallaCrear;
  $("#l-reset").onclick=async()=>{const em=$("#l-email").value.trim();if(!em){$("#l-msg").textContent="Escribe tu correo y vuelve a presionar.";return}
    const {error}=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.origin+location.pathname});
    $("#l-msg").style.color=error?"var(--bad)":"var(--ok)";$("#l-msg").textContent=error?(/rate/i.test(error.message)?"Se alcanzó el límite de correos por hora. Pide al administrador que te ayude o intenta más tarde.":"No se pudo enviar el correo."):"Te enviamos un correo para crear una nueva contraseña."};
}
function pantallaCrear(){
  pantalla(`<h1>Crear mi cuenta</h1><p class="muted" style="margin:0">Solo funciona si el administrador ya agregó tu correo en Configuración › Usuarios.</p>
    <form id="f-crear" class="fg" style="grid-template-columns:1fr">
      <label>Correo<input id="s-email" type="email" autocomplete="username" required></label>
      <label>Contraseña (mínimo 8 caracteres)<input id="s-p1" type="password" autocomplete="new-password" minlength="8" required></label>
      <label>Repite la contraseña<input id="s-p2" type="password" autocomplete="new-password" minlength="8" required></label>
      <p id="s-msg" class="small" style="margin:0;color:var(--bad)"></p>
      <button class="primary" type="submit" id="s-btn">Crear cuenta</button></form>
    <button class="link small" type="button" id="s-volver">← Volver a ingresar</button>`);
  $("#s-volver").onclick=()=>pantallaLogin();
  $("#f-crear").addEventListener("submit",async e=>{e.preventDefault();
    if($("#s-p1").value!==$("#s-p2").value){$("#s-msg").textContent="Las contraseñas no coinciden.";return}
    $("#s-btn").disabled=true;
    const {data,error}=await sb.auth.signUp({email:$("#s-email").value.trim().toLowerCase(),password:$("#s-p1").value});
    if(error){$("#s-btn").disabled=false;$("#s-msg").textContent=/autorizado|not authorized|Database error/i.test(error.message)?"Este correo no está autorizado. Pide al administrador que te agregue en Configuración › Usuarios.":/registered|exists/i.test(error.message)?"Este correo ya tiene cuenta. Vuelve e ingresa con tu contraseña.":"No se pudo crear la cuenta: "+error.message;return}
    if(!data.session)pantallaLogin("Cuenta creada. Ya puedes ingresar.",true);
  });
}
function pantallaNuevaClave(){
  pantalla(`<h1>${TIPO_LINK==="invite"?"Bienvenido: crea tu contraseña":"Nueva contraseña"}</h1>
    <form id="f-np" class="fg" style="grid-template-columns:1fr">
      <label>Nueva contraseña (mínimo 8 caracteres)<input id="np-1" type="password" autocomplete="new-password" minlength="8" required></label>
      <label>Repite la contraseña<input id="np-2" type="password" autocomplete="new-password" minlength="8" required></label>
      <p id="np-msg" class="small" style="margin:0;color:var(--bad)"></p>
      <button class="primary" type="submit">Guardar contraseña</button></form>`);
  $("#f-np").addEventListener("submit",async e=>{e.preventDefault();
    if($("#np-1").value!==$("#np-2").value){$("#np-msg").textContent="Las contraseñas no coinciden.";return}
    const {error}=await sb.auth.updateUser({password:$("#np-1").value});
    if(error){$("#np-msg").textContent="No se pudo guardar. El enlace puede haber vencido: pide otro."}else{location.hash="";location.reload()}});
}
function cambiarClave(){
  modal("Cambiar contraseña",`<div class="fg" style="grid-template-columns:1fr"><label>Nueva contraseña (mínimo 8 caracteres)<input id="cc-1" type="password" autocomplete="new-password" minlength="8"></label><label>Repite la contraseña<input id="cc-2" type="password" autocomplete="new-password" minlength="8"></label></div>`,
  `<button data-close>Cancelar</button><button class="primary" id="ok">Guardar contraseña</button>`,sc=>{
    sc.querySelector("#ok").onclick=async()=>{const a=v(sc,"cc-1"),b=v(sc,"cc-2");if(a.length<8){toast("Mínimo 8 caracteres");return}if(a!==b){toast("Las contraseñas no coinciden");return}
      const {error}=await sb.auth.updateUser({password:a});if(error)toast("No se pudo cambiar: "+error.message);else{cerrarModal();toast("Contraseña actualizada")}};
  });
}
let iniciado=false,recuperando=false;
async function entrar(u){
  if(iniciado||recuperando)return;iniciado=true;S.user={email:(u.email||"").toLowerCase()};
  $("#app").innerHTML=`<div class="empty"><b>Cargando datos…</b></div>`;
  const timer=setTimeout(()=>{S.stale=true;render()},12000);
  try{await Promise.all(TABLAS.map(cargarTabla))}catch(e){clearTimeout(timer);$("#app").innerHTML=`<div class="empty"><b>No se pudo cargar la información</b>${esc(e.message||"")}. Revisa tu conexión y recarga la página.</div>`;return}
  clearTimeout(timer);S.stale=false;
  const perfil=get("perfiles",S.user.email);
  if(!perfil||perfil.activo===false){pantalla(`<h1>Sin acceso</h1><p style="margin:0">El correo <b>${esc(S.user.email)}</b> no tiene acceso a la plataforma. Pide al administrador que te agregue en Configuración › Usuarios.</p><button id="x-out">Salir</button>`);$("#x-out").onclick=async()=>{await sb.auth.signOut();location.reload()};return}
  S.rol=perfil.rol||"lectura";S.listo=true;
  $("#nav").hidden=false;$("#userbox").hidden=false;$("#useremail").textContent=(perfil.nombre||S.user.email)+" · "+(ROLES[S.rol]||"");
  $("#logout").onclick=async()=>{await sb.auth.signOut();location.reload()};
  $("#cambiar-clave").onclick=cambiarClave;
  escuchar();render();
}
sb.auth.onAuthStateChange((ev,ses)=>{
  if(ev==="PASSWORD_RECOVERY"){recuperando=true;pantallaNuevaClave();return}
  if(ses&&ses.user&&(TIPO_LINK==="invite"||TIPO_LINK==="recovery")&&!recuperando){recuperando=true;pantallaNuevaClave();return}
  if(ses&&ses.user){setTimeout(()=>entrar(ses.user),0)}
  else if(ev==="SIGNED_OUT"||ev==="INITIAL_SESSION"){if(!iniciado&&!recuperando)pantallaLogin(ERR_LINK?"Ese enlace ya se usó o venció. Escribe tu correo y presiona «Olvidé mi contraseña».":"")}
});
