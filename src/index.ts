import fs from 'fs';
import path from 'path';
import net from 'net';
import express from 'express';
import bodyParser from 'body-parser';
import os from 'os';

type Protocol = 'ISO8583' | 'WEBSERVICE' | 'REST';
type HeaderType = 'auto' | 'ascii4' | 'bin16' | 'none';

type ResponseRule = {
  name?: string;
  when: Array<{ field: number; equals: string }>;
  setFields?: { [field: string]: string };
  keepFields?: boolean;
  priority?: number;
};

type ServerConfig = {
  name?: string;
  host: string;
  port: number;
  protocol: Protocol;
  description?: string;
  headerType?: HeaderType;
  responses?: ResponseRule[];
};

const SUPPORTED_PROTOCOLS = ['ISO8583', 'WEBSERVICE', 'REST'] as const;
const SUPPORTED_HEADER_TYPES = ['auto', 'ascii4', 'bin16', 'none'] as const;

function isValidProtocol(v: any): v is Protocol {
  return typeof v === 'string' && (SUPPORTED_PROTOCOLS as readonly string[]).includes(v);
}

function isValidHeaderType(v: any): v is HeaderType {
  return typeof v === 'string' && (SUPPORTED_HEADER_TYPES as readonly string[]).includes(v);
}

