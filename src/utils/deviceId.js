// Identificador estable del dispositivo que marca asistencia.
//
// No identifica a la persona (eso lo hace el PIN): identifica el aparato. Sirve
// para dos cosas del registro legal: que una marca pueda decir desde dónde se
// hizo, y para detectar el caso de siempre: el trabajador que marca desde su
// casa con el PIN de memoria.
//
// Vive en localStorage: si alguien lo borra se genera otro, y eso también es
// información (el registro muestra un dispositivo distinto).

const KEY = 'posveci_device_id';

export function getDeviceId() {
    try {
        let id = localStorage.getItem(KEY);
        if (!id) {
            id = (crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
            localStorage.setItem(KEY, id);
        }
        return id;
    } catch {
        // Modo privado o storage bloqueado: la marca se guarda igual, sin dispositivo.
        return null;
    }
}
