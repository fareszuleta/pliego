import {createHmac, timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const catalog = [
  {name:'Terracotta Orbit', price:18000, file:'orbita'},
  {name:'Cobalt Rhythm', price:21000, file:'ritmo'},
  {name:'Clay Sun', price:19000, file:'sol'}
];

function signature(payload, scope='member') {
  return createHmac('sha256',process.env.MEMBER_SECRET || process.env.RESEND_API_KEY).update('pliego/'+scope+'/'+payload).digest('base64url');
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
function readOrder(token) {
  if (!token || token.length > 4096) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [data, mac] = parts;
  if (!/^[A-Za-z0-9_-]{43}$/.test(mac)) return null;
  const expected = signature(data, 'order');
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  return JSON.parse(Buffer.from(data, 'base64url').toString());
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
      if (!member) return json(res,403,{message:'Activate your Club Pliego membership to check out.'});
      if (req.headers['content-type']!=='application/json') return json(res,415,{message:'Unsupported request format.'});
      let raw='';
      for await (const chunk of req) {
        raw+=chunk;
        if(raw.length>4096) return json(res,413,{message:'Order is too large.'});
      }
      let data;
      try {data=JSON.parse(raw)} catch {return json(res,400,{message:'Invalid order.'})}
      const {name,email,items,attempt}=data || {};
      if(typeof name!=='string' || !name.trim() || name.length>100 || email!==member || !Array.isArray(items) || !items.length || items.length>99 || !items.every(i=>Number.isInteger(i)&&catalog[i]) || !/^[a-f0-9-]{36}$/.test(attempt)) return json(res,400,{message:'Check your name, membership email and bag (up to 99 items).'});
      const ids = [...new Set(items)];
      const total = items.reduce((sum, id) => sum + catalog[id].price, 0) / 100;
      const dataToken = Buffer.from(JSON.stringify({attempt, ids, total})).toString('base64url');
      const id = dataToken + '.' + signature(dataToken, 'order');
      return json(res, 200, {id, url:'/?pedido='+id});

    }
    if (req.method==='GET' && ['/api/pedido','/api/descarga'].includes(url.pathname)) {
      const id=url.searchParams.get('id') || '';
      const order = readOrder(id);
      if (!order) return json(res,404,{message:'Order not found.'});
      const {ids,total} = order;
      if(url.pathname==='/api/pedido') return json(res,200,{ids,total});
      const file=url.searchParams.get('obra');
      if (!ids.some(i=>catalog[i]?.file===file)) return json(res,403,{message:'This print is not part of your order.'});
      const png=await readFile(new URL('./laminas/'+file+'.png',import.meta.url));
      res.writeHead(200,{'Content-Type':'image/png','Content-Disposition':'attachment; filename="'+file+'.png"','Cache-Control':'private, no-store'});
      return res.end(png);
    }
    return json(res,404,{message:'Page not found.'});
  } catch {
    return json(res,502,{message:'We could not process your order. Please try again.'});
  }
}