function validateConfigArray(obj: any): ServerConfig[] {
  if (!Array.isArray(obj)) throw new Error('services.json must be an array');
  return obj.map((item, idx) => {
    if (typeof item !== 'object' || item === null) throw new Error(`invalid service at index ${idx}`);
    const host = item.host;
    const port = Number(item.port);
    const protocol = item.protocol;
    const headerType = item.headerType || 'auto';
    if (typeof host !== 'string' || host.length === 0) throw new Error(`invalid host for service index ${idx}`);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid port for service index ${idx}`);
    if (!isValidProtocol(protocol)) throw new Error(`invalid protocol for service index ${idx} - supported: ${SUPPORTED_PROTOCOLS.join(',')}`);
    if (!isValidHeaderType(headerType)) throw new Error(`invalid headerType for service index ${idx} - supported: ${SUPPORTED_HEADER_TYPES.join(',')}`);
    if (item.responses) {
      if (!Array.isArray(item.responses)) throw new Error(`responses must be an array in service index ${idx}`);
      for (const r of item.responses) {
        if (!r.when || !Array.isArray(r.when)) throw new Error(`rule.when must be array in service index ${idx}`);
      }
    }
    return {
      name: item.name,
      host,
      port,
      protocol,
      description: item.description,
      headerType,
      responses: item.responses
    } as ServerConfig;
  });
}

function loadConfigs(): ServerConfig[] {
  const cfgPath = process.env.SERVICE_CONFIG_PATH
    ? path.resolve(process.env.SERVICE_CONFIG_PATH)
    : path.resolve(process.cwd(), 'services.json');

  if (!fs.existsSync(cfgPath)) {
    throw new Error(`Configuration file not found: ${cfgPath}`);
  }

  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const parsed = JSON.parse(raw);
    return validateConfigArray(parsed);
  } catch (err) {
    throw new Error(`Failed to load/parse ${cfgPath}: ${(err as Error).message}`);
  }
}

// Load configs on start
let configs: ServerConfig[] = [];
try {
  configs = loadConfigs();
  console.log('Loaded service configs from file:', configs.map(s => `${s.name||s.protocol}@${s.host}:${s.port}`));
} catch (err) {
  console.error('Error loading service configuration:', (err as Error).message);
  process.exit(1);
}

function osInfo() {
  return {
    hostname: os.hostname(),
    platform: os.platform(),
    type: os.type(),
    release: os.release(),
    uptime_seconds: Math.round(os.uptime())
  };
}

/**
 * Framing helpers
 */
function parseAscii4(buf: Buffer) {
  if (buf.length < 4) return null;
  const header = buf.slice(0, 4).toString('ascii');
  if (!/^\d{4}$/.test(header)) return null;
  const len = parseInt(header, 10);
  return { headerType: 'ascii4' as const, headerBytes: 4, length: len, msg: buf.slice(4, 4 + len) };
}

function parseBin16(buf: Buffer) {
  if (buf.length < 2) return null;
  const len = buf.readUInt16BE(0);
  return { headerType: 'bin16' as const, headerBytes: 2, length: len, msg: buf.slice(2, 2 + len) };
}

function parseIsoMessage(buf: Buffer, headerPref: HeaderType) {
  if (headerPref === 'ascii4') {
    return parseAscii4(buf) || { headerType: 'none' as const, headerBytes: 0, length: buf.length, msg: buf };
  }
  if (headerPref === 'bin16') {
    return parseBin16(buf) || { headerType: 'none' as const, headerBytes: 0, length: buf.length, msg: buf };
  }
  if (headerPref === 'none') {
    return { headerType: 'none' as const, headerBytes: 0, length: buf.length, msg: buf };
  }
  // auto detection
  const a4 = parseAscii4(buf);
  if (a4) return a4;
  const b2 = parseBin16(buf);
  if (b2) return b2;
  return { headerType: 'none' as const, headerBytes: 0, length: buf.length, msg: buf };
}

function buildIsoResponse(msg: Buffer, headerType: 'ascii4' | 'bin16' | 'none') {
  if (headerType === 'ascii4') {
    const lenStr = String(msg.length).padStart(4, '0');
    return Buffer.concat([Buffer.from(lenStr, 'ascii'), msg]);
  }
  if (headerType === 'bin16') {
    const header = Buffer.alloc(2);
    header.writeUInt16BE(msg.length, 0);
    return Buffer.concat([header, msg]);
  }
  return msg;
}

// Try loading iso_8583 package
let Iso8583Pkg: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ISO = require('iso_8583');
  Iso8583Pkg = ISO;
} catch (err) {
  Iso8583Pkg = null;
  console.warn('iso_8583 library not available; running in fallback mode.');
}

function matchRule(parsedFields: Record<number, string>, rule: ResponseRule) {
  for (const cond of rule.when) {
    const current = parsedFields[cond.field] ?? '';
    if (current !== cond.equals) return false;
  }
  return true;
}

async function buildResponseBufferWithIso(respFields: Record<number,string>) {
  if (!Iso8583Pkg) return null;
  try {
    // Try several builder APIs
    // 1) Some versions accept data map in constructor and provide getMsg()
    if (typeof Iso8583Pkg === 'function') {
      try {
        const builder = new Iso8583Pkg(respFields);
        if (typeof builder.getMsg === 'function') {
          const packed = builder.getMsg();
          if (packed && /^[0-9a-fA-F]+$/.test(String(packed))) return Buffer.from(String(packed), 'hex');
          return Buffer.from(String(packed), 'ascii');
        }
      } catch (_e) {
        // fallthrough
      }
    }

    // 2) If package exports a class with methods, try alternative usage
    const proto = Iso8583Pkg && Iso8583Pkg.prototype ? Iso8583Pkg : null;
    if (proto) {
      try {
        const inst = new Iso8583Pkg();
        if (typeof inst.getMsg === 'function') {
          const packed = inst.getMsg(respFields);
          if (packed && /^[0-9a-fA-F]+$/.test(String(packed))) return Buffer.from(String(packed), 'hex');
          return Buffer.from(String(packed), 'ascii');
        }
      } catch (_e) {
        // fallthrough
      }
    }

    // 3) If nothing worked, return null to indicate fallback
    return null;
  } catch (err) {
    console.warn('[ISO8583] build with iso_8583 failed:', (err as Error).message);
    return null;
  }
}

/**
 * Enhanced ISO8583 TCP server: parses framing and content, integrates parser if available,
 * evaluates response rules from services.json and builds responses accordingly.
 */
function startIso8583Server(host: string, port: number, cfg?: ServerConfig) {
  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[ISO8583] Connection from ${remote}`);

    socket.on('data', async (data) => {
      const buf: Buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
      console.log(`[ISO8583] Raw data from ${remote}:`, buf.toString('hex'));

      try {
        const headerPref = (cfg && cfg.headerType) ? cfg.headerType : 'auto';
        const parsedFrame = parseIsoMessage(buf, headerPref);
        const headerTypeUsed = parsedFrame.headerType as 'ascii4' | 'bin16' | 'none';
        const msg: Buffer = parsedFrame.msg;

        if (!msg || msg.length === 0) {
          console.warn('[ISO8583] empty payload after framing');
          return;
        }

        // parse with iso_8583 if available
        let parsedFields: Record<number, string> = {};
        let mti: string | undefined;

        if (Iso8583Pkg) {
          try {
            const isoInstance = new Iso8583Pkg();
            let isoJson: any = null;
            // try ascii
            try {
              isoJson = isoInstance.getIsoJSON(msg.toString('ascii'));
            } catch (e1) {
              try {
                isoJson = isoInstance.getIsoJSON(msg.toString('hex'));
              } catch (e2) {
                isoJson = null;
              }
            }
            if (isoJson) {
              mti = isoJson['0'] || isoJson['mti'] || isoJson['MTI'] || isoJson.mti;
              for (const k of Object.keys(isoJson)) {
                const ki = Number(k);
                if (!Number.isNaN(ki)) parsedFields[ki] = String(isoJson[k]);
              }
            }
          } catch (err) {
            console.warn('[ISO8583] iso_8583 parse error, falling back:', (err as Error).message);
            Iso8583Pkg = null;
          }
        }

        if (!mti) {
          if (msg.length >= 4) {
            const maybeMti = msg.slice(0, 4).toString('ascii');
            if (/^\d{4}$/.test(maybeMti)) mti = maybeMti;
          }
        }

        const svc = cfg || configs.find(s => s.host === host && s.port === port);
        const rules = svc && svc.responses ? [...svc.responses].sort((a,b) => (b.priority||0)-(a.priority||0)) : [];

        let applied = false;
        if (rules.length > 0) {
          for (const rule of rules) {
            if (matchRule(parsedFields, rule)) {
              const respFields: Record<number, string> = rule.keepFields ? { ...parsedFields } : {};
              if (rule.setFields) {
                for (const k of Object.keys(rule.setFields)) {
                  respFields[Number(k)] = String(rule.setFields[k]);
                }
              }
              if (!respFields[0] && mti === '0800') respFields[0] = '0810';

              // try build with iso lib
              const built = await buildResponseBufferWithIso(respFields);
              if (built) {
                const framed = buildIsoResponse(built, headerTypeUsed);
                socket.write(framed);
                applied = true;
                console.log(`[ISO8583] Applied rule ${rule.name} and sent framed response to ${remote}`);
                break;
              }

              // fallback raw construction
              const outMti = respFields[0] || (mti === '0800' ? '0810' : (mti || '0810'));
              const restParts: string[] = [];
              for (const fk of Object.keys(respFields)) {
                if (Number(fk) === 0) continue;
                restParts.push(String(respFields[Number(fk)]));
              }
              const payload = Buffer.from(outMti + restParts.join(''), 'ascii');
              const framed = buildIsoResponse(payload, headerTypeUsed);
              socket.write(framed);
              applied = true;
              break;
            }
          }
        }

        if (!applied) {
          if (mti === '0800') {
            if (Iso8583Pkg && Object.keys(parsedFields).length > 0) {
              try {
                const respFields = { ...parsedFields, 0: '0810' } as Record<number,string>;
                const built = await buildResponseBufferWithIso(respFields);
                if (built) {
                  const framed = buildIsoResponse(built, headerTypeUsed);
                  socket.write(framed);
                  console.log(`[ISO8583] Sent 0810 (parser-built) to ${remote}`);
                } else {
                  const rest = msg.slice(4);
                  const respMsg = Buffer.concat([Buffer.from('0810', 'ascii'), rest]);
                  socket.write(buildIsoResponse(respMsg, headerTypeUsed));
                }
              } catch (_) {
                const rest = msg.slice(4);
                const respMsg = Buffer.concat([Buffer.from('0810', 'ascii'), rest]);
                socket.write(buildIsoResponse(respMsg, headerTypeUsed));
              }
            } else {
              const rest = msg.slice(4);
              const respMsg = Buffer.concat([Buffer.from('0810', 'ascii'), rest]);
              socket.write(buildIsoResponse(respMsg, headerTypeUsed));
            }
          } else if (msg.toString('utf8').includes('ECHOTEST')) {
            socket.write('ECHOTEST\r\n');
          } else {
            const framed = buildIsoResponse(msg, headerTypeUsed);
            socket.write(framed);
          }
        }
      } catch (err) {
        console.error('[ISO8583] Processing error:', (err as Error).message);
      }
    });

    socket.on('close', () => console.log(`[ISO8583] Closed ${remote}`));
    socket.on('error', (err) => console.error(`[ISO8583] Socket error ${remote}:`, err));
  });

  server.on('error', (err) => console.error(`[ISO8583] Server error on ${host}:${port}:`, err));

  server.listen(port, host, () => {
    console.log(`[ISO8583] Listening on ${host}:${port}`);
  });
}

