import express, { type ErrorRequestHandler } from "express";
import path from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { z } from "zod";
import JSZip from "jszip";
import { GeminiAdapter } from "./llm/gemini";
import type { AgentMessage, AgentToolDefinition } from "./llm/adapter";
import { armar_paquete, casosDisponibles, ejecutarHerramienta, generar_formulario, leer_solicitud, mapear_campos, simular_envio, type Contexto, type ToolName } from "./tools/proveedor";

const ROOT = process.cwd();
const app = express();
app.disable("x-powered-by");
app.use(express.json({limit:"12kb"}));
app.use(express.static(path.join(ROOT,"web"),{index:"index.html"}));
const adapter = new GeminiAdapter();
const schema = z.object({sessionId:z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/),message:z.string().trim().min(1).max(1000)});
const MAX_ITER = Math.max(1,Math.min(Number(process.env.MAX_ITERACIONES||4),8));
const MAX_TURNS = Math.max(1,Math.min(Number(process.env.MAX_TURNOS_LLM||10),30));
const sessions = new Map<string,{history:Array<{role:"user"|"assistant";text:string;toolCalls:Trace[]}>;pending?:string;llmTurns:number}>();
type Trace = {name:string;args:Record<string,unknown>;ok:boolean;summary:string;source:"modelo"|"reglas"};
const names = ["proveedor_leer_solicitud","proveedor_mapear_campos","proveedor_generar_formulario","proveedor_armar_paquete","proveedor_simular_envio"] as const;
const defs:AgentToolDefinition[] = names.slice(0,4).map(name=>({
  name, description: {
    proveedor_leer_solicitud:"Lee correo, plantilla y soportes exigidos de un caso autorizado.",
    proveedor_mapear_campos:"Mapea etiquetas de la plantilla al maestro; indica faltantes y confirmaciones.",
    proveedor_generar_formulario:"Genera formulario xlsx/pdf o valores para portal del caso.",
    proveedor_armar_paquete:"Prepara paquete con checklist y borrador, verifica vigencias.",
    proveedor_simular_envio:"Acción humana de envío simulado."
  }[name],
  parameters:{type:"OBJECT",properties:{caso:{type:"STRING",description:"ID exacto de caso"}, ...(name==="proveedor_mapear_campos"?{campos:{type:"ARRAY",items:{type:"STRING"}}}:{}),...(name==="proveedor_generar_formulario"?{mapeo:{type:"OBJECT",description:"Mapeo previo verificado"}}:{})},required:["caso"]}
}));
const norm=(s:string)=>s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
function casoDeMensaje(message:string, disponibles:string[]):string|null {
  const txt=norm(message);
  const exact=disponibles.filter(c=>txt.includes(norm(c)));
  if(exact.length===1) return exact[0];
  if(exact.length>1) return null;
  const aliases:Record<string,string[]> = {
    "co-industrias-delta":["industria delta","industrias delta","colombia","delta"],
    "ec-corp-andina":["corporacion andina","corp andina","ecuador","andina"],
    "hn-agroexport-sula":["agroexport sula","honduras","sula"],
    "pa-logistica-istmo":["logistica del istmo","panama","istmo"]
  };
  const matches=disponibles.filter(c=>(aliases[c]||[]).some(v=>txt.includes(v)));
  return matches.length===1?matches[0]:null;
}
function context(sessionId:string):Contexto {return {directory:ROOT,sessionId};}
function parseResult(json:string):{ok:boolean;data?:unknown;error?:string} {
  try { return JSON.parse(json) as {ok:boolean;data?:unknown;error?:string}; }
  catch {return {ok:false,error:"La herramienta devolvió una respuesta ilegible"};}
}
function summarize(r:{ok:boolean;data?:unknown;error?:string}) {
  if(!r.ok)return r.error||"Error controlado";
  const d=r.data as Record<string,unknown>|undefined;
  const allowed=["cliente","pais","formato","ruta","listo_para_firma","campos","soportes","advertencias","faltantes","requiere_confirmacion","checklist"];
  const reduced:Record<string,unknown>={};
  for(const k of allowed)if(d&&k in d)reduced[k]=Array.isArray(d[k])?(d[k] as unknown[]).length:d[k];
  return JSON.stringify(reduced).slice(0,700);
}
async function execute(name:ToolName,args:Record<string,unknown>,ctx:Contexto,trace:Trace[],source:"modelo"|"reglas") {
  const raw=await ejecutarHerramienta(name,args,ctx);
  const r=parseResult(raw);
  trace.push({name,args:{caso:args.caso},ok:r.ok,summary:summarize(r),source});
  return r;
}
function allToolsResult(caso:string,ctx:Contexto,trace:Trace[]) {
  return async()=>{
    const read=await execute("proveedor_leer_solicitud",{caso},ctx,trace,"reglas");
    if(!read.ok)return {read,error:read.error};
    const fields=(read.data as {campos:string[]}).campos;
    const map=await execute("proveedor_mapear_campos",{caso,campos:fields},ctx,trace,"reglas");
    const form=await execute("proveedor_generar_formulario",{caso,mapeo:map.data},ctx,trace,"reglas");
    const pack=await execute("proveedor_armar_paquete",{caso},ctx,trace,"reglas");
    return {read,map,form,pack};
  };
}
async function buildZip(caso:string):Promise<void> {
  const folder=path.join(ROOT,"out",caso,"paquete");
  if(!existsSync(folder))return;
  const zip = new JSZip();
  for(const file of readdirSync(folder,{withFileTypes:true})) if(file.isFile())zip.file(file.name,readFileSync(path.join(folder,file.name)));
  const content=await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"});
  const {writeFileSync}=await import("node:fs");
  writeFileSync(path.join(ROOT,"out",caso,"paquete.zip"),content);
}
function renderSummary(caso:string, output:Awaited<ReturnType<ReturnType<typeof allToolsResult>>>, mode:string):string {
  if(output.error)return `No pude completar ${caso}: ${output.error}. Puedes continuar con otro caso.`;
  const read=output.read.data as {cliente:string;pais:string;formato:string;advertencias?:string[]};
  const map=output.map as {ok:boolean;data?:{faltantes:Array<{etiqueta:string}>;requiere_confirmacion:Array<{etiqueta:string;nota?:string}>}};
  const p=output.pack as {ok:boolean;data?:{listo_para_firma:boolean;checklist:Array<{tipo:string;estado:string}>}};
  const missing=map.data?.faltantes.map(x=>x.etiqueta)||[];
  const confirmation=map.data?.requiere_confirmacion.map(x=>x.etiqueta)||[];
  const issues=p.data?.checklist.filter(x=>x.estado!=="presente").map(x=>`${x.tipo}: ${x.estado}`)||[];
  return `${read.cliente} (${read.pais}) — formato ${read.formato.toUpperCase()}. `+
    `Formulario: ${output.form?.ok?"generado":"no generado"}. `+
    `Campos faltantes (${missing.length}): ${missing.join(", ")||"ninguno"}. `+
    `Mapeos por confirmar (${confirmation.length}): ${confirmation.join(", ")||"ninguno"}. `+
    `Soportes pendientes: ${issues.join("; ")||"ninguno"}. `+
    `Listo para firma: ${p.data?.listo_para_firma?"SÍ, pendiente de firma humana":"NO"}. `+
    `${read.formato==="portal"?"Formato portal no soportado automáticamente: valores disponibles para copiar. ":""}`+
    `${mode==="local"?"Resultados verificados por herramientas sin depender de Gemini. ":""}`+
    `Se generó el paquete para revisión. ¿Confirmas que simule el envío de este paquete? No se enviará ningún correo real.`;
}
function store(s:{history:Array<{role:"user"|"assistant";text:string;toolCalls:Trace[]}>},message:string,reply:string,trace:Trace[]) {
  s.history.push({role:"user",text:message,toolCalls:[]},{role:"assistant",text:reply,toolCalls:trace});
  if(s.history.length>30)s.history.splice(0,s.history.length-30);
}
app.get("/api/health",(_req,res)=>res.json({ok:true,provider:adapter.provider,model:adapter.model}));
app.get("/api/cases",(_req,res)=>res.json({casos:casosDisponibles(ROOT)}));
app.get("/api/sessions/:id",(req,res)=>{
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(req.params.id)){res.status(400).json({error:"Sesión inválida"});return;}
  res.json({history:sessions.get(req.params.id)?.history||[]});
});
app.post("/api/chat",async(req,res)=>{
  const valid=schema.safeParse(req.body);
  if(!valid.success){res.status(400).json({error:"Envía sessionId y message válidos."});return;}
  const {sessionId,message}=valid.data;
  if(!sessions.has(sessionId))sessions.set(sessionId,{history:[],llmTurns:0});
  const s=sessions.get(sessionId)!;
  const trace:Trace[]=[];
  const normalized=norm(message).trim();
  // Confirmación válida solo en el turno inmediatamente siguiente a la propuesta del agente.
  if(s.pending){
    const caseId=s.pending; delete s.pending;
    if(/^(si|sí|confirmo|confirmar|envia|envía|aprobar|aprobado|proceder|acepto)([.! ]*)$/i.test(normalized)){
      const r=await execute("proveedor_simular_envio",{caso:caseId,confirmado:true},{...context(sessionId),permitirEnvio:caseId},trace,"reglas");
      const reply=r.ok?`Confirmación registrada. Se creó ${String((r.data as {ruta:string}).ruta)}. Es una SIMULACIÓN; no se envió un correo ni se firmó ningún documento.`:`No se realizó el envío simulado: ${r.error}`;
      store(s,message,reply,trace);res.json({reply,toolCalls:trace,needsConfirmation:false,sessionId});return;
    }
    if(/^(no|rechazo|cancelar|cancelo)([.! ]*)$/i.test(normalized)){
      const reply="Operación cancelada. No se envió ni firmó ningún documento.";
      store(s,message,reply,trace);res.json({reply,toolCalls:trace,needsConfirmation:false,sessionId});return;
    }
  }
  const cases=casosDisponibles(ROOT);
  let caso=casoDeMensaje(message,cases);
  // No permitir a la IA inventar clientes ni acceder rutas fuera de fixtures.
  if(!caso){
    const reply=`No identifico un caso único en el repositorio. Casos disponibles: ${cases.join(", ")}. Indica uno por su identificador exacto; no tengo registros para otros casos.`;
    store(s,message,reply,trace);res.json({reply,toolCalls:trace,needsConfirmation:false,sessionId});return;
  }
  const ctx=context(sessionId);
  let mode="local";
  let llmNote="";
  if(process.env.GEMINI_API_KEY && s.llmTurns<MAX_TURNS) {
    // Una primera llamada identifica y solicita la herramienta. Si falla, siempre hay respaldo determinista.
    try {
      const messages:AgentMessage[]=[{role:"user",parts:[{text:`Consulta del usuario: ${message}. Caso reconocido: ${caso}. Solicita la herramienta proveedor_leer_solicitud para validar los datos; no inventes.`}]}];
      let lastModelParts:Array<Record<string,unknown>>=[];
      for(let i=0;i<MAX_ITER;i++) {
        s.llmTurns++;
        const answer=await adapter.enviar(messages,i===0?defs.slice(0,1):[]);
        lastModelParts=answer.modelParts;
        if(i===0 && answer.calls.length){
          messages.push({role:"model",parts:lastModelParts});
          const requested=answer.calls[0];
          const used= await execute("proveedor_leer_solicitud",{caso},ctx,trace,"modelo");
          messages.push({role:"user",parts:[{functionResponse:{name:"proveedor_leer_solicitud",response:{result:used}}}]});
          mode="modelo";
          if(s.llmTurns>=MAX_TURNS)break;
          continue;
        }
        llmNote=answer.text.slice(0,400);
        break;
      }
    }catch(e){
      const status=e instanceof Error?e.message.slice(0,40):"ERROR";
      console.warn("LLM no disponible; continuando con herramientas locales:",status);
    }
  }
  const output=await allToolsResult(caso,ctx,trace)();
  await buildZip(caso);
  const reply=renderSummary(caso,output,mode);
  if(output.pack?.ok)s.pending=caso;
  store(s,message,reply,trace);
  res.json({reply,toolCalls:trace,needsConfirmation:!!s.pending,sessionId,modo:mode,modelNote:llmNote?"Gemini participó en la interpretación":""});
});
app.get("/api/download/:caso/:nombre",(req,res)=>{
  const {caso,nombre}=req.params;
  const allowed=new Set(["formulario.xlsx","formulario.pdf","valores-portal.md","faltantes.md","paquete.zip","ENVIO-SIMULADO.md"]);
  if(!casosDisponibles(ROOT).includes(caso)||!allowed.has(nombre)){res.status(404).json({error:"Archivo no disponible"});return;}
  const file=path.join(ROOT,"out",caso,nombre);
  if(!existsSync(file)){res.status(404).json({error:"Procesa primero este caso para generar el archivo"});return;}
  res.download(file,nombre);
});
const jsonError:ErrorRequestHandler=(err,_req,res,next)=>{
  if(err instanceof SyntaxError&&"body"in err){res.status(400).json({error:"JSON inválido"});return;}
  next(err);
};
app.use(jsonError);
app.use("/api",(_req,res)=>res.status(404).json({error:"Endpoint desconocido"}));
app.use((err:Error,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
  console.error("Error backend:",err.name);
  res.status(500).json({error:"No se completó la operación. Intenta nuevamente."});
});
const PORT=Number(process.env.PORT||3000);
app.listen(PORT,"0.0.0.0",()=>console.log(`Servidor activo en puerto ${PORT}`));
