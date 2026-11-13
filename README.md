# Reto 01 — Agente conversacional Registro como Proveedor

**URL:** configurar y actualizar al desplegar en Render.

## Ejecución local

Requiere Node.js 20 o superior. Desde la raíz del proyecto:

```bash
npm install
npm start
```

Abrir http://localhost:3000. Un único comando `npm start` levanta backend y frontend; `npm install` es inicial.

## Pruebas sin IA

```bash
npm run typecheck
npm test
npm run demo
```

`demo.ts` limpia `out/` y procesa los cuatro casos sin clave de Gemini. **Ejecutarlo elimina los archivos generados previamente**. Ejecuta pruebas antes de abrir el chat si necesitas conservar salidas.

## Configuración

Copiar `.env.example` a `.env` solo en desarrollo, o configurar variables privadas en Render:

- `GEMINI_API_KEY`: clave API opcional para usar LLM real (sin clave continúa disponible el flujo determinista).
- `GEMINI_MODEL`: por defecto `gemini-3.6-flash`; usar un modelo disponible en tu cuenta.
- `GEMINI_TIMEOUT_MS`: timeout (por defecto 8000).
- `MAX_ITERACIONES`: máximo de iteraciones por turno, por defecto 4.
- `MAX_TURNOS_LLM`: límite de consultas LLM por sesión, por defecto 10.
- `FECHA_EVALUACION`: fecha `YYYY-MM-DD`, opcional; en su ausencia utiliza fecha UTC actual.
- `PORT`: puerto HTTP, por defecto 3000.

La clave vive exclusivamente en el backend, nunca en Git ni en el frontend. No usar con datos reales: el enlace es público y no hay autenticación.

## API

- `GET /api/health` → `{ok,provider,model}`
- `GET /api/cases` → `{casos:[]}`
- `POST /api/chat` → `{sessionId,message}`; responde `{reply,toolCalls[],needsConfirmation,sessionId}`
- `GET /api/sessions/:id` → historial de sesión
- `GET /api/download/:caso/:nombre` → salida generada (nombre de archivo autorizado)

Al procesar un caso se guardan salidas en `out/<caso>/` y el ZIP del paquete para descargar. Cada herramienta audita en `out/log.jsonl` y `out/<caso>/log.jsonl`. Las ejecuciones posteriores reemplazan salidas del caso.

## Despliegue en Render

1. Subir repositorio a GitHub sin `.env`, `node_modules` ni `out`.
2. Render → New Web Service → GitHub → `main`; Node.
3. Build: `npm install`; Start: `npm start`; instancia Free si disponible.
4. Environment: agregar `GEMINI_API_KEY` en secreto, `GEMINI_MODEL` según el modelo permitido.
5. Esperar estado `Live`, abrir enlace y procesar `ec-corp-andina`.
6. Descargar `paquete.zip`, verificar respuestas y confirmar simulación por chat.

Render Free duerme tras inactividad y tiene sistema de archivos efímero. La carpeta `out/` se regenera al procesar. No usar el entorno público para datos sensibles de producción.

## Alcance

Formularios Excel con celdas/hojas exactas, PDF generado respetando orden de campos, portal como markdown copiables. El sistema no llena portales, no firma ni envía correos; `ENVIO-SIMULADO.md` solo tras confirmación explícita en turno siguiente. La disponibilidad de Gemini está sujeta a cuota y puede caer al respaldo determinista.