/**
 * HTTP server for WEBSERVICE and REST
 */
function startHttpServer(host: string, port: number, kind: Protocol) {
  const app = express();
  app.use(bodyParser.json());

  if (kind === 'WEBSERVICE') {
    app.get('/ws', (req, res) => {
      const nro = req.query.NroRequerimiento || req.query.nro || null;
      return res.json({
        protocol: 'WEBSERVICE',
        requestNumber: nro,
        message: 'hola mundo',
        os: osInfo()
      });
    });

    app.get('/ws/text', (req, res) => {
      const nro = req.query.NroRequerimiento || req.query.nro || null;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(`hola mundo - NroRequerimiento=${nro} - ${JSON.stringify(osInfo())}`);
    });
  }

  if (kind === 'REST') {
    app.get('/api', (req, res) => {
      const nro = req.query.NroRequerimiento || req.query.nro || null;
      return res.json({
        protocol: 'REST',
        requestNumber: nro,
        message: 'hola mundo',
        os: osInfo()
      });
    });

    app.get('/api/resource/:id', (req, res) => {
      const id = req.params.id;
      res.json({
        protocol: 'REST',
        resourceId: id,
        message: 'hola mundo',
        os: osInfo()
      });
    });
  }

  const server = app.listen(port, host, () => {
    console.log(`[HTTP ${kind}] Listening on http://${host}:${port}/`);
  });

  server.on('error', (err: any) => {
    console.error(`[HTTP ${kind}] Server error on ${host}:${port}:`, err);
  });
}

// Start servers based on configuration
for (const c of configs) {
  switch (c.protocol) {
    case 'ISO8583':
      startIso8583Server(c.host, c.port, c);
      break;
    case 'WEBSERVICE':
    case 'REST':
      startHttpServer(c.host, c.port, c.protocol);
      break;
    default:
      console.warn('Unknown protocol for config', c);
  }
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Received SIGINT, exiting.');
  process.exit(0);
});

console.log('Mock servers configured:', configs);
console.log('Nota: para bindear direcciones específicas la máquina debe tener esas IPs asignadas. Para pruebas locales puedes usar alias loopback (ver README).');
