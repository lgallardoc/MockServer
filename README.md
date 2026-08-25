# MockServer (TypeScript)

Servidor mock para levantar múltiples listeners por IP+puerto+protocolo (ISO8583 TCP echo, WebService (GET), REST).

Descripción
-----------
Este proyecto permite definir en un archivo de configuración (services.json) los servicios que quieres levantar indicando IP, puerto y protocolo. Al iniciar, la aplicación lee `services.json` y crea listeners TCP/HTTP de acuerdo a cada entrada.

Estructura
---------
- src/index.ts — servidor principal (lee services.json y levanta TCP/HTTP según protocolo)
- services.json — ejemplo de configuración (IP, puerto, protocolo) — ya incluido en la raíz
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
  { "name":"rest-api", "host":"127.0.0.4", "port":54342, "protocol":"REST", "description":"API-REST (GET)" }
]
```

- Por defecto la aplicación busca `services.json` en el directorio de trabajo actual. Para usar otra ruta, exporta la variable de entorno `SERVICE_CONFIG_PATH` con la ruta al archivo JSON.

Ejecución
--------
- En desarrollo:
  npm run dev

- En producción:
  npm run build
  npm start

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

- REST (GET):
  curl "http://127.0.0.4:54342/api?NroRequerimiento=999"
  curl "http://127.0.0.4:54342/api/resource/42"

Notas sobre IBM i (v7.4 / v7.5)
-----------------------------
- Node.js se puede ejecutar en PASE en IBM i. Asegurate de instalar una versión de Node compatible con tu release.
- Copiá `services.json` al directorio desde donde ejecutarás la app en IBM i o apunta `SERVICE_CONFIG_PATH` a su ubicación en PASE.
- Para bindear IPs específicas, la máquina IBM i debe tener esas IPs asignadas a la interfaz (consulta al administrador de red). Si no es posible, usa `0.0.0.0` o la IP principal y usa distintos puertos.

Errores comunes
---------------
- EADDRNOTAVAIL: la IP indicada no está presente en la máquina — asignala o usa 0.0.0.0.
- JSON inválido / archivo no encontrado: revisá `services.json`; la app abortará al inicio para evitar levantar servicios incorrectos.
- EACCES en puertos <1024: necesitás permisos elevados o usar puertos >1024.

Mejoras disponibles
-------------------
Si querés puedo:
- Agregar soporte ISO8583 real con una librería de parseo.
- Agregar soporte SOAP/WSDL para WEBSERVICE.
- Implementar hot-reload de `services.json` (detectar cambios y recrear listeners).
- Añadir plantillas de respuesta por servicio (respuestas personalizadas por entrada en services.json).

Contacto
--------
Repositorio: https://github.com/lgallardoc/MockServer
