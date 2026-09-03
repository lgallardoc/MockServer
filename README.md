# MockServer (TypeScript)

Servidor mock para levantar múltiples listeners por IP, puerto y protocolo: ISO8583 TCP echo, WebService HTTP/SOAP y REST.

Descripción
-----------
Este proyecto permite definir en un archivo de configuración (services.json) los servicios que quieres levantar indicando IP, puerto y protocolo. Al iniciar, la aplicación lee `services.json` y crea listeners TCP/HTTP de acuerdo a cada entrada.

Estructura
---------
- src/index.ts — servidor principal, incluye el mock SOAP AZ7_CUENTA_TARJETA
- services.json — configuración de listeners por IP, puerto y protocolo
- scripts/check-listeners.js — valida que las IP y puertos estén disponibles
- scripts/start-mockserver.sh — inicia el servidor en modo desarrollo, PM2 o nohup
- package.json, tsconfig.json
- .gitignore

Requisitos
---------
- Node.js (recomiendo LTS: 16/18/20)
- npm

Instalación (local)
-------------------
1. Clona el repo o actualiza tu copia local:
   git clone https://github.com/lgallardoc/MockServer
   (o si ya lo tenés: git pull origin main)
2. Instala dependencias:
   npm install

Archivo de configuración: services.json
-------------------------------------
Ejemplo (ya incluido en la raíz):

```json
[
  { "name":"iso-echo", "host":"127.0.0.2", "port":54344, "protocol":"ISO8583", "description":"ISO8583 ECHOTEST (TCP)" },
  { "name":"webservice-ws", "host":"127.0.0.3", "port":54343, "protocol":"WEBSERVICE", "description":"WebService (GET)" },
  { "name":"az7-cuenta-tarjeta", "host":"0.0.0.0", "port":40013, "protocol":"WEBSERVICE", "description":"SOAP AZ7_CUENTA_TARJETA" },
  { "name":"rest-api", "host":"127.0.0.4", "port":54342, "protocol":"REST", "description":"API-REST (GET)" }
]
```

- Por defecto la aplicación busca `services.json` en el directorio de trabajo actual. Para usar otra ruta, exporta la variable de entorno `SERVICE_CONFIG_PATH` con la ruta al archivo JSON.

Ejecución
--------
- Antes de iniciar, usa el lanzador. Valida cada IP y puerto de `services.json`; si una IP no existe o un puerto está ocupado, el servidor no inicia y muestra el motivo. Para detener automáticamente la instancia previa de MockServer, agrega `-- --stop-occupied`.

- En desarrollo:
  npm run launch:dev
  npm run launch:dev -- --stop-occupied

- Con PM2:
  npm run launch:pm2
  npm run launch:pm2 -- --stop-occupied

- Con nohup:
  npm run launch:nohup
  npm run launch:nohup -- --stop-occupied

También están disponibles los alias `npm run launch:dev:clean`, `npm run launch:pm2:clean` y `npm run launch:nohup:clean`.

Ejecución persistente
----------------------
Antes de iniciar el servicio, compilá el proyecto desde la raíz:

```sh
npm run build
```

Elegí una de las siguientes alternativas para ejecutarlo en segundo plano.

### Con nohup

Inicia el servicio aunque se cierre la sesión y guarda la salida en `mockserver.out`. El PID queda registrado en `mockserver.pid` para facilitar su administración.

```sh
npm run launch:nohup
```

Para revisar el proceso y sus logs:

```sh
ps -fp "$(cat mockserver.pid)"
tail -f mockserver.out
```

Para finalizar el servicio:

```sh
kill "$(cat mockserver.pid)"
rm -f mockserver.pid
```

### Con PM2

Instalá PM2 una única vez y luego iniciá el script de producción con el nombre `mock-server`:

```sh
npm install -g pm2
npm run launch:pm2
```

PM2 mantiene el proceso Node.js en segundo plano después del inicio.

En IBM i PASE, donde normalmente no están disponibles `lsof` ni `fuser`, `--stop-occupied` detiene únicamente instancias previas de este proyecto: procesos `mock-server` de PM2, el PID de `mockserver.pid` y procesos Node iniciados desde el directorio del proyecto. Si el puerto está ocupado por otra aplicación, el lanzador no la termina y muestra el error de puerto ocupado.

Para revisar el estado y los logs:

```sh
pm2 status mock-server
pm2 logs mock-server
```

Para finalizar el servicio, detenelo. Usá `delete` si también querés eliminarlo de la lista administrada por PM2:

```sh
pm2 stop mock-server
pm2 delete mock-server
```

Notas para pruebas locales
------------------------
- Si usás las IPs de ejemplo `127.0.0.2`, `127.0.0.3`, `127.0.0.4` necesitás añadirlas como aliases en la loopback:
  - Linux:
    sudo ip addr add 127.0.0.2/32 dev lo
    sudo ip addr add 127.0.0.3/32 dev lo
    sudo ip addr add 127.0.0.4/32 dev lo
  - macOS:
    sudo ifconfig lo0 alias 127.0.0.2
    sudo ifconfig lo0 alias 127.0.0.3
    sudo ifconfig lo0 alias 127.0.0.4

- Alternativa: en `services.json` usa `"host": "0.0.0.0"` para bindear todas las interfaces (útil si no podés crear aliases).

