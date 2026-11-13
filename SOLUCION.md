SOLUCIÓN — Reto técnico 01: Registro como Proveedor

1. El problema:
El equipo administrativo de Periferia dedica tiempo a buscar y copiar datos que ya existen para registrar a la empresa como proveedor de distintos clientes; esto retrasa el trámite y aumenta el riesgo de errores en información importante.
Construí una aplicación donde la analista selecciona o menciona una solicitud, revisa qué datos se encontraron y cuáles faltan, y obtiene el formulario y el paquete de soportes preparados para revisión. La aplicación no firma documentos, no envía correos reales ni ingresa a portales externos.

2. Arquitectura: cómo se conectan las partes
Preferí una aplicación web sencilla, accesible desde un navegador, con la lógica de negocio fuera de la interfaz.
```text
Usuario / analista
    │
    ▼
Chat web — web/index.html
    │ HTTP /api/chat
    ▼
Servidor — src/server.ts (Node.js + Express, TypeScript)
    ├── Sesión, historial, validación y confirmación
    ├── Adaptador del modelo — src/llm/adapter.ts, src/llm/gemini.ts
    │       └── Instrucciones del agente — agent/prompt.md
    └── Herramientas tipadas con Zod — src/tools/proveedor.ts
            ├── Leen los archivos originales — fixtures/reto-01/ (lectura)
            └── Generan resultados — out/<caso>/ (escritura)
                    ├── formulario.xlsx / formulario.pdf / valores-portal.md
                    ├── faltantes.md, paquete/, paquete.zip
                    ├── checklist, borrador de correo
                    └── registros de herramientas y ENVIO-SIMULADO.md, si se confirma
```
El documento `src/knowledge/registro-proveedor.md` contiene el conocimiento del proceso: formatos, países, reglas sobre soportes y límites del agente. Lo mantuve separado de las instrucciones de comportamiento (`agent/prompt.md`) y del código que ejecuta las validaciones (`src/tools/proveedor.ts`). En la versión actual el adaptador carga el prompt; el archivo de conocimiento sirve como referencia del proyecto, no como una base consultada dinámicamente por Gemini.

Usé Zod para validar argumentos, ExcelJS para escribir celdas y hojas de Excel, pdf-lib para producir el PDF y JSZip para el paquete descargable.

3. Ciclo del agente y confirmación humana:
Cuando alguien escribe «Procesa el caso ec-corp-andina», el sistema identifica un caso autorizado y ejecuta estas operaciones:
`proveedor_leer_solicitud`: lee el correo, la plantilla, el país y los soportes requeridos.
`proveedor_mapear_campos`: compara etiquetas con el glosario y el maestro; separa campos llenos, faltantes y pendientes de confirmar.
`proveedor_generar_formulario`: genera el formato que pidió el cliente.
`proveedor_armar_paquete`: adjunta soportes disponibles, checklist y borrador de correo, y calcula si está listo para firma.
La interfaz presenta las llamadas ejecutadas y un resumen de cada resultado. La sesión y el historial se mantienen en memoria mientras el proceso de servidor está activo; las herramientas también registran sus ejecuciones en `out/log.jsonl` y en el registro de cada caso. Las funciones están diseñadas para devolver un resultado de éxito o error, sin trasladar una traza técnica al usuario.
Participación real del modelo: existe un adaptador para Gemini con capacidad de solicitar la herramienta inicial. Para asegurar resultados reproducibles, el procesamiento completo sigue una secuencia de herramientas TypeScript. Es una orquestación asistida por IA con flujo determinista, no un planificador completamente autónomo de cinco herramientas. Si la API no está disponible, los cuatro casos conocidos se pueden procesar sin ella.
Para limitar consumo y fallos, el backend configura un máximo de 4 iteraciones por turno, 10 solicitudes al modelo por sesión, 12 000 tokens estimados por sesión y 8 segundos de timeout por solicitud (valores predeterminados; ajustables mediante variables de entorno).
Confirmación humana: al preparar un paquete, el chat pregunta si se desea simular su envío. Solo una respuesta afirmativa en el turno inmediatamente siguiente permite generar `ENVIO-SIMULADO.md`; «cancelar» no lo genera para esa operación. Esa simulación no manda un correo ni firma nada. Puede registrarse incluso con un paquete bloqueado: no representa una aprobación ni habilita un envío real. Para producción, la autorización de firma y envío necesitaría un control adicional.

