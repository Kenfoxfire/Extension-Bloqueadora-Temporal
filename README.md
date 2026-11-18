# Bloqueadora Temporal

Extensión independiente para Chrome Manifest V3. Antes de abrir cualquier dominio configurado, muestra una espera; al pulsar **Acceder**, permite la navegación solo en esa pestaña y durante el tiempo indicado.
La redirección conserva la URL solicitada para regresar a la misma página al iniciar la sesión.

## Instalar

1. Abre `chrome://extensions` en Chrome.
2. Activa **Modo de desarrollador**.
3. Pulsa **Cargar descomprimida** y selecciona esta carpeta.

## Configuración

Edita `temporal-config.json` y recarga la extensión:

```json
{
  "defaults": {
    "maxSessions": 8,
    "waitSeconds": 20,
    "appMinutes": 5
  },
  "groups": [
    {
      "id": "redes-sociales",
      "domains": ["instagram.com", "facebook.com"]
    },
    {
      "id": "videos",
      "domains": ["youtube.com"],
      "maxSessions": 4,
      "waitSeconds": 30,
      "appMinutes": 10
    }
  ]
}
```

- `maxSessions`: máximo de sesiones iniciadas por día para ese grupo.
- `waitSeconds`: tiempo de espera antes de que aparezca **Acceder**.
- `appMinutes`: duración de la sesión después de pulsar **Acceder**.
- Los valores dentro de un grupo sobrescriben `defaults`; los que no se indiquen heredan el valor predeterminado.
- Todos los dominios de un grupo comparten el mismo contador y tiempos. Cada sesión iniciada en cualquiera de ellos consume un cupo.
- Se bloquea el dominio completo, incluyendo subdominios y todas sus rutas. Escribe solo el dominio, sin protocolo, puerto ni ruta.
- Los grupos no pueden contener dominios superpuestos para evitar reglas ambiguas.
- El contador se reinicia a las **3:00 a. m. de la hora local del sistema**. Cerrar una pestaña no devuelve el cupo usado.

Al terminar la sesión, la pestaña muestra: **Vete a hacer algo más, no desperdicie su tiempo.** Si se agota el cupo, la pantalla de bloqueo aparece antes de permitir otra sesión.

## Privacidad y límites

La configuración y los contadores se guardan localmente en Chrome. No se envían datos a servidores. La extensión no puede impedir que se desactive o quite desde `chrome://extensions`; para eso se requieren políticas administradas de Chrome.

## Pruebas

Ejecuta `node --test tests/*.test.mjs`. La validación final de redirección y temporizadores debe hacerse cargando la extensión en Chrome.
