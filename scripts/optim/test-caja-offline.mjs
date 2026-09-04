// Prueba de que la caja abierta NO se pierde sin conexión (3-sep-2026).
//
// El defecto: `checkRegisterStatus` hacía
//     set({ cashRegister: r?.success ? (r.register || null) : null })
// o sea que CUALQUIER respuesta no exitosa borraba la caja. Sin conexión eso es
// grave: el POS no deja vender sin caja abierta, así que salir a otra pantalla y
// volver dejaba a la cajera mirando "Apertura de Caja" —justo en la situación
// para la que existe el modo offline—. La caja seguía abierta en el servidor y
// el efectivo en el cajón; lo único que faltaba era poder preguntarlo.
//
//   node scripts/optim/test-caja-offline.mjs

let fallas = 0;
const check = (l, ok, extra = '') => {
    console.log(`${ok ? '  OK  ' : ' FALLA'} ${l}${extra ? ' -> ' + extra : ''}`);
    if (!ok) fallas++;
};

const CAJA = { id: 42, user_id: 7, opening_amount: 10000, status: 'open' };

// Réplica de checkRegisterStatus, tal como quedó.
function checkRegisterStatus(estado, respuesta) {
    if (!respuesta?.success) return estado;         // se conserva lo conocido
    return { ...estado, cashRegister: respuesta.register || null };
}

const sinConexion = { success: false, error: 'Sin conexión', sinConexion: true, _status: 0 };
const errorServidor = { success: false, error: 'Error interno', _status: 500 };
const conCaja = { success: true, register: CAJA };
const sinCaja = { success: true, register: null };

console.log('1. Con conexión, manda el servidor');
let e = { cashRegister: null };
e = checkRegisterStatus(e, conCaja);
check('el servidor dice que hay caja abierta', e.cashRegister?.id === 42, String(e.cashRegister?.id));
e = checkRegisterStatus(e, sinCaja);
check('el servidor dice que NO hay caja → se borra', e.cashRegister === null);

console.log('\n2. Sin conexión, la caja NO se pierde');
e = { cashRegister: CAJA };
e = checkRegisterStatus(e, sinConexion);
check('sigue la caja conocida', e.cashRegister?.id === 42, String(e.cashRegister?.id));
check('se puede seguir vendiendo', e.cashRegister !== null);

console.log('\n3. Ir a otra pantalla y volver, sin conexión, no la borra');
// Cada vuelta al POS vuelve a preguntar: antes, cada una la borraba.
for (let i = 0; i < 5; i++) e = checkRegisterStatus(e, sinConexion);
check('tras 5 idas y vueltas sigue abierta', e.cashRegister?.id === 42, String(e.cashRegister?.id));

console.log('\n4. Un error del servidor tampoco la borra');
e = checkRegisterStatus(e, errorServidor);
check('sigue abierta ante un 500', e.cashRegister?.id === 42);
e = checkRegisterStatus(e, undefined);
check('sigue abierta si la respuesta viene vacía', e.cashRegister?.id === 42);

console.log('\n5. Al volver la conexión, el servidor corrige');
e = checkRegisterStatus(e, sinCaja);
check('si el servidor dice que se cerró, se cierra', e.cashRegister === null);

console.log('\n6. Sin caja previa, sin conexión, no se inventa una');
e = { cashRegister: null };
e = checkRegisterStatus(e, sinConexion);
check('sigue sin caja (hay que abrirla con internet)', e.cashRegister === null);

console.log('\n7. La caja se guarda en el equipo: aguanta una recarga offline');
{
    const guardado = new Map();
    const partialize = (estado) => ({ cashRegister: estado.cashRegister });
    const rehidratar = () => ({ ...guardado.get('estado') });

    let estado = { cashRegister: CAJA };
    guardado.set('estado', partialize(estado));
    estado = rehidratar();                                  // recarga de pantalla
    check('tras recargar sigue la caja', estado.cashRegister?.id === 42, String(estado.cashRegister?.id));
    estado = checkRegisterStatus(estado, sinConexion);       // y el chequeo offline
    check('y el chequeo sin conexión no la borra', estado.cashRegister?.id === 42);
}

console.log(fallas === 0 ? '\nTODO OK\n' : `\n${fallas} PRUEBAS FALLARON\n`);
process.exit(fallas === 0 ? 0 : 1);
