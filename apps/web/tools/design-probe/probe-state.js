// Sonda 2 — contraste de ESTADO (WCAG 2.1 SC 1.4.11, AA, 3:1).
//
// La sonda de accesibilidad mide texto-contra-fondo: responde "¿se lee?". Esta
// responde "¿se ve cuál está seleccionado?". Son preguntas distintas y la
// primera puede pasar con 15:1 mientras la segunda falla con 1.05:1 — que es lo
// que pasaba con el selector de período, presente en todas las pantallas.
(()=>{
const lin=(c)=>{c/=255;return c<=.03928?c/12.92:Math.pow((c+.055)/1.055,2.4)};
const L=(p)=>.2126*lin(p[0])+.7152*lin(p[1])+.0722*lin(p[2]);
const cr=(a,b)=>{const x=L(a),y=L(b),h=Math.max(x,y),l=Math.min(x,y);return Math.round((h+.05)/(l+.05)*100)/100};
const N=(s)=>(String(s).match(/[0-9.]+/g)||['0','0','0','1']).map(Number);
const de=document.documentElement;
const page=N(getComputedStyle(document.body).backgroundColor);
const solid=(el)=>{let n=el;while(n&&n!==de){const v=N(getComputedStyle(n).backgroundColor);
  if(v.length<4||v[3]>0.5)return v;n=n.parentElement}return page};
const tag=(el)=>el.tagName.toLowerCase()+((typeof el.className==='string'&&el.className.trim())
  ?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'');
const GROUPS=[
 {sel:'[aria-pressed]', on:(el)=>el.getAttribute('aria-pressed')==='true', name:'aria-pressed'},
 {sel:'[aria-selected]',on:(el)=>el.getAttribute('aria-selected')==='true',name:'aria-selected'},
 {sel:'[aria-current]', on:(el)=>{const v=el.getAttribute('aria-current');return v&&v!=='false'},name:'aria-current'},
];
const out=[];
for(const g of GROUPS){
  const els=[...document.querySelectorAll(g.sel)].filter(el=>{const r=el.getBoundingClientRect();return r.width>1&&r.height>1});
  const byParent=new Map();
  for(const el of els){const k=el.parentElement;if(!byParent.has(k))byParent.set(k,[]);byParent.get(k).push(el)}
  for(const [parent,list] of byParent){
    const ons=list.filter(g.on),offs=list.filter(el=>!g.on(el));
    if(!ons.length||!offs.length)continue;
    const a=ons[0],b=offs[0],ca=getComputedStyle(a),cb=getComputedStyle(b);
    const fill=cr(solid(a),solid(b));
    const text=cr(N(ca.color),N(cb.color));
    const hasBd=ca.borderTopWidth!=='0px'&&ca.borderTopStyle!=='none';
    const bd=hasBd?cr(N(ca.borderTopColor),N(cb.borderTopColor)):0;
    // Una señal NO cromática (peso, subrayado, grosor) también identifica el
    // estado y satisface el criterio: no todo tiene que resolverse con color.
    const shape=(Number(ca.fontWeight)!==Number(cb.fontWeight))
      ||(ca.textDecorationLine!==cb.textDecorationLine)
      ||(ca.borderTopWidth!==cb.borderTopWidth)
      ||(ca.outlineWidth!==cb.outlineWidth);
    const best=Math.max(fill,text,bd);
    if(best<3&&!shape)out.push({grupo:g.name,padre:tag(parent),
      activo:(a.innerText||'').trim().slice(0,12),inactivo:(b.innerText||'').trim().slice(0,12),
      relleno:fill,texto:text,borde:bd||null,mejor:best,n:list.length})}}
return {estadosIndistinguibles:out.length, detalle:out.slice(0,10)}})()