4. Modelo elegido y estimación de costo
Elegí Google Gemini (Google AI Studio) , con el modelo configurado por defecto como `gemini-3.6-flash`, porque podía probar su API sin comprar otra membresía, libre uso y quería mantener el sistema adaptable. La clave se lee en `GEMINI_API_KEY` del servidor; nunca debe subirse al repositorio. El adaptador está aislado de las reglas del negocio, de modo que cambiar el proveedor no obliga a reescribir la validación documental.
El costo depende del número de llamadas y tokens. Para dar una estimación ilustrativa, usando la tarifa estándar publicada para Gemini 3.6 Flash de USD 0,75 por millón de tokens de entrada y USD 3,75 por millón de tokens de salida (tarifas consultadas el 13 de noviembre de 2026, día de la prueba), una consulta hipotética de 2 000 tokens de entrada y 500 de salida costaría:
```text
(2 000 / 1 000 000 × 0,75) + (500 / 1 000 000 × 3,75)
= aproximadamente USD 0,0034 por llamada
```
Este importe no es una medición real del caso y no incluye alojamiento. Si se hicieran dos llamadas semejantes, serían unos USD 0,0068. Si el proyecto opera dentro de un nivel gratuito aplicable, el cargo de inferencia puede ser USD 0; si usa exclusivamente el flujo local, no consume tokens de Gemini. Antes de presupuestarlo para producción mediría tokens reales, confirmaría cuotas y precios actuales y establecería límites de gasto.
Referencia para comprobar tarifas: https://ai.google.dev/gemini-api/docs/pricing

5. Cómo abordaría un portal web
El caso de Panamá pide ingresar información en un portal web, no completar un Excel o PDF. Como el PRD indica que no se automatiza el portal real, el agente genera `valores-portal.md`: un listado ordenado de los campos y sus valores disponibles para copiar, incluyendo los que requieren revisión.
En una fase posterior estudiaría una automatización controlada con Playwright, limitada a sitios autorizados. La persona responsable iniciaría sesión e introduciría credenciales; estas estarían protegidas en un gestor, nunca en el código, prompt o logs. CAPTCHA, MFA y cambios de diseño pueden impedir la automatización y requerir intervención humana. El agente podría preparar los campos, pero el clic final en «Enviar» lo haría una persona autorizada.

