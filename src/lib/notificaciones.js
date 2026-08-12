// Notificaciones del sistema para avisar de pedidos que entran.
//
// Hasta ahora el aviso era una tarjeta dentro de la app con un sonido: solo
// servía si alguien estaba mirando la pantalla. Si el cajero estaba en otra
// app, con el teléfono en el bolsillo o la pantalla apagada, el pedido entraba
// y nadie se enteraba hasta que alguien volvía a mirar.
//
// Esto muestra un aviso REAL del teléfono (o del escritorio): barra de
// notificaciones, sonido y vibración, aunque la app no esté al frente.
//
// Alcance honesto: funciona mientras la app siga viva (abierta o en segundo
// plano). Si el usuario la CIERRA por completo, no llega nada — para eso hace
// falta Firebase/FCM, que es otra instalación (proyecto Firebase, envío desde
// el servidor y registro de dispositivos por empresa).

import { Capacitor } from '@capacitor/core';

let permisoPedido = false;
let disponible = null;

const esNativo = () => Capacitor.isNativePlatform();

async function pluginNativo() {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    return LocalNotifications;
}

/**
 * Pide permiso para notificar. Se llama una vez, después de iniciar sesión.
 *
 * En Android 13+ el permiso es obligatorio y hay que pedirlo explícitamente; si
 * no, las notificaciones se descartan en silencio y parece que el aviso no
 * funciona.
 */
export async function pedirPermisoNotificaciones() {
    if (permisoPedido) return disponible;
    permisoPedido = true;

    try {
        if (esNativo()) {
            const LN = await pluginNativo();
            const actual = await LN.checkPermissions();
            const r = actual.display === 'granted'
                ? actual
                : await LN.requestPermissions();
            disponible = r.display === 'granted';
        } else if (typeof Notification !== 'undefined') {
            const r = Notification.permission === 'default'
                ? await Notification.requestPermission()
                : Notification.permission;
            disponible = r === 'granted';
        } else {
            disponible = false;
        }
    } catch (e) {
        console.warn('No se pudo pedir permiso de notificaciones:', e);
        disponible = false;
    }
    return disponible;
}

/**
 * Muestra un aviso del sistema.
 * Nunca lanza: si falla, la tarjeta dentro de la app sigue apareciendo igual.
 */
export async function notificar({ titulo, cuerpo, etiqueta = 'pedido' }) {
    try {
        if (esNativo()) {
            const LN = await pluginNativo();
            await LN.schedule({
                notifications: [{
                    // Un id por aviso: si se repitiera, Android reemplazaría el
                    // anterior y dos pedidos seguidos se verían como uno solo.
                    id: Date.now() % 2147483647,
                    title: titulo,
                    body: cuerpo,
                    smallIcon: 'ic_stat_icon_config_sample',
                    // Sin `schedule`: se muestra en el acto.
                    extra: { etiqueta },
                }],
            });
            return true;
        }

        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            // `tag` distinto por aviso, mismo motivo que el id en Android.
            new Notification(titulo, { body: cuerpo, tag: `${etiqueta}-${Date.now()}`, icon: '/icon-192.png' });
            return true;
        }
    } catch (e) {
        console.warn('No se pudo mostrar la notificación:', e);
    }
    return false;
}

/** ¿Quedaron habilitadas las notificaciones? (null = todavía no se preguntó) */
export function notificacionesDisponibles() {
    return disponible;
}
