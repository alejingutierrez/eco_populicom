import { provisionWithClient } from './cognito-admin';

class Cmd { constructor(public input: Record<string, unknown>) {} }
class AdminCreateUserCommand extends Cmd {}
class AdminAddUserToGroupCommand extends Cmd {}
class AdminGetUserCommand extends Cmd {}
const m = { AdminCreateUserCommand, AdminAddUserToGroupCommand, AdminGetUserCommand };

const named = (name: string) => Object.assign(new Error(name), { name });
const withSub = (sub: string) => ({ User: { Attributes: [{ Name: 'sub', Value: sub }] } });

function fakeClient(handler: (cmd: Cmd) => unknown) {
  const sent: Cmd[] = [];
  return {
    sent,
    send: async (cmd: Cmd) => {
      sent.push(cmd);
      return handler(cmd);
    },
  };
}

describe('provisionWithClient', () => {
  it('cuenta nueva: manda la invitación y añade al grupo', async () => {
    const c = fakeClient((cmd) => (cmd instanceof AdminCreateUserCommand ? withSub('s-1') : {}));
    const r = await provisionWithClient(c, m, 'pool', 'a@x.com', 'analyst');
    expect(r).toEqual({ sub: 's-1', invitation: 'sent' });
    expect(c.sent[0].input.MessageAction).toBeUndefined();
    expect(c.sent[1]).toBeInstanceOf(AdminAddUserToGroupCommand);
    expect(c.sent[1].input.GroupName).toBe('analyst');
  });

  it('cuenta existente sin activar: REENVÍA la invitación', async () => {
    const c = fakeClient((cmd) => {
      if (cmd instanceof AdminCreateUserCommand) {
        if (cmd.input.MessageAction === 'RESEND') return withSub('s-old');
        throw named('UsernameExistsException');
      }
      return {};
    });
    const r = await provisionWithClient(c, m, 'pool', 'a@x.com', 'analyst');
    expect(r).toEqual({ sub: 's-old', invitation: 'resent' });
    // el RESEND no lleva UserAttributes (Cognito los rechaza en ese modo)
    expect(c.sent[1].input.UserAttributes).toBeUndefined();
    expect(c.sent[2]).toBeInstanceOf(AdminAddUserToGroupCommand);
  });

  it('cuenta ya activa: no reenvía, pero recupera el sub y ajusta el grupo', async () => {
    const c = fakeClient((cmd) => {
      if (cmd instanceof AdminCreateUserCommand) {
        throw named(cmd.input.MessageAction === 'RESEND' ? 'UnsupportedUserStateException' : 'UsernameExistsException');
      }
      if (cmd instanceof AdminGetUserCommand) return { UserAttributes: [{ Name: 'sub', Value: 's-act' }] };
      return {};
    });
    const r = await provisionWithClient(c, m, 'pool', 'a@x.com', 'editor');
    expect(r).toEqual({ sub: 's-act', invitation: 'already_active' });
    expect(c.sent.some((x) => x instanceof AdminAddUserToGroupCommand)).toBe(true);
  });

  it('viewer no se añade a ningún grupo', async () => {
    const c = fakeClient(() => withSub('s-2'));
    await provisionWithClient(c, m, 'pool', 'a@x.com', 'viewer');
    expect(c.sent).toHaveLength(1);
  });

  it('otros errores de Cognito se propagan (el wrapper los convierte en not_sent)', async () => {
    const c = fakeClient(() => { throw named('AccessDeniedException'); });
    await expect(provisionWithClient(c, m, 'pool', 'a@x.com', 'viewer')).rejects.toThrow('AccessDeniedException');
  });
});