Pruebas rápidas
---------------
- ISO8583 (TCP ECHOTEST):
  nc 127.0.0.2 54344
  enviar: ECHOTEST
  recibirás: ECHOTEST
  o enviar: Hola → recibirás: ECHO:Hola

- WebService (GET):
  curl "http://127.0.0.3:54343/ws?NroRequerimiento=123"

- SOAP AZ7 cuenta tarjeta:
  WSDL: GET http://IP_DEL_SERVIDOR:40013/web/services/AZ7_CUENTA_TARJETAService/AZ7_CUENTA_TARJETA?wsdl
  Operación: POST http://IP_DEL_SERVIDOR:40013/web/services/AZ7_CUENTA_TARJETAService/AZ7_CUENTA_TARJETA

  curl -v "http://127.0.0.1:40013/web/services/AZ7_CUENTA_TARJETAService/AZ7_CUENTA_TARJETA?wsdl"
  curl -v "http://10.139.2.100:40013/web/services/AZ7_CUENTA_TARJETAService/AZ7_CUENTA_TARJETA?wsdl"

  curl -H "Content-Type: text/xml; charset=utf-8" -d @request.xml "http://127.0.0.1:40013/web/services/AZ7_CUENTA_TARJETAService/AZ7_CUENTA_TARJETA"

  La respuesta tiene `HTTP 200`, `Content-Type: application/soap+xml; charset=UTF-8` y el cuerpo:

  ```xml
  <soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><ns2:pgmactResponse xmlns:ns2="http://az7_cuenta_tarjeta.wsbeans.iseries/"><return><AUTORIZACION></AUTORIZACION><COD_RTA>03</COD_RTA></return></ns2:pgmactResponse></soap:Body></soap:Envelope>
  ```

- REST (GET):
  curl "http://127.0.0.4:54342/api?NroRequerimiento=999"
  curl "http://127.0.0.4:54342/api/resource/42"

Notas sobre IBM i (v7.4 / v7.5)
-----------------------------
- Node.js se puede ejecutar en PASE en IBM i. Asegurate de instalar una versión de Node compatible con tu release.
- Copiá `services.json` al directorio desde donde ejecutarás la app en IBM i o apunta `SERVICE_CONFIG_PATH` a su ubicación en PASE.
- Para bindear IPs específicas, la máquina IBM i debe tener esas IPs asignadas a la interfaz (consulta al administrador de red). Si no es posible, usa `0.0.0.0` o la IP principal y usa distintos puertos.
- Después de actualizar el repositorio en PASE, instalá dependencias y compilá antes de iniciar con PM2:

  ```sh
  cd /bashapp/MockServer
  npm install
  npm run build
  npm run launch:pm2 -- --stop-occupied
  pm2 logs mock-server
  ```

### Crear proxy reverso para IBM i

#### Paso 1: levantar el túnel desde tu computadora local

Necesitas tener acceso SSH a tu IBM i desde tu PC a través del puerto SSH de la máquina, usualmente el `22`.

Abre la terminal de tu computadora, por ejemplo PowerShell en Windows o Terminal en macOS/Linux, y ejecuta:

```sh
ssh -R 1080 -N -f lagallardoc@TU_IP_IBM_I
```

Reemplaza `lagallardoc@TU_IP_IBM_I` con tu usuario y la IP o host de tu partición de IBM i.

Parámetros usados:

- `-R 1080`: crea un túnel reverso. Le dice al IBM i que abra el puerto `1080` en su propio localhost (`127.0.0.1`) y que todo el tráfico enviado a ese puerto sea redirigido de vuelta a tu computadora local.
- `-N`: indica a SSH que no ejecute ningún comando remoto; solo establece el túnel.
- `-f`: opcional. Ejecuta el proceso en segundo plano en tu PC para que puedas seguir usando la terminal.

#### Paso 2: configurar las herramientas en IBM i

Con el puerto `1080` del IBM i escuchando y reenviando tráfico a tu computadora, indica a las aplicaciones Open Source en iSeries que usen ese proxy.

Conéctate a tu terminal del IBM i, por ejemplo con VS Code Code for IBM i o SSH, y configura las variables de entorno de red de tu sesión PASE:

```sh
export http_proxy=socks5h://127.0.0.1:1080
export https_proxy=socks5h://127.0.0.1:1080
```

El prefijo `socks5h://` es importante porque delega también la resolución DNS a tu computadora local, evitando fallos de DNS en la red interna del iSeries.

Errores comunes
---------------
- EADDRNOTAVAIL: la IP indicada no está presente en la máquina. Asignala o usa `0.0.0.0`.
- EADDRINUSE: un proceso ya usa el puerto. Ejecuta `npm run launch:pm2 -- --stop-occupied`; en PASE solo detendrá instancias anteriores de MockServer.
- JSON inválido / archivo no encontrado: revisá `services.json`; la app abortará al inicio para evitar levantar servicios incorrectos.
- EACCES en puertos <1024: necesitás permisos elevados o usar puertos >1024.
- Cannot find module `dist/index.js`: falta compilar el proyecto. Ejecuta `npm run build` antes de iniciar con PM2 o `npm start`.

Mejoras disponibles
-------------------
Si querés puedo:
- Agregar soporte ISO8583 real con una librería de parseo.
- Implementar hot-reload de `services.json` (detectar cambios y recrear listeners).
- Añadir plantillas de respuesta por servicio (respuestas personalizadas por entrada en services.json).

Contacto
--------
Repositorio: https://github.com/lgallardoc/MockServer
