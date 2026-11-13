Reto 01 — Agente conversacional de registro como proveedor
Esta aplicación prepara registros ficticios de Periferia IT Group: lee solicitudes de clientes, cruza campos con el maestro, genera el formato requerido y reúne soportes para revisión humana. No firma ni envía correos reales.
Probar en línea: https://periferia-reto-01-0uk6.onrender.com/
Código fuente: https://github.com/marialeap/periferia-reto-01
No se requiere usuario ni contraseña para abrir la demostración. Puede demorar en iniciar después de un período de inactividad por el plan gratuito de Render.
1. Ejecutar en local
Se necesita Node.js 20 o superior, npm y acceso a los archivos del repositorio. Desde la raíz del proyecto:
```bash
npm install
npm start
```
`npm install` se ejecuta una vez al preparar el entorno. Después, un solo comando, `npm start`, levanta el backend y sirve el frontend en `http://localhost:3000` (o en el puerto configurado).
La aplicación permite procesar los cuatro casos mediante las herramientas locales aun sin clave de Gemini. Para utilizar el modelo real, configura `GEMINI_API_KEY` como variable de entorno del servidor antes de ejecutar `npm start`. Si prefieres un archivo `.env` local, no lo subas al repositorio; el comando alternativo que lo carga explícitamente es:
```bash
node --env-file=.env --import tsx src/server.ts
```
2. Configuración de variables de entorno
El archivo `.env.example` muestra los nombres y valores de ejemplo. En Render, configúralas desde Environment, como secretos del servicio:
Variable	Uso	Valor por defecto
`GEMINI_API_KEY`	Clave privada de Google AI Studio; opcional para la ejecución local determinista	Sin valor
`GEMINI_MODEL`	Modelo consultado a través del adaptador	`gemini-3.6-flash`
`GEMINI_TIMEOUT_MS`	Tiempo máximo de respuesta del modelo	`8000`
`MAX_ITERACIONES`	Tope del ciclo por turno	`4`
`MAX_TURNOS_LLM`	Tope de llamadas al modelo por sesión	`10`
`MAX_TOKENS_SESION`	Tope estimado de tokens del modelo por sesión	`12000`
`FECHA_EVALUACION`	Fecha opcional para evaluar vigencias (`YYYY-MM-DD`)	Fecha UTC actual
`PORT`	Puerto HTTP	`3000`
La clave no debe aparecer en `README.md`, `.env.example`, el frontend, commits ni logs.
3. Ejecutar pruebas y demo sin IA
```bash
npm run typecheck
npm test
npm run demo
```
`typecheck` comprueba los tipos de TypeScript.
`test` ejecuta las pruebas automatizadas: casos oficiales, formato de Excel, PDF, validaciones, entrada inválida y confirmación.
`demo` recorre los cuatro casos y presenta un resumen, sin llamar a Gemini.
Atención: `npm run demo` elimina y regenera el directorio `out/` para que las ejecuciones sean repetibles. No lo ejecutes si necesitas conservar descargas anteriores sin hacer copia.
4. Cómo utilizar el chat
Abre la URL pública o local, selecciona un caso y pulsa Procesar caso seleccionado. También puedes escribir, por ejemplo:
```text
Procesa el caso ec-corp-andina. Dime qué campos faltan,
qué soportes debo actualizar y si está listo para firma.
No envíes nada todavía.
```
Los casos disponibles son:
Caso	Formato de salida
`co-industrias-delta`	`formulario.xlsx`
`ec-corp-andina`	`formulario.pdf`
`hn-agroexport-sula`	`formulario.xlsx`
`pa-logistica-istmo`	`valores-portal.md` (portal no automatizado)
El chat muestra las herramientas ejecutadas y habilita las descargas del caso. Si aparece una solicitud de confirmación, Confirmo crea únicamente una constancia de envío simulado. Cancelar no realiza esa acción. No se ejecuta una firma ni se envía un correo real.
5. Estructura del proyecto
```text
agent/prompt.md                       instrucciones del agente
src/knowledge/registro-proveedor.md  conocimiento del proceso
src/tools/proveedor.ts                herramientas de negocio
src/llm/                              adaptador del modelo
src/server.ts                         servidor, sesiones y API
web/index.html                        chat web
fixtures/reto-01/                    datos oficiales ficticios (sin modificar)
tests/                                pruebas automáticas
demo.ts                               ejecución sin modelo
modulo/                               empaquetado de reutilización (bonus)
out/                                  archivos generados (no subir a Git)
SOLUCION.md                           razonamiento y cobertura del PRD
```
6. API disponible
Método y ruta	Qué hace
`GET /api/health`	Comprueba salud y modelo configurado, sin mostrar claves
`GET /api/cases`	Lista los casos oficiales disponibles
`POST /api/chat`	Recibe `{sessionId, message}` y responde con texto, llamadas a herramientas y estado de confirmación
`GET /api/sessions/:id`	Devuelve el historial disponible de la sesión
`GET /api/download/:caso/:nombre`	Descarga un archivo permitido previamente generado
Los resultados se escriben en `out/<caso>/`. `out/`, `.env` y `node_modules/` están excluidos de Git. El almacenamiento de Render Free es temporal: si reinicia, procesa el caso nuevamente antes de descargar.
7. Despliegue
El servicio está configurado en Render con un repositorio GitHub conectado:
Build Command: `npm install`
Start Command: `npm start`
Branch: `main`
Variable privada: `GEMINI_API_KEY` (si se desea usar Gemini)
URL pública para la defensa: https://periferia-reto-01-0uk6.onrender.com/
8. Limitaciones y seguridad
Es una demostración sobre datos ficticios. No hay autenticación ni persistencia de sesiones tras reinicio; tampoco hay integración con correo, firma electrónica o portales reales. La lógica de preparación sigue funcionando con los casos autorizados si Gemini falla. Consulta `SOLUCION.md` para ver las decisiones, pruebas, trade-offs y riesgos antes de producción.
9. Bonus reutilizable
`modulo/agent.md` mantiene las mismas instrucciones de comportamiento de `agent/prompt.md`. `modulo/skill/registro-proveedor/SKILL.md` contiene el mismo conocimiento de `src/knowledge/registro-proveedor.md`. `modulo/tools/proveedor.ts` reexporta la implementación real de `src/tools/proveedor.ts`, sin duplicar funciones ni depender del servidor HTTP.
Esta carpeta permite reutilizar las piezas dentro del proyecto o manteniendo las dependencias originales. Para distribuirla por separado como paquete independiente todavía habría que empaquetar el código común, sus tipos y dependencias.