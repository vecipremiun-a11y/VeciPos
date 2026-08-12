// Latido de conectividad: ¿hay internet REAL hasta el servidor?
//
// `navigator.onLine` solo dice si el equipo está conectado a una red. Con el
// WiFi del local encendido y el internet caído responde "sí", así que el POS
// creía estar online y las ventas se quedaban esperando en vez de pasar a modo
// offline. Este endpoint es lo que el navegador consulta cada pocos segundos
// para saberlo de verdad.
//
// A propósito NO toca la base de datos ni valida sesión: tiene que ser lo más
// barato y rápido posible, porque se llama seguido y desde cada caja abierta.
// Solo responde "estoy vivo".

export default function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).json({ ok: true, t: Date.now() });
}