6. Decisiones de diseño y alternativas descartadas
1. Reglas en TypeScript, no decisiones libres del modelo. Descarté que Gemini determine por sí solo vigencias, identificadores o aprobaciones: sería más corto de programar, pero menos verificable y podría inventar datos.
2. Archivos locales, no base de datos. El reto entrega archivos ficticios y no pide persistencia empresarial. Esta opción permitió reducir complejidad y cumplir el plazo. La contrapartida es que el disco de una instancia gratuita puede ser temporal; no sirve para un registro histórico confiable.
3. Formato propio por cliente, no un Excel universal. Utilicé ExcelJS y pdf-lib y preparé texto para el portal. Exige más rutas de generación, pero respeta la plantilla y el formato realmente pedidos.
4. Respaldo determinista, no dependencia obligatoria de Gemini. En la preparación comprobé que una API puede fallar o alcanzar sus límites. Preferí que una consulta de un caso conocido continúe con herramientas locales verificables. Esto reduce la flexibilidad de preguntas abiertas, pero aumenta la continuidad operativa.
5. Envío simulado, no correo o firma real. Aunque sería más vistoso mostrar un envío verdadero, el PRD lo excluye y exige que la decisión siga siendo humana, y considero que es correcto, porque siempre debe existir el criterio humano para toma de decisiones.
7. Supuestos al interpretar los archivos
Consideré que los cuatro casos entregados son el universo autorizado para el ejercicio y que el maestro de `fixtures/reto-01/repositorio/` es la fuente de datos de Periferia para esta demostración. No agregué empresas, datos bancarios ni documentos que no aparezcan allí.
Apliqué la regla del identificador tributario: Colombia utiliza NIT; Ecuador y Panamá, RUC; Honduras, RTN. Como el maestro solo incluye un NIT colombiano, para los países extranjeros se copia ese valor de origen marcado como «requiere confirmación», nunca presentado como un identificador local verificado.
Un campo faltante se registra y no bloquea por sí mismo el estado `listo_para_firma`; en cambio, un soporte obligatorio ausente o vencido sí lo bloquea. Los datos bancarios solo se trasladan si la plantilla los solicita y no se incluyen en el borrador de correo. La fecha de evaluación puede configurarse para repetir las pruebas.
Con las vigencias de los archivos oficiales al 13 de noviembre de 2026, los cuatro paquetes aparecen no listos para firma. No es un resultado forzado: los cuatro requieren una Cámara de Comercio que ya venció, y algunos tienen otros soportes pendientes.
8. Cobertura del PRD y tareas pendientes para producción
Historia / componente	Estado	Evidencia y qué faltaría
HU-1: leer solicitud	Hecho	Lee casos, formatos, campos y soportes. Para producción: lectores de adjuntos reales más variados.
HU-2: mapear campos	Hecho	Consulta glosario y maestro; distingue llenos, faltantes y confirmaciones. Para producción: control de calidad del maestro y más sinónimos.
HU-3: generar formulario	Hecho	Excel en celdas para Colombia/Honduras, PDF para Ecuador y Markdown copiable para Panamá. Para producción: plantillas originales complejas y portales reales.
HU-4: armar paquete	Hecho para el simulacro	Incluye soportes, checklist, borrador y confirmación de envío simulado. Para producción: aprobaciones autenticadas y bloqueo previo a cualquier envío real.
HU-5: manejo de errores	Parcial	Se prueban casos inexistentes, rutas no permitidas y plantillas corruptas. Faltan pruebas integrales de HTTP, caídas de infraestructura y concurrencia.
Chat, trazabilidad y modelo	Parcial	Chat, historial y llamadas visibles funcionan; el modelo participa de forma limitada y la ejecución principal es determinista. Falta una orquestación LLM más general para producción.
Autenticación e integraciones corporativas	No hecho	Fuera del alcance del reto; serían necesarias con datos reales.
Se ejecutaron las comprobaciones de TypeScript, pruebas automatizadas y `demo.ts`, y se probaron los cuatro casos mediante la aplicación pública en Render. Se verificaron descargas y los caminos de confirmación y cancelación en el chat. `demo.ts` procesa los fixtures sin consumir Gemini, por lo que permite reproducir las reglas aunque la API falle.
Aplicación pública: https://periferia-reto-01-0uk6.onrender.com/
9. Uso de inteligencia artificial durante la construcción
Utilicé ChatGPT (OpenAI) para ayudarme a analizar el PRD, organizar requisitos, generar código TypeScript, proponer validaciones y pruebas, corregir errores de compilación y mejorar la documentación. Usé Gemini como componente de la aplicación, no como sustituto de las reglas de negocio.
Las decisiones y verificaciones no se dieron por buenas solo porque una IA las sugirió. Contrasté los resultados con los archivos oficiales y probé los cuatro casos desde Render. También ajusté propuestas iniciales: descarté crear un Excel para todos los países, depender completamente del modelo para consultas verificables y ofrecer botones de descarga para archivos que no existen.
El principal aprendizaje de esta prueba es que la IA acelera la construcción, pero el cumplimiento del PRD, las pruebas y la revisión humana siguen siendo indispensables.
10. Riesgos de una implementación real y cómo los mitigaría
Datos desactualizados. El maestro y los soportes deben tener un responsable, historial de cambios y procesos de actualización; de lo contrario, el agente reproduciría información incorrecta.
Información sensible. Para utilizar documentos reales necesitaríamos acceso autenticado, permisos por cliente y rol, cifrado y una gestión de secretos adecuada; el enlace público actual solo utiliza datos ficticios.
Errores e instrucciones maliciosas. Los correos y adjuntos se tratan como datos, no como órdenes al agente. Seguiría ampliando pruebas de entradas inválidas, inyección de instrucciones, errores de API y fallos de descarga.
Gastos y disponibilidad del modelo. Mantendría límites por usuario, monitoreo de cuotas y gasto, timeout y respuestas controladas cuando Gemini no esté disponible.
Almacenamiento y auditoría. Sustituiría el disco temporal por almacenamiento cifrado y duradero, con auditoría inmutable, protección ante procesos simultáneos y retención definida.
Aprobación y envío. Separaría claramente las etapas de preparación, aprobación, firma y envío; identificaría al aprobador y bloquearía una acción real si faltan autorizaciones o documentos exigidos.
---
Alcance de la entrega: prototipo funcional con datos ficticios, repositorio de código, pruebas automatizadas, `demo.ts`, documentación y URL pública. La carpeta opcional `modulo/` reúne instrucciones, conocimiento y acceso a las mismas herramientas para reutilización dentro del proyecto; no sustituye todavía un paquete independiente listo para publicar en npm.