import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, mkdtempSync, cpSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";
import { leer_solicitud, mapear_campos, generar_formulario, armar_paquete, simular_envio, ejecutarHerramienta, casosDisponibles } from "../src/tools/proveedor";
const ctx={directory:process.cwd(),sessionId:"test-evaluacion",fecha:"2026-11-13"};
const decode=(s:string)=>JSON.parse(s) as {ok:boolean;data?:Record<string,unknown>;error?:string};
for(const caso of casosDisponibles(ctx.directory))test(`caso oficial ${caso}: pipeline completo`, async()=>{
  const r=decode(await leer_solicitud.execute({caso},ctx));assert.equal(r.ok,true);const fields=r.data?.campos as string[];
  const m=decode(await mapear_campos.execute({caso,campos:fields},ctx));assert.equal(m.ok,true);
  const f=decode(await generar_formulario.execute({caso,mapeo:m.data},ctx));assert.equal(f.ok,true);
  const p=decode(await armar_paquete.execute({caso},ctx));assert.equal(p.ok,true);
  const check=p.data?.checklist as Array<{estado:string}>;assert.ok(check.length>0);
  assert.equal(p.data?.listo_para_firma,!check.some(s=>s.estado!=="presente")&&r.data?.formato!=="portal");
  assert.ok(existsSync(path.join(ctx.directory,String(f.data?.ruta))));
  assert.ok(existsSync(path.join(ctx.directory,String(p.data?.ruta),"checklist.md")));
  const correo=readFileSync(path.join(ctx.directory,String(p.data?.ruta),"borrador-correo.md"),"utf8");
  assert.doesNotMatch(correo,/03100012345|COLOCOBM/);
});
test('CO Excel respeta celdas exactas y dos hojas',async()=>{
 const r=decode(await generar_formulario.execute({caso:"co-industrias-delta"},ctx));assert.equal(r.ok,true);
 const wb=new ExcelJS.Workbook();await wb.xlsx.readFile(path.join(ctx.directory,String(r.data?.ruta)));
 assert.equal(wb.getWorksheet("Datos Proveedor")?.getCell("B3").value,"Razón social");
 assert.equal(wb.getWorksheet("Datos Proveedor")?.getCell("C3").value,"Periferia IT Group S.A.S.");
 assert.equal(wb.getWorksheet("Datos Bancarios")?.getCell("B5").value,"Número de cuenta");
});
test('EC: PDF y soporte ausente; RUC requiere confirmación',async()=>{
 const caso="ec-corp-andina";const m=decode(await mapear_campos.execute({caso,campos:[]},ctx));
 const c=m.data?.requiere_confirmacion as Array<{etiqueta:string;nota:string}>;
 assert.ok(c.some(x=>x.etiqueta==="RUC"&&/Identificador extranjero/i.test(x.nota)));
 const p=decode(await armar_paquete.execute({caso},ctx));const check=p.data?.checklist as Array<{tipo:string;estado:string}>;
 assert.ok(check.some(x=>x.tipo==="certificado_cumplimiento_tributario"&&x.estado==="ausente"));
 assert.equal(p.data?.listo_para_firma,false);
 const pdf=readFileSync(path.join(ctx.directory,"out",caso,"formulario.pdf"));assert.equal(pdf.toString("utf8",0,5),"%PDF-");
});
test('HN: RTN extranjero; soporte parafiscales vencido',async()=>{
 const caso="hn-agroexport-sula";const map=decode(await mapear_campos.execute({caso,campos:[]},ctx));
 assert.ok((map.data?.requiere_confirmacion as Array<{etiqueta:string}>).some(x=>x.etiqueta==="RTN"));
 const p=decode(await armar_paquete.execute({caso},ctx));assert.ok((p.data?.checklist as Array<{tipo:string;estado:string}>).some(x=>x.tipo==="parafiscales"&&x.estado==="vencido"));
});
test('PA: sin automatización de portal; genera valores-portal.md',async()=>{
 const r=decode(await generar_formulario.execute({caso:"pa-logistica-istmo"},ctx));assert.equal(r.ok,true);
 assert.equal(r.data?.formato,"portal");assert.ok(existsSync(path.join(ctx.directory,"out/pa-logistica-istmo/valores-portal.md")));
});
test('inputs adversarios: traversal, caso inexistente, etiqueta ajena',async()=>{
 for(const caso of ["../repositorio","../../etc/passwd","caso-desconocido"]){assert.equal(decode(await leer_solicitud.execute({caso},ctx)).ok,false)}
 assert.equal(decode(await mapear_campos.execute({caso:"ec-corp-andina",campos:["Campo inventado"]},ctx)).ok,false);
 assert.equal(decode(await ejecutarHerramienta("proveedor_leer_solicitud",{caso:99},ctx)).ok,false);
});
test('no simular envío sin confirmación del turno anterior',async()=>{
 await armar_paquete.execute({caso:"ec-corp-andina"},ctx);
 assert.equal(decode(await simular_envio.execute({caso:"ec-corp-andina",confirmado:true},ctx)).ok,false);
 assert.equal(decode(await simular_envio.execute({caso:"ec-corp-andina",confirmado:false},{...ctx,permitirEnvio:"ec-corp-andina"})).ok,false);
 const ok=decode(await simular_envio.execute({caso:"ec-corp-andina",confirmado:true},{...ctx,permitirEnvio:"ec-corp-andina"}));assert.equal(ok.ok,true);
 assert.ok(existsSync(path.join(ctx.directory,"out/ec-corp-andina/ENVIO-SIMULADO.md")));
});
test('plantilla corrupta: error controlado y soportes siguen revisándose',async()=>{
 const temp=mkdtempSync(path.join(os.tmpdir(),"prueba-reto-"));
 try {cpSync(path.join(ctx.directory,"fixtures"),path.join(temp,"fixtures"),{recursive:true});
 const plant=path.join(temp,"fixtures/reto-01/casos/ec-corp-andina/plantilla-campos.json");writeFileSync(plant,"{ mal json");
 const c={directory:temp,sessionId:"corrupto",fecha:"2026-11-13"};
 const lectura=decode(await leer_solicitud.execute({caso:"ec-corp-andina"},c));assert.equal(lectura.ok,true);
 assert.ok((lectura.data?.advertencias as string[]).length>0);
 const form=decode(await generar_formulario.execute({caso:"ec-corp-andina"},c));assert.equal(form.ok,false);
 const pack=decode(await armar_paquete.execute({caso:"ec-corp-andina"},c));assert.equal(pack.ok,true);
 }finally{rmSync(temp,{recursive:true,force:true})}
});
