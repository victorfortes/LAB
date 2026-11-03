import { describe, expect, test } from 'bun:test';
import { Banco } from '../src/store/conexao.ts';

describe('guarda de conexão', () => {
  test('recusa conectar como superusuário ou dono do schema', () => {
    const base = { host: 'localhost', port: 5432, password: 'x', database: 'nga' };
    expect(() => new Banco({ ...base, user: 'postgres' })).toThrow(/não pode conectar/);
    expect(() => new Banco({ ...base, user: 'nga_owner' })).toThrow(/não pode conectar/);
  });
});
