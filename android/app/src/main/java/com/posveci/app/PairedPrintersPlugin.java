package com.posveci.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Base64;

import java.io.OutputStream;
import java.util.UUID;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.PermissionState;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.util.Set;

/**
 * Lista las impresoras Bluetooth YA EMPAREJADAS del teléfono.
 *
 * Por qué existe: el plugin capacitor-thermal-printer solo hace descubrimiento
 * activo (startDiscovery), que encuentra dispositivos en modo emparejamiento.
 * Una impresora ya emparejada normalmente NO se anuncia, así que nunca aparecía
 * y la búsqueda quedaba cargando para siempre. Esto lee directamente la lista de
 * dispositivos vinculados del sistema, que es lo que el usuario espera ver.
 */
@CapacitorPlugin(
    name = "PairedPrinters",
    permissions = {
        @Permission(strings = { Manifest.permission.BLUETOOTH_CONNECT }, alias = "BLUETOOTH_CONNECT"),
        @Permission(strings = { Manifest.permission.BLUETOOTH_SCAN }, alias = "BLUETOOTH_SCAN")
    }
)
public class PairedPrintersPlugin extends Plugin {

    @PluginMethod
    public void list(PluginCall call) {
        // Android 12+ exige BLUETOOTH_CONNECT en tiempo de ejecución para poder
        // leer los dispositivos vinculados.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && getPermissionState("BLUETOOTH_CONNECT") != PermissionState.GRANTED) {
            requestPermissionForAlias("BLUETOOTH_CONNECT", call, "afterPermission");
            return;
        }
        deliver(call);
    }

    @PermissionCallback
    private void afterPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && getPermissionState("BLUETOOTH_CONNECT") != PermissionState.GRANTED) {
            call.reject("Permiso de Bluetooth denegado");
            return;
        }
        deliver(call);
    }

    private void deliver(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) {
                call.reject("Este dispositivo no tiene Bluetooth");
                return;
            }
            if (!adapter.isEnabled()) {
                call.reject("El Bluetooth está apagado");
                return;
            }

            JSArray devices = new JSArray();
            Set<BluetoothDevice> bonded = adapter.getBondedDevices();
            if (bonded != null) {
                for (BluetoothDevice d : bonded) {
                    JSObject o = new JSObject();
                    o.put("name", d.getName() != null ? d.getName() : "Dispositivo");
                    o.put("address", d.getAddress());
                    o.put("isPrinter", isPrinter(d));
                    devices.put(o);
                }
            }

            JSObject ret = new JSObject();
            ret.put("devices", devices);
            call.resolve(ret);
        } catch (SecurityException e) {
            call.reject("Falta permiso de Bluetooth: " + e.getMessage());
        } catch (Exception e) {
            call.reject("No se pudieron leer los dispositivos: " + e.getMessage());
        }
    }

    // UUID estándar de Serial Port Profile (SPP) — el que usan las térmicas ESC/POS.
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    /**
     * Imprime bytes crudos (ESC/POS, en base64) abriendo un socket RFCOMM/SPP
     * directo a la impresora. Es el método universal que funciona con la mayoría
     * de las térmicas Bluetooth del mercado. El socket bloquea al conectar y
     * lanza excepción si falla (no se queda colgado como la librería anterior).
     */
    @PluginMethod
    public void print(final PluginCall call) {
        final String address = call.getString("address");
        final String dataB64 = call.getString("data");
        if (address == null || dataB64 == null) {
            call.reject("Faltan datos de impresión");
            return;
        }
        // Android 12+: se necesitan CONNECT (para conectar) y SCAN (cancelDiscovery).
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && (getPermissionState("BLUETOOTH_CONNECT") != PermissionState.GRANTED
                    || getPermissionState("BLUETOOTH_SCAN") != PermissionState.GRANTED)) {
            requestPermissionForAliases(new String[]{ "BLUETOOTH_CONNECT", "BLUETOOTH_SCAN" }, call, "afterPrintPermission");
            return;
        }
        doPrint(call, address, dataB64);
    }

    @PermissionCallback
    private void afterPrintPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                && getPermissionState("BLUETOOTH_CONNECT") != PermissionState.GRANTED) {
            call.reject("Permiso de Bluetooth denegado");
            return;
        }
        doPrint(call, call.getString("address"), call.getString("data"));
    }

    private void doPrint(final PluginCall call, final String address, final String dataB64) {
        // La E/S de sockets NO puede correr en el hilo principal.
        new Thread(new Runnable() {
            @Override
            public void run() {
                BluetoothSocket socket = null;
                try {
                    BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                    if (adapter == null) { call.reject("Sin Bluetooth"); return; }
                    if (!adapter.isEnabled()) { call.reject("El Bluetooth está apagado"); return; }
                    // Cancelar el descubrimiento ayuda a que la conexión sea estable,
                    // pero es OPCIONAL: si falta el permiso SCAN no debe romper la impresión.
                    try { adapter.cancelDiscovery(); } catch (Exception ignored) {}

                    BluetoothDevice device = adapter.getRemoteDevice(address);
                    byte[] data = Base64.decode(dataB64, Base64.DEFAULT);

                    try {
                        socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                        socket.connect();
                    } catch (Exception first) {
                        // Fallback: algunos firmwares fallan el canal por SDP; se usa
                        // el canal 1 por reflexión, un truco muy conocido para térmicas.
                        try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                        socket = (BluetoothSocket) device.getClass()
                                .getMethod("createRfcommSocket", int.class)
                                .invoke(device, 1);
                        socket.connect();
                    }

                    OutputStream out = socket.getOutputStream();
                    // Enviar en bloques pequeños con micro-pausas: varias térmicas
                    // portátiles pierden datos si reciben todo el buffer de golpe.
                    int chunk = 256;
                    for (int i = 0; i < data.length; i += chunk) {
                        int end = Math.min(i + chunk, data.length);
                        out.write(data, i, end - i);
                        out.flush();
                        Thread.sleep(20);
                    }
                    // Mantener el socket abierto para que la impresora termine de
                    // imprimir físicamente antes de cerrar (si no, se corta a la mitad
                    // o no imprime nada).
                    Thread.sleep(1500);
                    out.close();
                    socket.close();
                    call.resolve();
                } catch (Exception e) {
                    try { if (socket != null) socket.close(); } catch (Exception ignored) {}
                    call.reject("No se pudo imprimir: " + (e.getMessage() != null ? e.getMessage() : e.toString()));
                }
            }
        }).start();
    }

    /** Marca los que el sistema clasifica como impresora, para destacarlos. */
    private boolean isPrinter(BluetoothDevice d) {
        try {
            BluetoothClass c = d.getBluetoothClass();
            if (c == null) return false;
            return c.getMajorDeviceClass() == BluetoothClass.Device.Major.IMAGING
                    || c.hasService(BluetoothClass.Service.RENDER);
        } catch (Exception e) {
            return false;
        }
    }
}
