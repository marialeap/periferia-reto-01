import { z } from "zod";
import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync, appendFileSync, copyFileSync } from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export type Contexto = { directory: string; sessionId: string; fecha?: string; permitirEnvio?: string };
type ErrorControlado = { ok: false; error: string };
type Respuesta<T> = { ok: true; data: T } | ErrorControlado;
export type Campo = { etiqueta: string; estado: "lleno" | "faltante" | "requiere_confirmacion"; valor: string; ruta_maestro: string | null; confianza: number; nota?: string };
export type Mapeo = { llenos: Campo[]; faltantes: Campo[]; requiere_confirmacion: Campo[]; todos: Campo[] };
export type Soporte = { tipo: string; estado: "presente" | "vencido" | "ausente"; archivo?: string; vigencia_hasta?: string | null };
export type Caso = { id: string; de: string; pais: string; cliente: string; formato: "xlsx" | "pdf" | "portal"; asunto: string; cuerpo: string; adjuntos: string[] };
export type PlantillaExcel = { hoja: string; celda_etiqueta: string; etiqueta: string; celda_valor: string }[];
export type PlantillaPdf = { etiqueta: string; obligatorio: boolean }[];
export type Lectura = { pais: string; cliente: string; formato: Caso["formato"]; campos: string[]; soportes: string[]; plantilla: PlantillaExcel | PlantillaPdf; advertencias: string[] };
export type ToolObject<A> = { description: string; args: Record<string, z.ZodTypeAny>; execute: (args: A, ctx: Contexto) => Promise<string> };

