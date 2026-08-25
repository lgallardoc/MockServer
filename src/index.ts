import net from 'net';
import express from 'express';
import bodyParser from 'body-parser';
import os from 'os';

type Protocol = 'ISO8583' | 'WEBSERVICE' | 'REST';

type ServerConfig = {
  host: string; // IP to bind (change to your target IPs for production)
  port: number;
  protocol: Protocol;
};

const configs: ServerConfig[] = [
  // Defaults use loopback aliases for easy local testing.
  // Change host values to 10.4.24.21/22/23 when deploying to target machine.
  { host: '127.0.0.2', port: 54344, protocol: 'ISO8583' },   // ISO8583 ECHOTEST (TCP)
  { host: '127.0.0.3', port: 54343, protocol: 'WEBSERVICE' }, // WebService (GET)
  { host: '127.0.0.4', port: 54342, protocol: 'REST' }        // API-REST (GET)
];

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
