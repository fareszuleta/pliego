import { purchases, setMember } from './compras.mjs';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const html = await readFile(new URL('./public/index.html', import.meta.url));
const joinHtml = await readFile(new URL('./public/join.html', import.meta.url));
const terms = await readFile(new URL('./public/club-pliego-terms.pdf', import.meta.url));
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
  const path = req.url.split('?')[0];
  if (req.method === 'GET' && ['/', '/terminos', '/terminos/', '/club-pliego-terms.pdf', '/join', '/join/'].includes(path)) {
    if (path === '/join' || path === '/join/') {
      res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
      return res.end(joinHtml);
    }
    res.writeHead(200, path === '/' ? {'Content-Type':'text/html; charset=utf-8'} : {'Content-Type':'application/pdf', 'Content-Disposition':'inline; filename="club-pliego-terms.pdf"'});
    return res.end(path === '/' ? html : terms);
  }
  if (path.startsWith('/api/') && path !== '/api/activar') return purchases(req,res,new URL(req.url,'http://localhost'));
  if (req.method !== 'POST' || req.url !== '/api/activar') return reply(res,404,'Page not found.');
  if (req.headers['content-type'] !== 'application/json') return reply(res,415,'Unsupported request format.');
  let body = '';
  try {
    for await (const chunk of req) {
      body += chunk;
      if (Buffer.byteLength(body) > 2048) return reply(res,413,'Request is too large.');
    }
    const {email} = JSON.parse(body);
    if (typeof email !== 'string' || email.length > 254 || !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/u.test(email)) {
      return reply(res,400,'Check your email address.');
    }
    const {RESEND_API_KEY, EMAIL_FROM} = process.env;
    if (!RESEND_API_KEY || !EMAIL_FROM) return reply(res,503,'Email delivery has not been set up yet.');
    const recipient = email.trim();
    const day = new Date().toISOString().slice(0,10);
    const sender = EMAIL_FROM.trim();
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',').at(-1).trim();
    let limit = attempts.get(ip);
    if (!limit || limit.until <= Date.now()) {
      limit = {count:0, until:Date.now()+hour};
      attempts.set(ip,limit);
    }
    if (limit.count >= 12) return reply(res,429,'Too many attempts. Please try again later.');
    limit.count++;
    try {
      const payload = JSON.stringify({from:sender,to:[recipient],subject:'Your Club Pliego trial membership',attachments:[{filename:'club-pliego-terms.pdf',content:terms.toString('base64')}],text:'Your Club Pliego trial membership is active. Your first month is free. Your membership terms are attached as a PDF. You can now confirm orders using the default card in the store. To cancel on this device, open Club Pliego and select Cancel membership. If you did not request this trial, you can disregard this email.'});
      const hash = createHash('sha256').update(payload).digest('hex');
      const response = await fetch('https://api.resend.com/emails', {
        method:'POST', signal:AbortSignal.timeout(12000),
        headers:{Authorization:'Bearer '+RESEND_API_KEY.trim(), 'Content-Type':'application/json','Idempotency-Key':'pliego-'+day+'-'+hash},
        body:payload
      });
      const result = await response.json();
      if (response.ok && result.id) {
        setMember(res,recipient);
        return reply(res,200,'Confirmation email sent.');
      }
      const code = String(result.name || 'unknown').replace(/[^a-z0-9_]/gi,'').slice(0,64);
      console.error('Resend activation rejected', response.status, code);
      const detail = String(result.message || '');
      if (/verify a domain|domain is not verified|domain.*not.*verified/i.test(detail) && !/testing emails/i.test(detail))
        return reply(res,503,'Email delivery is unavailable because the store sender domain is not verified.');
      if (/testing emails|your own email address/i.test(detail))
        return reply(res,403,'The store is using a test sender. It can only send to the email address registered with Resend.');
      if (/api.key|unauthorized/i.test(code) || response.status === 401)
        return reply(res,503,'The email service could not authenticate the store.');
      if (response.status === 429)
        return reply(res,429,'The email service has reached its sending limit. Please try again later.');
      return reply(res,502,'The email provider rejected the request ('+response.status+', '+code+').');
    } catch (error) {
      console.error('Email activation unavailable',error.name);
      return reply(res,502,'The store could not confirm a response from the email service. Please try again.');
    }
  } catch {
    return reply(res,400,'Invalid request.');
  }
}).listen(Number(process.env.PORT || 3000),'0.0.0.0');
