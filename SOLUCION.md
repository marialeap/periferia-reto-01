# SOLUCIÓN — Reto técnico 01

## 1. Problema

El equipo administrativo de Periferia transcribe repetidamente datos corporativos a formularios heterogéneos para registrarse como proveedor. Esto genera retrasos y errores; un agente trazable prepara documentos y soportes para revisión humana.

## 2. Arquitectura

```text
Front web (web/index.html)
  -> API Express (src/server.ts): sesión, ciclo, confirmación, descargas
      -> Adaptador LLM (src/llm/adapter.ts + gemini.ts)
      -> System prompt (agent/prompt.md)
      -> Reglas/conocimiento (src/knowledge/registro-proveedor.md)
      -> Herramientas tipadas con Zod (src/tools/proveedor.ts)
          -> fixtures/reto-01 (solo lectura)
          -> out/<caso> (formularios, soportes, checklist, auditoría)
```

La separación de comportamiento, conocimiento y ejecución evita introducir valores generados por el modelo en las reglas del negocio.

## 3. Ciclo del agente

`POST /api/chat` recibe sesión y mensaje; valida el identificador y resuelve el caso permitido. Si hay API configurada, llama al adaptador Gemini con función declarada; valida la llamada y ejecuta la herramienta en TypeScript. Para asegurar la entrega, ejecuta una secuencia determinista de herramientas: leer → mapear → generar → armar. La respuesta final se construye exclusivamente con datos devueltos por herramientas, sin inventar valores. Si falla Gemini o hay timeout, las herramientas siguen funcionando. Máximo 4 iteraciones y 10 invocaciones de LLM por sesión (configurables). Historial en memoria y trazas visibles en el frontend y `out/log.jsonl`.

**Confirmación humana:** después de armar el paquete se solicita expresamente autorización para **simular** el envío. Únicamente el mensaje afirmativo inmediatamente posterior activa `proveedor_simular_envio`; se valida una capacidad temporal ligada a sesión+caso. Nunca se firma, envía correo real o accede a portales. El checklist distingue `listo_para_firma` aunque la simulación de envío sea una prueba.

## 4. Modelo y costos

Google Gemini (`gemini-3.6-flash` configurado), vía REST sobre HTTPS detrás de adaptador propio. Se escogió por disponibilidad observada en cuenta gratuita y facilidad de cambio. Costo exacto por caso depende del modelo, tokens y cuotas de proyecto; no se inventa un monto fijo. La ruta determinista no realiza llamadas ni genera cargo de IA. Para producción deben comprobarse precios y cuota vigentes antes de presupuestar. Alternativa descartada: lógica de negocio escrita por el propio LLM (puede alucinar y ser inconsistente).

## 5. Diseño para portales web (no implementado)

Emplearía Playwright con navegador controlado y lista blanca de dominios. Las credenciales vivirían en un gestor de secretos y las ingresaría un humano en sesión autorizada; jamás en repositorio, prompt ni logs. CAPTCHA/MFA y cambios del sitio requieren intervención humana. El agente puede preparar valores y verificar campos con una captura, pero el humano introduce credenciales y hace el clic final de Enviar. Nunca automatizar sin autorización explícita del usuario.

## 6. Decisiones y trade-offs

1. **Reglas deterministas vs decisión del LLM:** el LLM interpreta; TypeScript decide los estados y genera archivos. Más código pero auditable y fiable.
2. **Archivos locales vs base de datos:** fixtures de solo lectura y `out/` cumplen reto; menos complejidad, pero Render tiene disco efímero.
3. **ExcelJS + pdf-lib vs una plantilla universal:** herramientas distintas permiten respetar hojas/celdas y orden PDF; aumenta dependencias pero cumple formatos.
4. **Fallback local vs dependencia exclusiva de Gemini:** mantiene operaciones cuando hay cuota/timeout; se limita a casos conocidos y se indica en respuesta.
5. **Sin portal real:** seguridad y alcance P2; se genera un Markdown copiables y se documenta diseño.

## 7. Supuestos

Los cuatro casos y el maestro son los únicos datos autorizados. El índice de soportes define vencimiento (`null` significa sin fecha registrada). La fecha se toma en UTC, salvo `FECHA_EVALUACION` para pruebas repetibles. Un campo `faltante` no bloquea por sí solo firma (RN3); soportes ausentes/vencidos sí. Para extranjeros, el NIT colombiano se representa con nota de `requiere_confirmacion`. La confirmación humana de envío simulado no equivale a autorización para firma de un paquete bloqueado.

## 8. Cobertura

| Historia | Estado | Evidencia |
|---|---|---|
| HU-1 Lectura de solicitud, formatos, soportes | Hecho | `proveedor_leer_solicitud`, demo, tests |
| HU-2 Glosario, maestro, faltantes, confirmaciones | Hecho | `proveedor_mapear_campos` |
| HU-3 Excel en celdas exactas, PDF, portal Markdown | Hecho | `proveedor_generar_formulario` |
| HU-4 Paquete, checklist, correo, confirmación simulada | Hecho | `proveedor_armar_paquete`, `proveedor_simular_envio` |
| HU-5 Errores controlados, corrupción y caso inexistente | Hecho (base) | `seguro()`, tests |
| Front con historial, tool calls y confirmación | Hecho | `web/index.html` |
| Persistencia durable y seguridad empresarial | No incluido | Fuera de alcance: autenticación, roles, BD |

## 9. Uso de IA para construir

Se utilizó **ChatGPT (OpenAI)** para analizar PRD, diseñar arquitectura, generar y revisar TypeScript, pruebas y documentación. La usuaria definió requisitos de resiliencia, casos adversariales y estrategia de entrega. Se descartó confiar vigencias, identificación tributaria o envío a respuestas libres de IA; esas decisiones se codificaron determinísticamente. La implementación se debe verificar localmente con `npm test`, `npm run demo` y pruebas web antes de entregar.

## 10. Riesgos de producción

- **Credenciales/PII:** secreto en servidor; autenticación/roles y autorización de lectura en producción.
- **Inyección por correo:** archivos se tratan como datos, no instrucciones; tool args validados por Zod y caso permitido.
- **Abuso de API:** máximo de iteraciones y llamadas por sesión; requiere rate limiting, controles presupuestarios y monitoreo antes de producción.
- **Vigencia falsa:** el maestro debe tener dueño de dato, actualizaciones verificadas y control de versiones.
- **Filesystem efímero:** mover `out` a almacenamiento persistente cifrado antes de producción; tareas idempotentes.
- **Confirmación:** para producción se exige identidad de aprobador, auditoría inmutable y doble control para datos bancarios.
- **Fallos del modelo:** timeout, registro técnico limitado, respaldo verificado, sin exponer claves.

## 11. Entrega

Código de este repositorio, `demo.ts` sin modelo, tests, documentación, URL pública a completar en README. `fixtures/` se copian intactos. `out/`, `.env` y `node_modules/` no se publican.
