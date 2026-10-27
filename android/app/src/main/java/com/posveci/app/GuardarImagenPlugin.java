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
 * Guarda una imagen en la galería del teléfono (Imágenes/POSVECI).
 *
 * Por qué existe: dentro de la app, el WebView ignora los enlaces de descarga
 * (`<a download>`), así que "Descargar" no hacía nada. La usa Publicidad para
 * bajar la imagen terminada y compartirla desde la galería.
 *
 * Android 10 o más nuevo: MediaStore, sin pedir permisos. En uno más viejo
 * contesta ANDROID_VIEJO y la pantalla lo avisa.
 */
@CapacitorPlugin(name = "GuardarImagen")
public class GuardarImagenPlugin extends Plugin {

    @PluginMethod
    public void guardar(PluginCall call) {
        String datos = call.getString("base64");
        String nombre = call.getString("nombre", "posveci.jpg");
        String tipo = call.getString("tipo", "image/jpeg");
        if (datos == null || datos.isEmpty()) {
            call.reject("Falta la imagen");
            return;
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("ANDROID_VIEJO");
            return;
        }
        ContentResolver cr = getContext().getContentResolver();
        Uri uri = null;
        try {
            byte[] bytes = Base64.decode(datos, Base64.DEFAULT);
            ContentValues v = new ContentValues();
            v.put(MediaStore.Images.Media.DISPLAY_NAME, nombre);
            v.put(MediaStore.Images.Media.MIME_TYPE, tipo);
            v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/POSVECI");
            v.put(MediaStore.Images.Media.IS_PENDING, 1);
            uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
            if (uri == null) {
                call.reject("No se pudo crear el archivo");
                return;
            }
            try (OutputStream out = cr.openOutputStream(uri)) {
                if (out == null) throw new Exception("sin salida");
                out.write(bytes);
            }
            v.clear();
            v.put(MediaStore.Images.Media.IS_PENDING, 0);
            cr.update(uri, v, null, null);
            JSObject r = new JSObject();
            r.put("uri", uri.toString());
            call.resolve(r);
        } catch (Exception e) {
            if (uri != null) {
                try { cr.delete(uri, null, null); } catch (Exception ignorado) { /* nada que limpiar */ }
            }
            call.reject("No se pudo guardar la imagen: " + e.getMessage());
        }
    }
}
