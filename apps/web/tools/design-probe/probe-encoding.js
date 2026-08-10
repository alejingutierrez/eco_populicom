// Sonda 4 — ¿la longitud de la barra es proporcional al número que tiene al lado?
//
// La clase que ninguna sonda de tokens ve: un ancho puede estar 100% en tokens y
// no codificar nada. Nueve filas con 21 y con 106 menciones midiendo los mismos
// 411.7px cumplen todas las reglas del sistema de diseño.
//
// Tres trampas que hubo que corregir, y por las que el número anterior mentía:
//  1. Elegir el candidato MÁS ANCHO mide la PISTA, que es constante por diseño.
//     Hay que quedarse con el relleno INTERIOR.
//  2. Sin exigir proporción >=3:1 y ancho >=12px, agarra los puntos de 8px.
//  3. Con varias cifras por fila puede tomar la equivocada. Esas lecturas salen
//     INESTABLES entre viewports, y esa inestabilidad es la señal de artefacto.
(()=>{
const tag=(el)=>el.tagName.toLowerCase()+((typeof el.className==='string'&&el.className.trim())
  ?'.'+el.className.trim().split(/\s+/).slice(0,2).join('.'):'');
const numOf=(s)=>{const m=String(s).replace(/ /g,' ').match(/-?[\d][\d.,]*/);if(!m)return null;
  let t=m[0];
  // 1,234 son miles en es-PR; 1.5 es decimal. Lo decide el largo del grupo.
  if(/,\d{3}(\D|$)/.test(t))t=t.replace(/,/g,'');else t=t.replace(',','.');
  const v=parseFloat(t);return Number.isFinite(v)?v:null};
const pearson=(x,y)=>{const n=x.length;if(n<3)return null;
  const mx=x.reduce((a,b)=>a+b,0)/n,my=y.reduce((a,b)=>a+b,0)/n;
  let sxy=0,sxx=0,syy=0;
  for(let i=0;i<n;i++){const dx=x[i]-mx,dy=y[i]-my;sxy+=dx*dy;sxx+=dx*dx;syy+=dy*dy}
  if(sxx===0||syy===0)return {r:null};
  return {r:Math.round(sxy/Math.sqrt(sxx*syy)*1000)/1000}};
const out=[];const seen=new Set();
for(const cont of document.querySelectorAll('body *')){
  const kids=[...cont.children];
  if(kids.length<4)continue;
  if(new Set(kids.map(k=>k.tagName)).size>1)continue;   // filas homogéneas
  const key=tag(cont)+':'+kids.length;
  if(seen.has(key))continue;seen.add(key);
  const rows=[];
  for(const k of kids){
    const r=k.getBoundingClientRect();if(r.width<40||r.height<4)continue;
    // Una fila con VARIAS cifras no dice cuál codifica la barra: leer la primera
    // producía pares absurdos (un delta contra el ancho de otra cosa). Si hay
    // ambigüedad, la fila no se mide.
    const nums=(String(k.innerText||'').match(/-?[\d][\d.,]*/g)||[]);
    if(nums.length!==1)continue;
    const v=numOf(k.innerText||'');if(v===null)continue;
    let bar=null,bw=0,trackW=0;
    for(const d of k.querySelectorAll('*')){
      const dc=getComputedStyle(d),dr=d.getBoundingClientRect();
      if(!dc.backgroundColor||dc.backgroundColor==='rgba(0, 0, 0, 0)')continue;
      if(dr.height>=r.height*0.8)continue;
      if(dr.height<3||dr.height>26)continue;
      if(dr.width<12)continue;
      if(dr.width/dr.height<3)continue;
      const par=d.parentElement;if(!par)continue;
      const pr=par.getBoundingClientRect();
      if(!(pr.width>dr.width+1&&pr.height<=dr.height*1.8))continue;  // el padre es la pista
      // Si la pista tiene VARIOS hijos rellenos es una barra APILADA: sus
      // segmentos codifican composición (suman 100%), no magnitud, así que
      // medir su proporcionalidad contra el volumen de la fila es la vara
      // equivocada — y elegir el segmento más ancho da lecturas erráticas
      // según qué sentimiento domine. Se descarta: la pregunta de si dos cards
      // usan el mismo dibujo con significados distintos no la contesta esta
      // sonda, la contesta leer el código.
      let rellenos=0;
      for(const sib of par.children){const sc=getComputedStyle(sib);
        if(sc.backgroundColor&&sc.backgroundColor!=='rgba(0, 0, 0, 0)')rellenos++}
      if(rellenos>1)continue;
      if(!bar||bar.contains(d)){bar=d;bw=dr.width;trackW=pr.width}}
    if(!bar)continue;
    rows.push({v,w:Math.round(bw*10)/10,frac:trackW>0?bw/trackW:null})}
  if(rows.length<4)continue;
  const st=pearson(rows.map(r=>r.v),rows.map(r=>r.w));if(!st)continue;
  const vs=rows.map(r=>r.v),ws=rows.map(r=>r.w);
  const spanV=Math.max(...vs)/Math.max(Math.min(...vs),0.0001);
  const spanW=Math.max(...ws)/Math.max(Math.min(...ws),0.0001);
  const fracs=rows.map(r=>r.frac).filter(x=>x!=null);
  const maxFrac=fracs.length?Math.max(...fracs):null;
  const decorativa=spanV>=1.5&&spanW<=1.05;
  const invertida=st.r!==null&&st.r<=-0.5;
  // Dominio mal elegido: si la barra más larga usa menos de la mitad de su
  // pista, el resto está siempre vacío y las diferencias se comprimen. Pasa
  // cuando el ancho es cuota del TOTAL en vez de proporción del MÁXIMO.
  const dominioCorto=maxFrac!=null&&maxFrac<0.5&&spanV>=1.5;
  if(decorativa||invertida||dominioCorto)out.push({el:tag(cont),filas:rows.length,r:st.r,
    rangoDato:Math.round(spanV*100)/100,rangoAncho:Math.round(spanW*100)/100,
    usoMaxDePista:maxFrac!=null?Math.round(maxFrac*100)+'%':null,
    diagnostico:decorativa?'DECORATIVA: el dato varía y el ancho no'
      :invertida?'INVERTIDA: el ancho baja cuando el dato sube'
      :'DOMINIO CORTO: la más larga usa menos de media pista',
    muestra:rows.slice(0,5)})}
return {barrasSospechosas:out.length, detalle:out.slice(0,8)}})()
