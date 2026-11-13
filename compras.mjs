import {createHmac, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const catalog = [
  {name:'Órbita terracota', price:18000, file:'orbita'},
  {name:'Ritmo cobalto', price:21000, file:'ritmo'},
  {name:'Sol de arcilla', price:19000, file:'sol'}
];

function signature(payload) {
  return createHmac('sha256',process.env.MEMBER_SECRET || process.env.RESEND_API_KEY).update('pliego/member/'+payload).digest('base64url');
}
export function membership(req) {
  const token = /(?:^|; )pliego=([^;]+)/.exec(req.headers.cookie || '')?.[1];
  if (!token || !(process.env.MEMBER_SECRET || process.env.RESEND_API_KEY)) return null;
  const [data,mac] = token.split('.');
  const expected = signature(data);
  if (!mac || !/^[A-Za-z0-9_-]{43}$/.test(mac) || !timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  const record = JSON.parse(Buffer.from(data,'base64url').toString());
  return record.until > Date.now() ? record.email : null;
}
export function setMember(res,email) {
  const data = Buffer.from(JSON.stringify({email,until:Date.now()+365*86400000})).toString('base64url');
  res.setHeader('Set-Cookie','pliego='+data+'.'+signature(data)+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=31536000');
}
function json(res,status,data) {
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
}
async function stripe(path,params,key) {
  const headers={Authorization:'Bearer '+process.env.STRIPE_SECRET_KEY};
  if (key) headers['Idempotency-Key']=key;
  const response=await fetch('https://api.stripe.com/v1/'+path,{method:params?'POST':'GET',headers,body:params,signal:AbortSignal.timeout(15000)});
  if (!response.ok) throw new Error('Stripe '+response.status);
  return response.json();
}
export async function purchases(req,res,url) {
  try {
    const member=membership(req);
    if (url.pathname==='/api/membresia' && req.method==='GET') return json(res,200,{email:member});
    if (url.pathname==='/api/cancelar' && req.method==='POST') {
      res.setHeader('Set-Cookie','pliego=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
      return json(res,200,{ok:true});
    }
    if (url.pathname==='/api/checkout' && req.method==='POST') {
      if (!member) return json(res,403,{message:'Activa Club Pliego para comprar.'});
      if (!process.env.STRIPE_SECRET_KEY) return json(res,503,{message:'El pago aún no está disponible. Tu bolsa está guardada.'});
      if (req.headers['content-type']!=='application/json') return json(res,415,{message:'Formato incorrecto.'});
      let raw='';
      for await (const chunk of req) {
        raw+=chunk;
        if(raw.length>4096) return json(res,413,{message:'Pedido demasiado grande.'});
      }
      let data;
      try {data=JSON.parse(raw)} catch {return json(res,400,{message:'Pedido incorrecto.'})}
      const {name,email,items,attempt}=data || {};
      if(typeof name!=='string' || !name.trim() || name.length>100 || email!==member || !Array.isArray(items) || !items.length || items.length>99 || !items.every(i=>Number.isInteger(i)&&catalog[i]) || !/^[a-f0-9-]{36}$/.test(attempt)) return json(res,400,{message:'Revisa el nombre, el correo de tu membresía y la bolsa (máximo 99 unidades).'});
      const origin=process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL;
      if (!origin) return json(res,503,{message:'Falta configurar la dirección de la tienda.'});
      const params=new URLSearchParams({mode:'payment',customer_email:email,success_url:origin+'/?pedido={CHECKOUT_SESSION_ID}',cancel_url:origin+'/?bolsa=1','metadata[nombre]':name.trim(),'metadata[articulos]':items.join(','),'payment_method_types[0]':'card'});
      [...new Set(items)].forEach((id,index)=>{
        const k='line_items['+index+']';
        params.set(k+'[price_data][currency]','mxn');
        params.set(k+'[price_data][unit_amount]',catalog[id].price);
        params.set(k+'[price_data][product_data][name]',catalog[id].name);
        params.set(k+'[quantity]',items.filter(x=>x===id).length);
      });
      const session=await stripe('checkout/sessions',params,attempt);
      return json(res,200,{url:session.url,id:session.id});
    }
    if (req.method==='GET' && ['/api/pedido','/api/descarga'].includes(url.pathname)) {
      const id=url.searchParams.get('id') || '';
      if (!/^cs_(test_|live_)?[A-Za-z0-9]{12,200}$/.test(id)) return json(res,400,{message:'Referencia incorrecta.'});
      const session=await stripe('checkout/sessions/'+id);
      if(session.payment_status!=='paid' || session.mode!=='payment' || !session.metadata?.articulos) return json(res,409,{message:'El pedido todavía no tiene un pago confirmado.'});
      const ids=[...new Set(session.metadata.articulos.split(',').map(Number))];
      if(url.pathname==='/api/pedido') return json(res,200,{ids,total:session.amount_total/100});
      const file=url.searchParams.get('obra');
      if (!ids.some(i=>catalog[i]?.file===file)) return json(res,403,{message:'Esta obra no forma parte del pedido.'});
      const png=await readFile(new URL('./laminas/'+file+'.png',import.meta.url));
      res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':'attachment; filename="'+file+'.png"','Cache-Control':'private, no-store'});
      return res.end(png);
    }
    return json(res,404,{message:'Ruta desconocida.'});
  } catch {
    return json(res,502,{message:'No pudimos consultar el servicio de pago. Vuelve a intentarlo.'});
  }
}
