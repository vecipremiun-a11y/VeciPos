package com.posveci.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;

import java.io.OutputStream;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Guarda archivos en el teléfono: las imágenes en la galería (Imágenes/POSVECI) y
 * lo demás, como una boleta en PDF o un Excel, en Descargas/POSVECI.
 *
 * Por qué existe: dentro de la app, el WebView ignora los enlaces de descarga
 * (`<a download>`), así que "Descargar" no hacía nada y tampoco daba error. Lo usa
 * src/lib/descargas.js.
 *
 * Android 10 o más nuevo: MediaStore, sin pedir permisos. En uno más viejo
 * contesta ANDROID_VIEJO y la pantalla lo avisa.
 */
@CapacitorPlugin(name = "GuardarImagen")
public class GuardarImagenPlugin extends Plugin {

    @PluginMethod
    public void guardar(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("ANDROID_VIEJO");
            return;
        }
        escribir(call, MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_PICTURES + "/POSVECI", "posveci.jpg", "image/jpeg");
    }

    @PluginMethod
    public void guardarArchivo(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("ANDROID_VIEJO");
            return;
        }
        escribir(call, MediaStore.Downloads.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_DOWNLOADS + "/POSVECI", "posveci.pdf", "application/octet-stream");
    }

    private void escribir(PluginCall call, Uri coleccion, String carpeta, String nombrePorDefecto, String tipoPorDefecto) {
        String datos = call.getString("base64");
        String nombre = call.getString("nombre", nombrePorDefecto);
        String tipo = call.getString("tipo", tipoPorDefecto);
        if (datos == null || datos.isEmpty()) {
            call.reject("Falta el archivo");
            return;
        }
        ContentResolver cr = getContext().getContentResolver();
        Uri uri = null;
        try {
            byte[] bytes = Base64.decode(datos, Base64.DEFAULT);
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, nombre);
            v.put(MediaStore.MediaColumns.MIME_TYPE, tipo);
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, carpeta);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            uri = cr.insert(coleccion, v);
            if (uri == null) {
                call.reject("No se pudo crear el archivo");
                return;
            }
            try (OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) throw new Exception("sin salida");
                out.write(bytes);
            }
            v.clear();
            v.put(MediaStore.MediaColumns.IS_PENDING, 0);
            cr.update(uri, v, null, null);
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            if (uri != null) {
                try { cr.delete(uri, null, null); } catch (Exception ignorado) { /* nada que limpiar */ }
            }
            call.reject("No se pudo guardar el archivo: " + e.getMessage());
        }
    }
}
