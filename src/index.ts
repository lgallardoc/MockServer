import fs from 'fs';
import path from 'path';
import net from 'net';
import express from 'express';
import bodyParser from 'body-parser';
import os from 'os';

type Protocol = 'ISO8583' | 'WEBSERVICE' | 'REST';

type ServerConfig = {
  name?: string;
  host: string; // IP to bind (change to your target IPs for production)
  port: number;
  protocol: Protocol;
  description?: string;
};

const SUPPORTED_PROTOCOLS = ['ISO8583', 'WEBSERVICE', 'REST'] as const;
function isValidProtocol(v: any): v is Protocol {
  return typeof v === 'string' && (SUPPORTED_PROTOCOLS as readonly string[]).includes(v);
}

function validateConfigArray(obj: any): ServerConfig[] {
  if (!Array.isArray(obj)) throw new Error('services.json must be an array');
  return obj.map((item, idx) => {
    if (typeof item !== 'object' || item === null) throw new Error(`invalid service at index ${idx}`);
    const host = item.host;
    const port = Number(item.port);
    const protocol = item.protocol;
    if (typeof host !== 'string' || host.length === 0) throw new Error(`invalid host for service index ${idx}`);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error(`invalid port for service index ${idx}`);
    if (!isValidProtocol(protocol)) throw new Error(`invalid protocol for service index ${idx} - supported: ${SUPPORTED_PROTOCOLS.join(',')}`);
    return {
      name: item.name,
      host,
      port,
      protocol,
      description: item.description
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

// Cargamos configuración al inicio (fallamos si no existe o está mal formada)
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
 * Simple ISO8583 TCP ECHO server.
 * - If payload contains "ECHOTEST" responds "ECHOTEST"
 * - Else responds "ECHO:<payload>"
 */
function startIso8583Server(host: string, port: number) {
  const server = net.createServer((socket) => {
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    console.log(`[ISO8583] Connection from ${remote}`);

    socket.setEncoding('utf8');

    socket.on('data', (data) => {
      const text = data.toString().replace(/\r?\n$/, '');
      console.log(`[ISO8583] Received from ${remote}:`, text);

      try {
        if (text.includes('ECHOTEST')) {
          socket.write('ECHOTEST\r\n');
        } else {
          socket.write(`ECHO:${text}\r\n`);
        }
      } catch (err) {
        console.error('[ISO8583] Write error:', err);
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
 * HTTP server for both WEBSERVICE and REST examples.
 * - WEBSERVICE: GET /ws?NroRequerimiento=...
 * - REST: GET /api?NroRequerimiento=... and GET /api/resource/:id
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
      startIso8583Server(c.host, c.port);
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
