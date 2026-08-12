// Sonda para el grupo P2: dominancia tipográfica, padding de cards hermanas,
// línea base dentro de filas repetidas, y convención del vacío.
(()=>{
const o={};
const vis=(el)=>{const c=getComputedStyle(el);if(c.display==='none'||c.visibility==='hidden')return null;
  const r=el.getBoundingClientRect();if(r.width<1||r.height<1)return null;return c};
const own=(el)=>{let t='';for(const n of el.childNodes)if(n.nodeType===3)t+=n.textContent;return t.trim()};
// 1) ¿qué tamaño DOMINA la pantalla? (M-06, M-05, T-13)
const fs={};
for(const el of document.querySelectorAll('body *')){
  const c=vis(el);if(!c||el.closest('.sr-only'))continue;
  const t=own(el); if(t.length<2)continue;
  const k=Math.round(parseFloat(c.fontSize));
  fs[k]=(fs[k]||0)+1}
const tot=Object.values(fs).reduce((a,b)=>a+b,0);
o.tamanos=Object.entries(fs).sort((a,b)=>b[1]-a[1]).slice(0,6)
  .map(([k,v])=>k+'px:'+Math.round(v/tot*100)+'%');
o.dominante=Object.entries(fs).sort((a,b)=>b[1]-a[1])[0][0]+'px';
// 2) padding de cards hermanas (A-05, S-15, SET-A1)
const pads={};
for(const el of document.querySelectorAll('.card')){
  const c=vis(el);if(!c)continue;
  const bd=el.querySelector('.card-bd')||el;
  const cb=getComputedStyle(bd);
  const k=cb.paddingTop+'/'+cb.paddingLeft;
  pads[k]=(pads[k]||0)+1}
o.paddingsDeCard=Object.entries(pads).sort((a,b)=>b[1]-a[1]).map(([k,v])=>k+' x'+v);
o.paddingsDistintos=Object.keys(pads).length;
// 3) línea base dentro de filas repetidas (A-04)
const rows=[];
for(const cont of document.querySelectorAll('body *')){
  const kids=[...cont.children];
  if(kids.length<4||new Set(kids.map(k=>k.tagName)).size>1)continue;
  const k0=kids[0]; const spans=[...k0.querySelectorAll('*')].filter(e=>{const c=vis(e);return c&&own(e).length>0});
  if(spans.length<2)continue;
  // línea base ≈ top + ascender; se aproxima con el bottom del texto
  const bs=[...new Set(spans.map(e=>{const r=e.getBoundingClientRect();
    const c=getComputedStyle(e);const fs2=parseFloat(c.fontSize);
    return Math.round(r.top + (r.height + fs2*0.72)/2)}))];
  if(bs.length>1){const spread=Math.max(...bs)-Math.min(...bs);
    if(spread>=3)rows.push({el:cont.tagName.toLowerCase()+'.'+String(cont.className).split(' ')[0],
      lineasBase:bs.length, desfase:spread})}}
o.filasSinLineaBase=rows.length; o.filasDetalle=rows.slice(0,5);
// 4) convención del vacío: ¿conviven "0" y "—" como "sin dato"? (ALERT-15, SET-S6)
const zeros=[...document.querySelectorAll('body *')].filter(e=>{const c=vis(e);return c&&own(e)==='0'}).length;
const dashes=[...document.querySelectorAll('body *')].filter(e=>{const c=vis(e);const t=own(e);return c&&(t==='—'||t==='–')}).length;
o.vacio={ceros:zeros, rayas:dashes, ambos:zeros>0&&dashes>0};
return o})()
