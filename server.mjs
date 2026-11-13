import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const html = await readFile(new URL('./public/index.html', import.meta.url));
const attempts = new Map();
const hour = 3600000;
setInterval(() => {
  for (const [key, entry] of attempts) {
    if (entry.until <= Date.now()) attempts.delete(key);
  }
}, hour).unref();

function reply(res, status, message) {
  res.writeHead(status, {'Content-Type':'application/json', 'Cache-Control':'no-store'});
  res.end(JSON.stringify({message}));
}

http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
    return res.end(html);
  }
  if (req.method !== 'POST' || req.url !== '/api/activar') return reply(res,404,'Ruta desconocida.');
  if (req.headers['content-type'] !== 'application/json') return reply(res,415,'Formato incorrecto.');
  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 2048) return reply(res,413,'Solicitud demasiado grande.');
    }
    const {email} = JSON.parse(body);
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(email)) {
      return reply(res,400,'Revisa tu dirección de correo.');
    }
    const {RESEND_API_KEY, EMAIL_FROM} = process.env;
    if (!RESEND_API_KEY || !EMAIL_FROM) return reply(res,503,'El envío de correos aún no está configurado.');
    const recipient = email.trim();
    const day = new Date().toISOString().slice(0,10);
    const hash = createHash('sha256').update(recipient.toLowerCase()).digest('hex');
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').at(-1).trim();
    let limit = attempts.get(ip);
    if (!limit || limit.until <= Date.now()) {
      limit = {count:0, until:Date.now()+hour};
      attempts.set(ip,limit);
    }
    if (limit.count >= 12) return reply(res,429,'Has alcanzado el límite de intentos. Vuelve más tarde.');
    limit.count++;
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method:'POST', signal:AbortSignal.timeout(12000),
        headers:{Authorization:'Bearer '+RESEND_API_KEY, 'Content-Type':'application/json','Idempotency-Key':'pliego-'+day+'-'+hash},
        body:JSON.stringify({from:EMAIL_FROM,to:[recipient],subject:'Tu suscripción de prueba a Club Pliego',text:'Has activado tu suscripción de prueba a Club Pliego. El primer mes es gratis. Esta tienda es una demostración y no realiza cargos. Para cancelar en este dispositivo, entra en Club Pliego y elige Cancelar membresía. Si no solicitaste esta prueba, puedes ignorar este mensaje.'})
      });
      if (response.ok && (await response.json()).id) return reply(res,200,'Confirmación enviada.');
    } catch {}
    return reply(res,502,'No se pudo confirmar el envío. Inténtalo de nuevo.');
  } catch {
    return reply(res,400,'Solicitud incorrecta.');
  }
}).listen(Number(process.env.PORT || 3000),'0.0.0.0');