const CASOS = "fixtures/reto-01/casos";
const REPO = "fixtures/reto-01/repositorio";
const GLOSARIO = "fixtures/reto-01/glosario-campos.json";
const RUTA_CASO = z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/, "Identificador de caso inválido");
const fechaHoy = () => process.env.FECHA_EVALUACION || new Date().toISOString().slice(0,10);
export function casosDisponibles(directory: string): string[] {
  try { return readdirSync(path.join(directory, CASOS), { withFileTypes: true }).filter(x => x.isDirectory() && RUTA_CASO.safeParse(x.name).success).map(x => x.name).sort(); } catch { return []; }
}
function rutaCaso(caso: string, ctx: Contexto) {
  const nombre = RUTA_CASO.parse(caso);
  if (!casosDisponibles(ctx.directory).includes(nombre)) throw new Error("Caso inexistente");
  return path.join(ctx.directory, CASOS, nombre);
}
function leerJSON(file: string): unknown { return JSON.parse(readFileSync(file, "utf8")); }
function archivoSeguro(root: string, relative: string): string {
  if (path.basename(relative) !== relative || relative.includes("..")) throw new Error("Archivo de soporte no autorizado");
  return path.join(root, relative);
}
function esquemaCaso(c: unknown): Caso {
  return z.object({
    id: z.string().min(1), de: z.string(), pais: z.string().length(2), cliente: z.string().min(1),
    formato: z.enum(["xlsx", "pdf", "portal"]), asunto: z.string(), cuerpo: z.string(), adjuntos: z.array(z.string()).default([])
  }).parse(c);
}
function parsePlantilla(formato: Caso["formato"], data: unknown): PlantillaExcel | PlantillaPdf {
  if (formato === "xlsx") return z.array(z.object({ hoja: z.string().min(1), celda_etiqueta: z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/), etiqueta: z.string().min(1), celda_valor: z.string().regex(/^[A-Z]{1,3}[1-9]\d*$/) })).parse(data);
  return z.array(z.object({ etiqueta: z.string().min(1), obligatorio: z.boolean() })).parse(data);
}
function cargar(caso: string, ctx: Contexto): { solicitud: Caso; plantilla: PlantillaExcel | PlantillaPdf; soportes: string[]; advertencias: string[] } {
  const dir = rutaCaso(caso, ctx);
  const solicitud = esquemaCaso(leerJSON(path.join(dir, "solicitud.json")));
  const soportes = z.array(z.string().regex(/^[a-z_0-9]+$/)).parse(leerJSON(path.join(dir, "soportes-exigidos.json")));
  let plantilla: PlantillaExcel | PlantillaPdf = [];
  const advertencias: string[] = [];
  try {
    const name = solicitud.formato === "xlsx" ? "plantilla-celdas.json" : "plantilla-campos.json";
    plantilla = parsePlantilla(solicitud.formato, leerJSON(path.join(dir, name)));
  } catch {
    advertencias.push("Plantilla ausente o corrupta; no es posible completar el formulario, pero se pueden revisar los soportes.");
  }
  return { solicitud, plantilla, soportes, advertencias };
}
function etiquetas(p: PlantillaExcel | PlantillaPdf): string[] { return p.map(x => x.etiqueta); }
function leerValor(obj: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((acc, part) => {
    if (typeof acc !== "object" || acc === null || !Object.prototype.hasOwnProperty.call(acc, part)) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, obj);
}
function clasificar(caso: string, ctx: Contexto): Mapeo {
  const c = cargar(caso, ctx);
  const diccionario = z.record(z.string()).parse(leerJSON(path.join(ctx.directory, GLOSARIO)));
  const maestro: unknown = leerJSON(path.join(ctx.directory, REPO, "maestro.json"));
  const todos: Campo[] = etiquetas(c.plantilla).map(etiqueta => {
    const key = diccionario[etiqueta];
    if (!key) return { etiqueta, estado: "faltante", valor: "", ruta_maestro: null, confianza: 0, nota: "Sin equivalencia en glosario" };
    const valor = leerValor(maestro, key);
    if (valor === undefined || valor === null || valor === "") return { etiqueta, estado: "faltante", valor: "", ruta_maestro: null, confianza: 0, nota: "Sin valor en el maestro" };
    const texto = String(valor);
    const extran = key === "nit" && c.solicitud.pais !== "CO";
    const ambiguo = /identificaci[oó]n tributaria|n[uú]mero de identificaci[oó]n fiscal/i.test(etiqueta);
    const estado = extran || ambiguo ? "requiere_confirmacion" as const : "lleno" as const;
    const tipo = ({ CO: "NIT", EC: "RUC", PE: "RUC", PA: "RUC", HN: "RTN" } as Record<string,string>)[c.solicitud.pais] || "identificador tributario";
    return { etiqueta, estado, valor: texto, ruta_maestro: key, confianza: estado === "lleno" ? 1 : 0.65,
      ...(estado === "requiere_confirmacion" ? { nota: extran ? `Identificador extranjero: plantilla pide ${tipo}; fuente corresponde a NIT colombiano. Validar con humano.` : `Etiqueta ambigua: validar ${tipo} antes de usar.` } : {}) };
  });
  return { llenos: todos.filter(x => x.estado === "lleno"), faltantes: todos.filter(x => x.estado === "faltante"), requiere_confirmacion: todos.filter(x => x.estado === "requiere_confirmacion"), todos };
}
function fechaValida(s: string | null | undefined): boolean { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const d = new Date(s + "T00:00:00Z"); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0,10) === s; }
function listarSoportes(caso: string, ctx: Contexto): Soporte[] {
  const { soportes } = cargar(caso, ctx);
  const index = z.array(z.object({ tipo: z.string(), archivo: z.string(), vigencia_hasta: z.string().nullable() })).parse(leerJSON(path.join(ctx.directory, REPO, "soportes/index.json")));
  return soportes.map(tipo => {
    const doc = index.find(x => x.tipo === tipo);
    if (!doc) return { tipo, estado: "ausente" };
    const file = archivoSeguro(path.join(ctx.directory, REPO, "soportes"), doc.archivo);
    if (!existsSync(file)) return { tipo, estado: "ausente" };
    const hoy = ctx.fecha ?? fechaHoy();
    const vencido = doc.vigencia_hasta !== null && (!fechaValida(doc.vigencia_hasta) || doc.vigencia_hasta < hoy);
    return { tipo, estado: vencido ? "vencido" : "presente", archivo: doc.archivo, vigencia_hasta: doc.vigencia_hasta };
  });
}
function directorioOut(caso: string, ctx: Contexto) {
  const dir = rutaCaso(caso, ctx);
  void dir;
  const out = path.join(ctx.directory, "out", caso);
  mkdirSync(out, { recursive: true });
  return out;
}
function auditar(ctx: Contexto, caso: string | undefined, herramienta: string, ok: boolean, resumen: string) {
  const row = JSON.stringify({ ts: new Date().toISOString(), sessionId: ctx.sessionId, herramienta, ok, resumen }) + "\n";
  try {
    const global = path.join(ctx.directory, "out"); mkdirSync(global, { recursive: true }); appendFileSync(path.join(global, "log.jsonl"), row);
    if (caso && RUTA_CASO.safeParse(caso).success && casosDisponibles(ctx.directory).includes(caso)) appendFileSync(path.join(directorioOut(caso, ctx), "log.jsonl"), row);
  } catch { /* auditoría no impide una respuesta controlada */ }
}
async function seguro<T>(nombre: string, caso: string, ctx: Contexto, callback: () => Promise<T> | T): Promise<string> {
  try {
    const data = await callback();
    auditar(ctx, caso, nombre, true, "Herramienta completada; sin valores sensibles en log");
    return JSON.stringify({ ok: true, data } satisfies Respuesta<T>);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Error no identificado";
    const publicMessage = /Caso inexistente|Identificador de caso inválido|Plantilla|formato no soportado|Requiere confirmación explícita|Falta archivo/.test(message) ? message : "No se pudo procesar el caso o sus archivos son inválidos";
    auditar(ctx, caso, nombre, false, publicMessage);
    return JSON.stringify({ ok: false, error: publicMessage } satisfies ErrorControlado);
  }
}
function limpiaPDF(s: string): string { return s.replace(/[\u2010-\u2015]/g, "-").replace(/[\u2022]/g, "-").replace(/[^\u0020-\u007E\u00A0-\u00FF]/g, "?"); }

