import {expect,test} from 'bun:test';
import {EsquemaAutomacao,EsquemaAtualizarAutomacao} from '../src/server/projeto_config.ts';
test('desativar regra não redefine prazo, prioridade nem escopo',()=>{
 expect(EsquemaAtualizarAutomacao.parse({ativo:false})).toEqual({ativo:false});
 expect(EsquemaAtualizarAutomacao.safeParse({}).success).toBe(false);
});
test('defaults pertencem somente à criação e valores inválidos são recusados',()=>{
 const d=EsquemaAutomacao.parse({nome:'Recebimento',gatilho:'documento_cliente_enviado',tituloTarefa:'Conferir documentos'});
 expect(d).toMatchObject({diasUteis:1,prioridade:'media',ativo:true,escopo:'projeto'});
 expect(EsquemaAtualizarAutomacao.safeParse({diasUteis:-1}).success).toBe(false);
 expect(EsquemaAtualizarAutomacao.safeParse({gatilho:'qualquer_evento'}).success).toBe(false);
});
