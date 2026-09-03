const fs = require('fs');
const net = require('net');
const path = require('path');

const configPath = process.env.SERVICE_CONFIG_PATH
  ? path.resolve(process.env.SERVICE_CONFIG_PATH)
  : path.resolve(process.cwd(), 'services.json');

let services;
try {
  services = JSON.parse(fs.readFileSync(configPath, 'utf8'));
} catch (error) {
  console.error(`No se pudo leer ${configPath}: ${error.message}`);
  process.exit(1);
}

if (!Array.isArray(services)) {
  console.error('services.json debe contener un arreglo de servicios.');
  process.exit(1);
}

function verifyListener(service) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      server.close(() => error ? reject(error) : resolve());
    };

    server.once('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    server.listen(service.port, service.host, () => finish());
  });
}

async function main() {
  let hasFailure = false;

  for (const service of services) {
    const label = service.name || service.protocol || 'servicio';
    if (typeof service.host !== 'string' || !Number.isInteger(Number(service.port))) {
      console.error(`[ERROR] ${label}: host o puerto invalido.`);
      hasFailure = true;
      continue;
    }

    try {
      await verifyListener({ host: service.host, port: Number(service.port) });
      console.log(`[OK] ${label}: ${service.host}:${service.port} disponible`);
    } catch (error) {
      hasFailure = true;
      const message = error.code === 'EADDRINUSE'
        ? 'puerto ocupado por otro proceso'
        : error.code === 'EADDRNOTAVAIL'
          ? 'la IP no existe en este equipo'
          : error.message;
      console.error(`[ERROR] ${label}: ${service.host}:${service.port} - ${message}`);
    }
  }

  if (hasFailure) {
    console.error('No se inicio MockServer: corrige los listeners indicados en services.json.');
    process.exit(1);
  }
}

main();