export const leer_solicitud: ToolObject<{caso:string}> = {
  description: "Lee la solicitud, país, formato y etiquetas/soportes requeridos del caso autorizado.",
  args: { caso: RUTA_CASO.describe("Carpeta exacta en fixtures/reto-01/casos") },
  async execute({caso},ctx) { return seguro("proveedor_leer_solicitud",caso,ctx,() => {
    const { solicitud, plantilla, soportes, advertencias } = cargar(caso,ctx);
    return { pais: solicitud.pais, cliente: solicitud.cliente, formato: solicitud.formato, campos: etiquetas(plantilla), soportes, plantilla, advertencias } satisfies Lectura;
  }); }
};
export const mapear_campos: ToolObject<{caso:string; campos:string[]}> = {
  description: "Resuelve glosario/maestro y clasifica llenos, faltantes y confirmaciones por país sin inventar datos.",
  args: { caso: RUTA_CASO.describe("Carpeta exacta del caso"), campos: z.array(z.string()).default([]).describe("Etiquetas solicitadas, validadas contra la plantilla oficial") },
  async execute({caso,campos},ctx) { return seguro("proveedor_mapear_campos",caso,ctx,() => {
    const permitido = etiquetas(cargar(caso,ctx).plantilla);
    if (campos.some(c => !permitido.includes(c))) throw new Error("Campos no presentes en plantilla del caso");
    const m = clasificar(caso,ctx);
    if (!campos.length) return m;
    const todos = m.todos.filter(x=>campos.includes(x.etiqueta));
    return {todos, llenos:todos.filter(x=>x.estado==="lleno"),faltantes:todos.filter(x=>x.estado==="faltante"),requiere_confirmacion:todos.filter(x=>x.estado==="requiere_confirmacion")};
  }); }
};
export const generar_formulario: ToolObject<{caso:string; mapeo?:unknown}> = {
  description: "Genera Excel en celdas exactas, PDF en orden de plantilla o valores copiados para portal.",
  args: { caso: RUTA_CASO.describe("Carpeta exacta del caso"), mapeo: z.unknown().optional().describe("Mapeo previo de campos; se vuelve a comprobar en el servidor") },
  async execute({caso},ctx) { return seguro("proveedor_generar_formulario",caso,ctx,async () => {
    const { solicitud, plantilla, advertencias } = cargar(caso,ctx);
    const mapeo = clasificar(caso,ctx);
    const out = directorioOut(caso,ctx);
    writeFileSync(path.join(out,"faltantes.md"), `# Faltantes — ${caso}\n\n${mapeo.faltantes.map(x=>`- ${x.etiqueta}`).join("\n") || "Ninguno"}\n\n## Requieren confirmación\n${mapeo.requiere_confirmacion.map(x=>`- ${x.etiqueta}: ${x.nota}`).join("\n") || "Ninguno"}\n`);
    if (advertencias.length) throw new Error("Plantilla ausente o corrupta");
    if (solicitud.formato === "xlsx") {
      const workbook = new ExcelJS.Workbook();
      const excel = plantilla as PlantillaExcel;
      for (const f of excel) {
        let sheet = workbook.getWorksheet(f.hoja); if (!sheet) sheet = workbook.addWorksheet(f.hoja);
        const dato = mapeo.todos.find(x => x.etiqueta === f.etiqueta);
        const label = sheet.getCell(f.celda_etiqueta); label.value = f.etiqueta; label.font = { bold:true, color: {argb:"FF1D6A5A"} };
        const cell = sheet.getCell(f.celda_valor); cell.value = dato?.valor || "PENDIENTE"; cell.alignment = { wrapText: true };
        if (!dato || dato.estado !== "lleno") cell.fill = {type:"pattern",pattern:"solid",fgColor:{argb:dato?.estado === "requiere_confirmacion" ? "FFFFF0CC" : "FFFFDEDE"}};
        sheet.getColumn(label.col).width = Math.max(sheet.getColumn(label.col).width ?? 0, 27);
        sheet.getColumn(cell.col).width = Math.max(sheet.getColumn(cell.col).width ?? 0, 52);
      }
      const obs = workbook.addWorksheet("Validaciones"); obs.columns = [{header:"Campo",key:"campo",width:42},{header:"Estado",key:"estado",width:26},{header:"Fuente / observación",key:"fuente",width:75}];
      for (const f of mapeo.todos) obs.addRow({campo:f.etiqueta,estado:f.estado,fuente:f.nota || f.ruta_maestro || "Sin fuente"}); obs.getRow(1).font={bold:true};
      const buf = await workbook.xlsx.writeBuffer(); writeFileSync(path.join(out,"formulario.xlsx"),Buffer.from(buf));
      return { ruta:`out/${caso}/formulario.xlsx`, formato:"xlsx", faltantes:mapeo.faltantes.length, confirmaciones:mapeo.requiere_confirmacion.length };
    }
    if (solicitud.formato === "pdf") {
      const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica); const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      let page = pdf.addPage([595,842]); let y = 793;
      const text = (s:string, big=false) => { if (y < 85) {page=pdf.addPage([595,842]);y=790;} const safe=limpiaPDF(s); const size=big?16:10; page.drawText(safe.slice(0,112),{x:48,y,size,font:big?bold:font,color:rgb(0.1,0.26,0.28)});y-=big?35:22; };
      text("REGISTRO COMO PROVEEDOR - FORMULARIO",true);
      text(`Cliente: ${solicitud.cliente} (${solicitud.pais})`); y-=12;
      for(const item of (plantilla as PlantillaPdf)) { const field=mapeo.todos.find(x=>x.etiqueta===item.etiqueta);text(`${item.etiqueta}: ${field?.valor || "PENDIENTE"}`); if(field && field.estado!=="lleno") text(`  ESTADO: ${field.estado}${field.nota ? " - verificar con humano" : ""}`); }
      y-=15; text("Este documento NO equivale a una firma o aprobacion legal.");
      writeFileSync(path.join(out,"formulario.pdf"),await pdf.save());
      return { ruta:`out/${caso}/formulario.pdf`, formato:"pdf", faltantes:mapeo.faltantes.length, confirmaciones:mapeo.requiere_confirmacion.length };
    }
    const lines = [`# Valores para portal - ${solicitud.cliente}`, "", "FORMATO NO SOPORTADO: el agente no accede al portal.", "El humano introduce credenciales y realiza el clic Enviar.", ""];
    for(const f of mapeo.todos) lines.push(`- ${f.etiqueta}: ${f.valor || "PENDIENTE"} (${f.estado}${f.nota ? ": "+f.nota : ""})`);
    writeFileSync(path.join(out,"valores-portal.md"),lines.join("\n")+"\n");
    return { ruta:`out/${caso}/valores-portal.md`, formato:"portal", mensaje:"formato no soportado", faltantes:mapeo.faltantes.length, confirmaciones:mapeo.requiere_confirmacion.length };
  }); }
};
export const armar_paquete: ToolObject<{caso:string}> = {
  description: "Arma carpeta con formulario, soportes, checklist y correo borrador, bloqueando ausentes/vencidos.",
  args: { caso:RUTA_CASO.describe("Carpeta exacta del caso") },
  async execute({caso},ctx) { return seguro("proveedor_armar_paquete",caso,ctx,async () => {
    const { solicitud } = cargar(caso,ctx); const out=directorioOut(caso,ctx);const paquete=path.join(out,"paquete");mkdirSync(paquete,{recursive:true});
    const generated = JSON.parse(await generar_formulario.execute({caso},ctx)) as Respuesta<{ruta:string;formato:string}>;
    if(generated.ok) {const src=path.join(ctx.directory,generated.data.ruta); if(existsSync(src))copyFileSync(src,path.join(paquete,path.basename(src)));}
    const soportes=listarSoportes(caso,ctx); const map=clasificar(caso,ctx);
    for(const s of soportes) if(s.archivo && s.estado!=="ausente") copyFileSync(archivoSeguro(path.join(ctx.directory,REPO,"soportes"),s.archivo),path.join(paquete,s.archivo));
    const listo_para_firma = soportes.every(s=>s.estado==="presente") && generated.ok && solicitud.formato!=="portal";
    const checklist = soportes.map(s=>({tipo:s.tipo,estado:s.estado,vigencia_hasta:s.vigencia_hasta ?? null}));
    const md=[`# Checklist del paquete — ${solicitud.cliente}`, "",`Fecha: ${ctx.fecha??fechaHoy()}`,`Formato: ${solicitud.formato}`,`Listo para firma: ${listo_para_firma ? "SI (requiere revisión/firma humana)" : "NO"}`,"", "## Soportes exigidos",...soportes.map(s=>`- ${s.tipo}: **${s.estado}**${s.vigencia_hasta?` (vence ${s.vigencia_hasta})`:""}`),"","## Campos faltantes (no bloquean por sí solos)",...map.faltantes.map(f=>`- ${f.etiqueta}`),"","## Campos que requieren confirmación",...map.requiere_confirmacion.map(f=>`- ${f.etiqueta}: ${f.nota}`),"","## Notas",...(generated.ok ? [] : ["- No se pudo generar formulario; revisar plantilla"]),...(solicitud.formato==="portal"?["- Portal no automatizado: humano debe operar el portal"]:[])];
    writeFileSync(path.join(paquete,"checklist.md"),md.join("\n")+"\n");
    const correo=[`Asunto: Registro como proveedor - ${solicitud.cliente}`,"",`Estimado equipo de ${solicitud.cliente}:`,"", "Preparamos el formulario y los soportes disponibles para su revisión.","",`Estado documental: ${listo_para_firma?"en revisión para firma":"pendiente de regularización"}.`,"", "Este es un borrador. No se ha enviado ningún correo ni firmado ningún documento.","", "Saludos,", "Equipo administrativo de Periferia IT Group"];
    writeFileSync(path.join(paquete,"borrador-correo.md"),correo.join("\n")+"\n");
    return { ruta:`out/${caso}/paquete`, listo_para_firma, checklist, faltantes:map.faltantes.map(x=>x.etiqueta), requiere_confirmacion:map.requiere_confirmacion.map(x=>x.etiqueta), formato:solicitud.formato };
  }); }
};
export const simular_envio: ToolObject<{caso:string;confirmado:boolean}> = {
  description: "Simula el envío únicamente si hubo confirmación humana explícita en el siguiente turno; no envía nada real.",
  args: { caso:RUTA_CASO.describe("Carpeta exacta del caso"), confirmado:z.boolean().describe("Confirmación explícita recibida en turno inmediatamente posterior") },
  async execute({caso,confirmado},ctx) { return seguro("proveedor_simular_envio",caso,ctx,() => {
    if(!confirmado || ctx.permitirEnvio!==caso) throw new Error("Requiere confirmación explícita");
    const p=directorioOut(caso,ctx); if(!existsSync(path.join(p,"paquete","checklist.md"))) throw new Error("No existe paquete preparado");
    const ruta=path.join(p,"ENVIO-SIMULADO.md");writeFileSync(ruta,`# Envío simulado\n\nCaso: ${caso}\nFecha: ${new Date().toISOString()}\nConfirmado por sesión: ${ctx.sessionId}\nNo se envió correo ni se firmó documento.\n`);
    return { ruta:`out/${caso}/ENVIO-SIMULADO.md`, simulado:true };
  }); }
};

export const herramientas = { proveedor_leer_solicitud:leer_solicitud, proveedor_mapear_campos:mapear_campos, proveedor_generar_formulario:generar_formulario, proveedor_armar_paquete:armar_paquete, proveedor_simular_envio:simular_envio };
export type ToolName=keyof typeof herramientas;
export async function ejecutarHerramienta(nombre:ToolName, argumentos:unknown, ctx:Contexto):Promise<string> {
  const tool= herramientas[nombre];
  try {
    const schema=z.object(tool.args); const parsed=schema.parse(argumentos);
    // Parseado dinámico con esquemas de Zod; execute recibe el tipo restringido por cada herramienta.
    return await (tool.execute as (args:Record<string,unknown>,ctx:Contexto)=>Promise<string>)(parsed,ctx);
  } catch { return JSON.stringify({ok:false,error:"Argumentos de herramienta inválidos"}); }
}
