import { rmSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { casosDisponibles, leer_solicitud, mapear_campos, generar_formulario, armar_paquete } from "./src/tools/proveedor";
const root=process.cwd();
rmSync(path.join(root,"out"),{recursive:true,force:true});
const ctx={directory:root,sessionId:"demo-sin-ia",fecha:"2026-11-13"};
async function main(){
  for(const caso of casosDisponibles(root)) {
    const leer=JSON.parse(await leer_solicitud.execute({caso},ctx));
    if(!leer.ok){console.log(`FAIL ${caso}: ${leer.error}`);continue;}
    const mapeo=JSON.parse(await mapear_campos.execute({caso,campos:leer.data.campos},ctx));
    const form=JSON.parse(await generar_formulario.execute({caso,mapeo:mapeo.data},ctx));
    const paquete=JSON.parse(await armar_paquete.execute({caso},ctx));
    const estado=paquete.ok?paquete.data.listo_para_firma:"error";
    console.log(`${caso}: formato=${leer.data.formato} campos=${leer.data.campos.length} llenos=${mapeo.ok?mapeo.data.llenos.length:0} faltantes=${mapeo.ok?mapeo.data.faltantes.length:0} confirmaciones=${mapeo.ok?mapeo.data.requiere_confirmacion.length:0} listo_para_firma=${estado} formulario=${form.ok?"OK":"ERROR"} paquete=${paquete.ok?"OK":"ERROR"}`);
    if(!form.ok||!paquete.ok)process.exitCode=1;
  }
  console.log('Salida en out/ · sin consumir API de IA.');
}
main().catch(e=>{console.error(e);process.exitCode=1});
